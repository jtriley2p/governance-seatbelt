import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePublishId } from '@/lib/share-link';
import { SimulationResultsParseError, parseSimulationResultsJson } from '@/lib/simulation-results';
import { NextResponse } from 'next/server';
import { verifyPublishMetadataSignature } from '../../../../../utils/publish/publish-authenticity';

const DEFAULT_MAX_SIMULATION_RESULTS_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_RELAY_TIMEOUT_MS = 15_000;
const DEFAULT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';
const LOCALHOST_ARTIFACT_HOSTS = ['localhost', '127.0.0.1', '::1'];
const SIMULATION_RESULTS_FILENAME = 'simulation-results.json';
const LOCAL_SIMULATION_RESULTS_FILE = path.join(
  process.cwd(),
  'public',
  SIMULATION_RESULTS_FILENAME,
);

type SimulationResultsSourceError = {
  error: string;
  status: number;
  fileSizeBytes?: number;
  maxBytes?: number;
};

type PublishLookupRecord = {
  publishId?: string;
  artifactUrl: string;
  metadataUrl?: string;
  artifactHash?: string;
  publishedAt?: string;
};

type ParsedSimulationResults = {
  parsedBody: unknown;
  rawBodyHash: string;
};

function isSimulationResultsSourceError(value: unknown): value is SimulationResultsSourceError {
  if (!value || typeof value !== 'object') return false;
  if (!('error' in value) || !('status' in value)) return false;

  return (
    typeof Reflect.get(value, 'error') === 'string' &&
    typeof Reflect.get(value, 'status') === 'number'
  );
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

function parseIpv4Address(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;

    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }

    octets.push(octet);
  }

  return octets;
}

function isPrivateIpv4Address(hostname: string): boolean {
  const octets = parseIpv4Address(hostname);
  if (!octets) return false;

  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;

  return false;
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized.includes(':')) return false;

  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4Address(normalized.slice('::ffff:'.length));
  }

  return false;
}

function isPrivateNetworkHostname(hostname: string): boolean {
  return isPrivateIpv4Address(hostname) || isPrivateIpv6Address(hostname);
}

function getMaxSimulationResultsBytes(): number {
  const raw = process.env.SIMULATION_RESULTS_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  return Math.floor(parsed);
}

function getArtifactFetchTimeoutMs(): number {
  const raw = process.env.SIMULATION_RESULTS_FETCH_TIMEOUT_MS;
  if (!raw) return DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS;

  return Math.floor(parsed);
}

function getRelayTimeoutMs(): number {
  const raw = process.env.SEATBELT_RELAY_TIMEOUT_MS;
  if (!raw) return DEFAULT_RELAY_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RELAY_TIMEOUT_MS;

  return Math.floor(parsed);
}

function getRelayUrl(): string {
  const fromEnv = process.env.SEATBELT_RELAY_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }

  return DEFAULT_RELAY_URL;
}

function readSimulationResultsFromLocalFile(
  maxBytes: number,
): unknown | SimulationResultsSourceError {
  try {
    const stat = fs.statSync(LOCAL_SIMULATION_RESULTS_FILE);

    if (stat.size > maxBytes) {
      return {
        error: 'Simulation results file too large',
        status: 413,
        fileSizeBytes: stat.size,
        maxBytes,
      };
    }

    const fileContents = fs.readFileSync(LOCAL_SIMULATION_RESULTS_FILE, 'utf8');
    const parsedContents: unknown = JSON.parse(fileContents);
    return parsedContents;
  } catch (error) {
    console.error('Error reading local simulation results:', error);
    return { error: 'No simulation results found', status: 404 };
  }
}

async function resolvePublishLookupFromPublishId(
  publishId: string,
): Promise<PublishLookupRecord | SimulationResultsSourceError> {
  const relayEndpoint = `${getRelayUrl()}/api/v1/publishes/${encodeURIComponent(publishId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getRelayTimeoutMs());

  try {
    const response = await fetch(relayEndpoint, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status === 404) {
      return { error: 'Publish not found', status: 404 };
    }

    if (!response.ok) {
      return {
        error: `Failed to resolve publish (HTTP ${response.status})`,
        status: 502,
      };
    }

    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object') {
      return { error: 'Relay returned invalid publish lookup payload', status: 502 };
    }

    const artifactUrl = Reflect.get(payload, 'artifactUrl');
    if (typeof artifactUrl !== 'string' || artifactUrl.trim().length === 0) {
      return { error: 'Relay publish lookup is missing artifactUrl', status: 502 };
    }

    const metadataUrl = Reflect.get(payload, 'metadataUrl');
    const artifactHash = Reflect.get(payload, 'artifactHash');
    const publishedAt = Reflect.get(payload, 'publishedAt');

    return {
      publishId,
      artifactUrl,
      metadataUrl: typeof metadataUrl === 'string' ? metadataUrl : undefined,
      artifactHash: typeof artifactHash === 'string' ? artifactHash : undefined,
      publishedAt: typeof publishedAt === 'string' ? publishedAt : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Publish lookup timed out', status: 504 };
    }

    console.error('Error resolving publish id:', error);
    return { error: 'Failed to resolve publish', status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

function inferMetadataUrlFromArtifactUrl(artifactUrl: string): string | null {
  try {
    const parsed = new URL(artifactUrl);
    if (!parsed.pathname.endsWith(`/${SIMULATION_RESULTS_FILENAME}`)) return null;
    parsed.pathname = parsed.pathname.replace(
      /\/simulation-results\.json$/,
      '/publish-metadata.json',
    );
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeArtifactPathname(pathname: string): string | null {
  if (pathname.endsWith(`/${SIMULATION_RESULTS_FILENAME}`)) {
    return pathname;
  }

  const trimmedPathname = pathname.replace(/\/+$/, '');
  const lastSegment = trimmedPathname.split('/').at(-1) ?? '';
  if (lastSegment.includes('.')) {
    return null;
  }

  const basePathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${basePathname}${SIMULATION_RESULTS_FILENAME}`;
}

function isLocalArtifactHostname(hostname: string): boolean {
  return LOCALHOST_ARTIFACT_HOSTS.map(normalizeHostname).includes(normalizeHostname(hostname));
}

function buildTrustedArtifactUrl(parsed: URL, hostname: string, isLocalhost: boolean): string {
  const trusted = new URL('https://seatbelt-publish.vercel.app/');
  trusted.protocol = isLocalhost ? parsed.protocol : 'https:';
  trusted.hostname = hostname;
  trusted.port = isLocalhost ? parsed.port : '';

  const normalizedPathname = normalizeArtifactPathname(parsed.pathname);
  if (!normalizedPathname) {
    throw new Error('Artifact URL must point to simulation-results.json');
  }

  trusted.pathname = normalizedPathname;
  trusted.search = parsed.search;
  trusted.hash = '';
  return trusted.toString();
}

function parseArtifactUrl(rawArtifactUrl: string): string | SimulationResultsSourceError {
  const trimmed = rawArtifactUrl.trim();
  if (!trimmed) {
    return { error: 'Invalid artifact URL', status: 400 };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol;
    const hostname = normalizeHostname(parsed.hostname);
    const isLocalhost = isLocalArtifactHostname(hostname);

    if (!(protocol === 'https:' || (protocol === 'http:' && isLocalhost))) {
      return { error: 'Artifact URL must use https (or http on localhost)', status: 400 };
    }

    if (parsed.port && !isLocalhost) {
      return { error: 'Artifact URL must not include custom ports', status: 400 };
    }

    if (isPrivateNetworkHostname(hostname) && !isLocalhost) {
      return { error: 'Artifact URL must not target private networks', status: 400 };
    }

    if (parsed.username || parsed.password) {
      return { error: 'Artifact URL must not include credentials', status: 400 };
    }

    try {
      return buildTrustedArtifactUrl(parsed, hostname, isLocalhost);
    } catch {
      return { error: 'Artifact URL must point to simulation-results.json', status: 400 };
    }
  } catch {
    return { error: 'Invalid artifact URL', status: 400 };
  }
}

async function readResponseTextWithByteLimit(
  response: Response,
  maxBytes: number,
): Promise<{ bodyText: string } | SimulationResultsSourceError> {
  if (!response.body) {
    return { error: 'Failed to read artifact response body', status: 502 };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let totalBytes = 0;
  let bodyText = '';

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    if (!chunk.value) continue;

    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return {
        error: 'Simulation results file too large',
        status: 413,
        fileSizeBytes: totalBytes,
        maxBytes,
      };
    }

    bodyText += decoder.decode(chunk.value, { stream: true });
  }

  bodyText += decoder.decode();
  return { bodyText };
}

async function readSimulationResultsFromArtifactUrl(
  artifactUrl: string,
  maxBytes: number,
): Promise<ParsedSimulationResults | SimulationResultsSourceError> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getArtifactFetchTimeoutMs());

  try {
    const response = await fetch(artifactUrl, {
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        error: 'Artifact URL redirects are not allowed',
        status: 502,
      };
    }

    if (!response.ok) {
      return {
        error: `Failed to fetch artifact (HTTP ${response.status})`,
        status: 502,
      };
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const parsedContentLength = Number(contentLengthHeader);
      if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBytes) {
        return {
          error: 'Simulation results file too large',
          status: 413,
          fileSizeBytes: parsedContentLength,
          maxBytes,
        };
      }
    }

    const responseBody = await readResponseTextWithByteLimit(response, maxBytes);
    if (isSimulationResultsSourceError(responseBody)) {
      return responseBody;
    }

    const rawBodyHash = createHash('sha256').update(responseBody.bodyText).digest('hex');
    const parsedBody: unknown = JSON.parse(responseBody.bodyText);
    return { parsedBody, rawBodyHash };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Artifact fetch timed out', status: 504 };
    }

    console.error('Error fetching simulation artifact:', error);
    return { error: 'Failed to fetch artifact', status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

async function readPublishMetadataFromUrl(
  metadataUrl: string,
  maxBytes: number,
): Promise<Record<string, unknown> | SimulationResultsSourceError> {
  const parsedMetadataUrl = parseArtifactUrl(
    metadataUrl.replace(/\/publish-metadata\.json$/, '/simulation-results.json'),
  );
  if (isSimulationResultsSourceError(parsedMetadataUrl)) {
    return parsedMetadataUrl;
  }

  const trustedMetadataUrl = parsedMetadataUrl.replace(
    /\/simulation-results\.json$/,
    '/publish-metadata.json',
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getArtifactFetchTimeoutMs());

  try {
    const response = await fetch(trustedMetadataUrl, {
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });

    if (!response.ok) {
      return { error: `Failed to fetch publish metadata (HTTP ${response.status})`, status: 502 };
    }

    const responseBody = await readResponseTextWithByteLimit(response, maxBytes);
    if (isSimulationResultsSourceError(responseBody)) {
      return responseBody;
    }

    const parsedBody: unknown = JSON.parse(responseBody.bodyText);
    if (!isPlainRecord(parsedBody)) {
      return { error: 'Publish metadata payload is invalid', status: 502 };
    }

    return parsedBody;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Publish metadata fetch timed out', status: 504 };
    }
    return { error: 'Failed to fetch publish metadata', status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mergeTrustMetadata(
  structuredReport: Record<string, unknown>,
  additions: { warningReasons?: string[]; blockingReasons?: string[] },
) {
  const metadata = structuredReport.metadata;
  if (!isPlainRecord(metadata)) return;

  const existingTrust = metadata.trust;
  const existingBlocking = isPlainRecord(existingTrust)
    ? (existingTrust.blockingReasons ?? []).filter(
        (reason): reason is string => typeof reason === 'string',
      )
    : [];
  const existingWarnings = isPlainRecord(existingTrust)
    ? (existingTrust.warningReasons ?? []).filter(
        (reason): reason is string => typeof reason === 'string',
      )
    : [];

  const blockingReasons = [...existingBlocking, ...(additions.blockingReasons ?? [])];
  const warningReasons = [...existingWarnings, ...(additions.warningReasons ?? [])];
  const nextTrust = {
    level: blockingReasons.length > 0 ? 'blocked' : warningReasons.length > 0 ? 'warning' : 'ready',
    blockingReasons: blockingReasons.length > 0 ? Array.from(new Set(blockingReasons)) : undefined,
    warningReasons: warningReasons.length > 0 ? Array.from(new Set(warningReasons)) : undefined,
  };

  metadata.trust = nextTrust;
}

function attachPublishMetadata(
  normalizedResults: ReturnType<typeof parseSimulationResultsJson>,
  publishLookup: PublishLookupRecord,
  publishMetadata: Record<string, unknown> | null,
  artifactHashFromFetch?: string,
): void {
  for (const result of normalizedResults) {
    const structuredReport = result.report.structuredReport;
    if (!isPlainRecord(structuredReport)) continue;
    const metadata = structuredReport.metadata;
    if (!isPlainRecord(metadata)) continue;

    if (
      publishLookup.artifactHash &&
      artifactHashFromFetch &&
      artifactHashFromFetch !== publishLookup.artifactHash
    ) {
      mergeTrustMetadata(structuredReport, {
        blockingReasons: [
          'Published artifact hash does not match fetched simulation-results.json.',
        ],
      });
    }

    if (publishMetadata) {
      const bindingBlockingReasons: string[] = [];
      const bindingWarningReasons: string[] = [];

      const metadataPublishId = readOptionalString(publishMetadata, 'publish_id');
      const metadataArtifactHash = readOptionalString(publishMetadata, 'artifact_hash');
      const metadataPublishedAt = readOptionalString(publishMetadata, 'published_at');

      if (publishLookup.publishId) {
        if (!metadataPublishId) {
          bindingWarningReasons.push('Publish metadata is missing publish_id.');
        } else if (metadataPublishId !== publishLookup.publishId) {
          bindingBlockingReasons.push('Publish metadata publish_id does not match relay lookup.');
        }
      }

      if (publishLookup.artifactHash) {
        if (!metadataArtifactHash) {
          bindingWarningReasons.push('Publish metadata is missing artifact_hash.');
        } else if (metadataArtifactHash !== publishLookup.artifactHash) {
          bindingBlockingReasons.push(
            'Publish metadata artifact_hash does not match relay lookup.',
          );
        }
      }

      if (publishLookup.publishedAt) {
        if (!metadataPublishedAt) {
          bindingWarningReasons.push('Publish metadata is missing published_at.');
        } else if (metadataPublishedAt !== publishLookup.publishedAt) {
          bindingWarningReasons.push('Publish metadata published_at differs from relay lookup.');
        }
      }

      if (bindingBlockingReasons.length > 0) {
        mergeTrustMetadata(structuredReport, { blockingReasons: bindingBlockingReasons });
      }
      if (bindingWarningReasons.length > 0) {
        mergeTrustMetadata(structuredReport, { warningReasons: bindingWarningReasons });
      }
    }

    const publish = {
      publishId: publishLookup.publishId,
      artifactHash: publishLookup.artifactHash,
      artifactUrl: publishLookup.artifactUrl,
      metadataUrl: publishLookup.metadataUrl,
      publishedAt: publishLookup.publishedAt,
      authenticity: publishMetadata
        ? verifyPublishMetadataSignature(publishMetadata, process.env)
        : {
            status: 'unsigned',
            reason: 'No publish metadata available for authenticity verification.',
          },
    };

    metadata.publish = publish;

    if (publish.authenticity.status === 'invalid') {
      mergeTrustMetadata(structuredReport, {
        blockingReasons: ['Publish authenticity verification failed.'],
      });
    } else if (
      publish.authenticity.status === 'unsigned' ||
      publish.authenticity.status === 'unconfigured'
    ) {
      mergeTrustMetadata(structuredReport, {
        warningReasons: [
          publish.authenticity.reason ?? 'Publish authenticity could not be verified.',
        ],
      });
    }
  }
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const includeMarkdown = requestUrl.searchParams.get('includeMarkdown') === '1';
    const artifactParam = requestUrl.searchParams.get('artifact');
    const publishIdParam = normalizePublishId(requestUrl.searchParams.get('publishId'));
    const maxBytes = getMaxSimulationResultsBytes();
    let publishLookup: PublishLookupRecord | null = null;
    let publishMetadata: Record<string, unknown> | null = null;
    let artifactHashFromFetch: string | undefined;

    let results: unknown | SimulationResultsSourceError;

    if (artifactParam) {
      const artifactUrl = parseArtifactUrl(artifactParam);
      if (isSimulationResultsSourceError(artifactUrl)) {
        return NextResponse.json({ error: artifactUrl.error }, { status: artifactUrl.status });
      }

      const artifactResults = await readSimulationResultsFromArtifactUrl(artifactUrl, maxBytes);
      if (isSimulationResultsSourceError(artifactResults)) {
        results = artifactResults;
      } else {
        results = artifactResults.parsedBody;
        artifactHashFromFetch = artifactResults.rawBodyHash;
      }
      const metadataUrl = inferMetadataUrlFromArtifactUrl(artifactUrl);
      if (metadataUrl) {
        const metadataResponse = await readPublishMetadataFromUrl(metadataUrl, maxBytes);
        if (!isSimulationResultsSourceError(metadataResponse)) {
          publishLookup = {
            publishId: publishIdParam ?? undefined,
            artifactUrl,
            metadataUrl,
          };
          publishMetadata = metadataResponse;
        }
      }
    } else if (requestUrl.searchParams.has('publishId')) {
      if (!publishIdParam) {
        return NextResponse.json({ error: 'Invalid publishId' }, { status: 400 });
      }

      const resolvedPublishLookup = await resolvePublishLookupFromPublishId(publishIdParam);
      if (isSimulationResultsSourceError(resolvedPublishLookup)) {
        return NextResponse.json(
          { error: resolvedPublishLookup.error },
          { status: resolvedPublishLookup.status },
        );
      }
      publishLookup = resolvedPublishLookup;

      const trustedArtifactUrl = parseArtifactUrl(resolvedPublishLookup.artifactUrl);
      if (isSimulationResultsSourceError(trustedArtifactUrl)) {
        return NextResponse.json(
          { error: trustedArtifactUrl.error },
          { status: trustedArtifactUrl.status },
        );
      }

      const artifactResults = await readSimulationResultsFromArtifactUrl(
        trustedArtifactUrl,
        maxBytes,
      );
      if (isSimulationResultsSourceError(artifactResults)) {
        results = artifactResults;
      } else {
        results = artifactResults.parsedBody;
        artifactHashFromFetch = artifactResults.rawBodyHash;
      }
      if (resolvedPublishLookup.metadataUrl) {
        const metadataResponse = await readPublishMetadataFromUrl(
          resolvedPublishLookup.metadataUrl,
          maxBytes,
        );
        if (!isSimulationResultsSourceError(metadataResponse)) {
          publishMetadata = metadataResponse;
        }
      }
    } else {
      results = readSimulationResultsFromLocalFile(maxBytes);
    }

    if (isSimulationResultsSourceError(results)) {
      const body = {
        error: results.error,
        fileSizeBytes: results.fileSizeBytes,
        maxBytes: results.maxBytes,
      };
      return NextResponse.json(body, { status: results.status });
    }

    const normalizedResults = parseSimulationResultsJson(results);
    if (normalizedResults.length === 0) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }
    if (publishLookup) {
      attachPublishMetadata(
        normalizedResults,
        publishLookup,
        publishMetadata,
        artifactHashFromFetch,
      );
    }

    if (includeMarkdown) {
      return NextResponse.json(normalizedResults);
    }

    const withoutMarkdown = normalizedResults.map((result) => ({
      ...result,
      report: {
        ...result.report,
        markdownReport: '',
      },
    }));

    return NextResponse.json(withoutMarkdown);
  } catch (error) {
    if (error instanceof SimulationResultsParseError) {
      console.error('Invalid simulation-results.json:', error.issues);
      return NextResponse.json(
        { error: 'Invalid simulation-results.json', issues: error.summary },
        { status: 500 },
      );
    }

    console.error('Error in simulation results API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
