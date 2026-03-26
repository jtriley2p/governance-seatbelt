import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { POST as postShareLink } from './share-link/route';
import { GET as getSimulationResults } from './simulation-results/route';

const ORIGINAL_FETCH = globalThis.fetch;
const LOCAL_SIMULATION_RESULTS_FILE = path.join(process.cwd(), 'public', 'simulation-results.json');

const ENV_KEYS = [
  'NODE_ENV',
  'SIMULATION_RESULTS_MAX_BYTES',
  'SHARE_LINK_RATE_LIMIT_MAX_REQUESTS',
  'SHARE_LINK_RATE_LIMIT_WINDOW_MS',
  'SEATBELT_RELAY_URL',
];

const ORIGINAL_ENV_VALUES = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const hadOriginalSimulationResultsFile = fs.existsSync(LOCAL_SIMULATION_RESULTS_FILE);
const originalSimulationResultsFileContents = hadOriginalSimulationResultsFile
  ? fs.readFileSync(LOCAL_SIMULATION_RESULTS_FILE, 'utf8')
  : '';

const VALID_SIMULATION_RESULTS_JSON = JSON.stringify([
  {
    proposalData: {
      targets: [],
      values: [],
      signatures: [],
      calldatas: [],
      description: 'test proposal',
    },
    report: {
      status: 'ok',
      summary: 'summary',
      markdownReport: '# report',
    },
  },
]);

const VALID_SIMULATION_RESULTS_WITH_STRUCTURED_REPORT_JSON = JSON.stringify([
  {
    proposalData: {
      targets: [],
      values: [],
      signatures: [],
      calldatas: [],
      description: 'test proposal',
    },
    report: {
      status: 'ok',
      summary: 'summary',
      markdownReport: '# report',
      structuredReport: {
        title: 'Test Report',
        status: 'success',
        metadata: {
          trust: {
            level: 'ready',
          },
        },
      },
    },
  },
]);

function createMockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, {
    preconnect: (...args: Parameters<typeof ORIGINAL_FETCH.preconnect>) => {
      return ORIGINAL_FETCH.preconnect(...args);
    },
  });
}

function restoreEnvironment(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV_VALUES.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

function restoreSimulationResultsFile(): void {
  if (hadOriginalSimulationResultsFile) {
    fs.mkdirSync(path.dirname(LOCAL_SIMULATION_RESULTS_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_SIMULATION_RESULTS_FILE, originalSimulationResultsFileContents);
    return;
  }

  if (fs.existsSync(LOCAL_SIMULATION_RESULTS_FILE)) {
    fs.unlinkSync(LOCAL_SIMULATION_RESULTS_FILE);
  }
}

function writeSimulationResultsFile(contents: string): void {
  fs.mkdirSync(path.dirname(LOCAL_SIMULATION_RESULTS_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_SIMULATION_RESULTS_FILE, contents);
}

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const error = Reflect.get(payload, 'error');
  return typeof error === 'string' ? error : null;
}

function readMarkdownReport(payload: unknown): string | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const firstItem = payload[0];
  if (!firstItem || typeof firstItem !== 'object') return null;

  const report = Reflect.get(firstItem, 'report');
  if (!report || typeof report !== 'object') return null;

  const markdownReport = Reflect.get(report, 'markdownReport');
  return typeof markdownReport === 'string' ? markdownReport : null;
}

function readStructuredReportMetadata(payload: unknown): Record<string, unknown> | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const firstItem = payload[0];
  if (!firstItem || typeof firstItem !== 'object') return null;

  const report = Reflect.get(firstItem, 'report');
  if (!report || typeof report !== 'object') return null;

  const structuredReport = Reflect.get(report, 'structuredReport');
  if (!structuredReport || typeof structuredReport !== 'object' || Array.isArray(structuredReport)) {
    return null;
  }

  const metadata = Reflect.get(structuredReport, 'metadata');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  return metadata as Record<string, unknown>;
}

function readStructuredReportPublishMetadata(payload: unknown): unknown | null {
  const metadata = readStructuredReportMetadata(payload);
  if (!metadata) return null;
  return Reflect.get(metadata, 'publish') ?? null;
}

function readArtifactUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const artifactUrl = Reflect.get(payload, 'artifactUrl');
  return typeof artifactUrl === 'string' ? artifactUrl : null;
}

function readViewerUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const viewerUrl = Reflect.get(payload, 'viewerUrl');
  return typeof viewerUrl === 'string' ? viewerUrl : null;
}

function readPublishId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const publishId = Reflect.get(payload, 'publishId');
  return typeof publishId === 'string' ? publishId : null;
}

function readFetchRequestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.toString();
  }

  if (typeof input === 'string') {
    return input;
  }

  return input.url;
}

function readArtifactRawFromRelayRequest(init?: RequestInit): string | null {
  if (!init || typeof init.body !== 'string') return null;

  try {
    const payload: unknown = JSON.parse(init.body);
    if (!payload || typeof payload !== 'object') return null;

    const artifactRaw = Reflect.get(payload, 'artifactRaw');
    return typeof artifactRaw === 'string' ? artifactRaw : null;
  } catch {
    return null;
  }
}

beforeEach(() => {
  restoreEnvironment();
  restoreSimulationResultsFile();
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  restoreEnvironment();
  restoreSimulationResultsFile();
  globalThis.fetch = ORIGINAL_FETCH;
});

afterAll(() => {
  restoreEnvironment();
  restoreSimulationResultsFile();
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('/api/simulation-results', () => {
  it('returns results from arbitrary public artifact host and strips markdown by default', async () => {
    let fetchInit: RequestInit | undefined;

    globalThis.fetch = createMockFetch(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        fetchInit = init;
        return new Response(VALID_SIMULATION_RESULTS_JSON, {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      },
    );

    const artifactUrl = 'https://publisher.example.org/simulation-results.json';
    const response = await getSimulationResults(
      new Request(
        `http://localhost/api/simulation-results?artifact=${encodeURIComponent(artifactUrl)}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchInit?.redirect).toBe('manual');

    const payload: unknown = await response.json();
    expect(readMarkdownReport(payload)).toBe('');
  });

  it('does not attach publish authenticity metadata for local simulation-results.json reads', async () => {
    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      throw new Error('Unexpected fetch call');
    });

    writeSimulationResultsFile(VALID_SIMULATION_RESULTS_WITH_STRUCTURED_REPORT_JSON);

    const response = await getSimulationResults(new Request('http://localhost/api/simulation-results'));

    expect(response.status).toBe(200);

    const payload: unknown = await response.json();
    expect(readStructuredReportPublishMetadata(payload)).toBeNull();
  });

  it('normalizes base deployment artifact urls to simulation-results.json before fetch', async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createMockFetch(
      async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        requestedUrls.push(readFetchRequestUrl(input));
        return new Response(VALID_SIMULATION_RESULTS_JSON, {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      },
    );

    const response = await getSimulationResults(
      new Request(
        'http://localhost/api/simulation-results?artifact=https%3A%2F%2Fseatbelt-publish.vercel.app%2Fdeployment%2Fxyz',
      ),
    );

    expect(response.status).toBe(200);
    expect(requestedUrls).toEqual([
      'https://seatbelt-publish.vercel.app/deployment/xyz/simulation-results.json',
      'https://seatbelt-publish.vercel.app/deployment/xyz/publish-metadata.json',
    ]);
  });

  it('rejects private-network artifact targets', async () => {
    let fetchCalls = 0;
    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      fetchCalls += 1;
      return new Response('{}', { status: 200 });
    });

    const response = await getSimulationResults(
      new Request(
        'http://localhost/api/simulation-results?artifact=https%3A%2F%2F10.0.0.1%2Fsimulation-results.json',
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchCalls).toBe(0);

    const payload: unknown = await response.json();
    expect(readErrorMessage(payload)).toBe('Artifact URL must not target private networks');
  });

  it('rejects custom ports for non-localhost artifact urls', async () => {
    let fetchCalls = 0;
    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      fetchCalls += 1;
      return new Response('{}', { status: 200 });
    });

    const response = await getSimulationResults(
      new Request(
        'http://localhost/api/simulation-results?artifact=https%3A%2F%2Fseatbelt-publish.vercel.app%3A444%2Fsimulation-results.json',
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchCalls).toBe(0);

    const payload: unknown = await response.json();
    expect(readErrorMessage(payload)).toBe('Artifact URL must not include custom ports');
  });

  it('rejects redirecting artifacts', async () => {
    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      return new Response('redirect', {
        status: 302,
        headers: {
          location: 'https://seatbelt-publish.vercel.app/simulation-results.json',
        },
      });
    });

    const response = await getSimulationResults(
      new Request(
        'http://localhost/api/simulation-results?artifact=https%3A%2F%2Fseatbelt-publish.vercel.app%2Fsimulation-results.json',
      ),
    );

    expect(response.status).toBe(502);
    const payload: unknown = await response.json();
    expect(readErrorMessage(payload)).toBe('Artifact URL redirects are not allowed');
  });

  it('aborts artifact reads once body size exceeds max bytes', async () => {
    process.env.SIMULATION_RESULTS_MAX_BYTES = '64';

    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      const largeChunk = new TextEncoder().encode('x'.repeat(128));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(largeChunk);
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    });

    const response = await getSimulationResults(
      new Request(
        'http://localhost/api/simulation-results?artifact=https%3A%2F%2Fseatbelt-publish.vercel.app%2Fsimulation-results.json',
      ),
    );

    expect(response.status).toBe(413);
    const payload: unknown = await response.json();
    expect(readErrorMessage(payload)).toBe('Simulation results file too large');
  });

  it('resolves publishId via relay lookup before fetching artifact', async () => {
    const requests: string[] = [];
    process.env.SEATBELT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';

    globalThis.fetch = createMockFetch(async (input: RequestInfo | URL): Promise<Response> => {
      const requestUrl = readFetchRequestUrl(input);
      requests.push(requestUrl);

      if (requestUrl.includes('/api/v1/publishes/')) {
        return new Response(
          JSON.stringify({
            publishId: '11111111-1111-4111-8111-111111111111',
            artifactUrl: 'https://seatbelt-publish.vercel.app/simulation-results.json',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return new Response(VALID_SIMULATION_RESULTS_JSON, {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    });

    const response = await getSimulationResults(
      new Request(
        'http://localhost/api/simulation-results?publishId=11111111-1111-4111-8111-111111111111',
      ),
    );

    expect(response.status).toBe(200);
    expect(requests).toContain(
      'https://seatbelt-relay-beta.vercel.app/api/v1/publishes/11111111-1111-4111-8111-111111111111',
    );
    expect(requests).toContain('https://seatbelt-publish.vercel.app/simulation-results.json');
  });

  it('blocks when publish-metadata.json does not match relay lookup fields', async () => {
    process.env.SEATBELT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';

    globalThis.fetch = createMockFetch(async (input: RequestInfo | URL): Promise<Response> => {
      const requestUrl = readFetchRequestUrl(input);

      if (requestUrl.includes('/api/v1/publishes/')) {
        return new Response(
          JSON.stringify({
            publishId: '11111111-1111-4111-8111-111111111111',
            artifactUrl: 'https://seatbelt-publish.vercel.app/simulation-results.json',
            metadataUrl: 'https://seatbelt-publish.vercel.app/publish-metadata.json',
            artifactHash: 'hash-from-relay',
            publishedAt: '2026-03-26T00:00:00.000Z',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.endsWith('/simulation-results.json')) {
        return new Response(VALID_SIMULATION_RESULTS_WITH_STRUCTURED_REPORT_JSON, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (requestUrl.endsWith('/publish-metadata.json')) {
        return new Response(
          JSON.stringify({
            publish_id: '00000000-0000-4000-8000-000000000000',
            published_at: '2026-03-27T00:00:00.000Z',
            artifact_hash: 'hash-from-metadata',
            relay_version: 'test-relay',
            authenticity: {
              algorithm: 'hmac-sha256',
              key_id: 'k1',
              signature: '00',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 404 });
    });

    const response = await getSimulationResults(
      new Request(
        'http://localhost/api/simulation-results?publishId=11111111-1111-4111-8111-111111111111',
      ),
    );

    expect(response.status).toBe(200);
    const payload: unknown = await response.json();

    const metadata = readStructuredReportMetadata(payload);
    expect(metadata).not.toBeNull();
    const trust = metadata ? Reflect.get(metadata, 'trust') : null;
    expect(trust).not.toBeNull();

    expect(Reflect.get(trust, 'level')).toBe('blocked');
    expect(Reflect.get(trust, 'blockingReasons')).toEqual(
      expect.arrayContaining([
        'Publish metadata publish_id does not match relay lookup.',
        'Publish metadata artifact_hash does not match relay lookup.',
      ]),
    );
  });
});

describe('/api/share-link', () => {
  it('publishes simulation-results.json and returns artifactUrl + viewerUrl', async () => {
    writeSimulationResultsFile(VALID_SIMULATION_RESULTS_JSON);
    process.env.SEATBELT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';

    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          artifactUrl: 'https://seatbelt-publish.vercel.app/simulation-results.json',
          viewerUrl: 'https://seatbelt.app',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    });

    const response = await postShareLink(
      new Request('http://localhost/api/share-link', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );

    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    expect(readArtifactUrl(payload)).toBe(
      'https://seatbelt-publish.vercel.app/simulation-results.json',
    );
    expect(readViewerUrl(payload)).toBe('https://seatbelt.app');
  });

  it('strips markdownReport before publishing artifact via relay', async () => {
    writeSimulationResultsFile(VALID_SIMULATION_RESULTS_JSON);
    process.env.SEATBELT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';

    let publishedArtifactRaw: string | null = null;
    globalThis.fetch = createMockFetch(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        publishedArtifactRaw = readArtifactRawFromRelayRequest(init);

        return new Response(
          JSON.stringify({
            artifactUrl: 'https://seatbelt-publish.vercel.app/simulation-results.json',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      },
    );

    const response = await postShareLink(
      new Request('http://localhost/api/share-link', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.11',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(publishedArtifactRaw).not.toBeNull();
    const publishedPayload = publishedArtifactRaw
      ? (JSON.parse(publishedArtifactRaw) as unknown)
      : null;
    expect(readMarkdownReport(publishedPayload)).toBe('');
  });

  it('returns publishId when relay marks it resolvable', async () => {
    writeSimulationResultsFile(VALID_SIMULATION_RESULTS_JSON);
    process.env.SEATBELT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';

    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          publishId: '11111111-1111-4111-8111-111111111111',
          publishIdResolvable: true,
          artifactUrl: 'https://seatbelt-publish.vercel.app/simulation-results.json',
          viewerUrl: 'https://seatbelt.app',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    });

    const response = await postShareLink(
      new Request('http://localhost/api/share-link', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );

    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    expect(readPublishId(payload)).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('omits publishId when relay does not mark it resolvable', async () => {
    writeSimulationResultsFile(VALID_SIMULATION_RESULTS_JSON);
    process.env.SEATBELT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';

    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          publishId: '11111111-1111-4111-8111-111111111111',
          artifactUrl: 'https://seatbelt-publish.vercel.app/simulation-results.json',
          viewerUrl: 'https://seatbelt.app',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    });

    const response = await postShareLink(
      new Request('http://localhost/api/share-link', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );

    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    expect(readPublishId(payload)).toBeNull();
  });

  it('returns 429 when share-link endpoint exceeds rate limit', async () => {
    writeSimulationResultsFile(VALID_SIMULATION_RESULTS_JSON);
    process.env.SHARE_LINK_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.SHARE_LINK_RATE_LIMIT_WINDOW_MS = '60000';

    let fetchCalls = 0;
    globalThis.fetch = createMockFetch(async (): Promise<Response> => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          artifactUrl: 'https://seatbelt-publish.vercel.app/simulation-results.json',
        }),
        { status: 200 },
      );
    });

    const firstResponse = await postShareLink(
      new Request('http://localhost/api/share-link', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '198.51.100.25',
        },
      }),
    );

    const secondResponse = await postShareLink(
      new Request('http://localhost/api/share-link', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '198.51.100.25',
        },
      }),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.headers.get('retry-after')).not.toBeNull();
    expect(fetchCalls).toBe(1);

    const payload: unknown = await secondResponse.json();
    expect(readErrorMessage(payload)).toBe('Rate limit exceeded. Try again later.');
  });
});
