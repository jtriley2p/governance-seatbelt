const ARTIFACT_QUERY_PARAM = 'artifact';
const PUBLISH_ID_QUERY_PARAM = 'publishId';
const INTERNAL_BASE_URL = 'https://seatbelt.local';
const SIMULATION_RESULTS_FILENAME = 'simulation-results.json';
const PUBLISH_ID_PATH_REGEX =
  /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/action)?\/?$/i;

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function supportsArtifactProtocol(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function hasSimulationResultsSuffix(pathname: string): boolean {
  return pathname.endsWith(`/${SIMULATION_RESULTS_FILENAME}`);
}

function normalizeArtifactPathname(pathname: string): string {
  if (hasSimulationResultsSuffix(pathname)) {
    return pathname;
  }

  const basePathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${basePathname}${SIMULATION_RESULTS_FILENAME}`;
}

export function normalizeArtifactUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!supportsArtifactProtocol(parsed)) return null;
    if (parsed.username || parsed.password) return null;

    parsed.pathname = normalizeArtifactPathname(parsed.pathname);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizePublishId(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function extractPublishIdFromPathname(pathname: string): string | null {
  const match = pathname.match(PUBLISH_ID_PATH_REGEX);
  if (!match) {
    return null;
  }

  return normalizePublishId(match[1]);
}

export function buildCanonicalShareUrl(viewerUrl: string, artifactUrl: string): string {
  const normalizedArtifactUrl = normalizeArtifactUrl(artifactUrl);
  if (!normalizedArtifactUrl) {
    throw new Error('Invalid artifact URL');
  }

  const parsedViewerUrl = new URL(viewerUrl);
  parsedViewerUrl.search = '';
  parsedViewerUrl.hash = '';
  parsedViewerUrl.searchParams.set(ARTIFACT_QUERY_PARAM, normalizedArtifactUrl);

  return parsedViewerUrl.toString();
}

export function buildViewerUrl(origin: string): string {
  return new URL('/', origin).toString();
}

export function buildPrettyShareUrl(viewerUrl: string, publishId: string): string {
  const normalizedPublishId = normalizePublishId(publishId);
  if (!normalizedPublishId) {
    throw new Error('Invalid publish id');
  }

  const parsedViewerUrl = new URL(viewerUrl);
  parsedViewerUrl.search = '';
  parsedViewerUrl.hash = '';
  parsedViewerUrl.pathname = `/p/${normalizedPublishId}`;
  return parsedViewerUrl.toString();
}

export function withArtifactParam(
  href: string,
  artifactUrl: string | null,
  publishId: string | null = null,
): string {
  const normalizedArtifactUrl = normalizeArtifactUrl(artifactUrl);
  const normalizedPublishId = normalizePublishId(publishId);
  if (!normalizedArtifactUrl && !normalizedPublishId) return href;

  const absoluteHref = isAbsoluteUrl(href);
  const parsedHref = absoluteHref ? new URL(href) : new URL(href, INTERNAL_BASE_URL);

  if (normalizedArtifactUrl) {
    parsedHref.searchParams.set(ARTIFACT_QUERY_PARAM, normalizedArtifactUrl);
  }
  if (normalizedPublishId) {
    parsedHref.searchParams.set(PUBLISH_ID_QUERY_PARAM, normalizedPublishId);
  }

  if (absoluteHref) {
    return parsedHref.toString();
  }

  return `${parsedHref.pathname}${parsedHref.search}${parsedHref.hash}`;
}
