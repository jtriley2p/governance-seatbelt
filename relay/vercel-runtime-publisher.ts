type OpenJsonObject = Record<string, unknown>;

type RelayPublisherResult = {
  deploymentUrl: string;
  artifactUrl: string;
  metadataUrl: string;
};

type RelayPublishLogEntry = {
  publish_id: string;
  artifact_hash: string;
  published_at: string;
  [key: string]: unknown;
};

type RuntimePublisherInput = {
  artifactRaw: string;
  publishLogEntry: RelayPublishLogEntry;
  env: Record<string, string | undefined>;
};

type VercelPublishEnv = {
  token: string;
  projectId: string;
  orgId: string;
};

type CreatedDeployment = {
  id: string;
  deploymentUrl: string;
};

const VERCEL_API_BASE_URL = 'https://api.vercel.com';
const PUBLISH_ALIAS_BASE_DOMAIN = 'publish.scopelift.co';

function readNonEmptyEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function readPrimaryOrAliasEnv(
  env: Record<string, string | undefined>,
  primaryName: string,
  aliasName: string,
): string | undefined {
  const primaryValue = readNonEmptyEnv(env, primaryName);
  if (primaryValue) {
    return primaryValue;
  }

  return readNonEmptyEnv(env, aliasName);
}

function formatEnvPair(primaryName: string, aliasName: string): string {
  return `${primaryName} (or ${aliasName})`;
}

function readManagedVercelEnv(env: Record<string, string | undefined>): VercelPublishEnv {
  const token = readPrimaryOrAliasEnv(env, 'SEATBELT_RELAY_VERCEL_TOKEN', 'VERCEL_TOKEN');
  const projectId = readPrimaryOrAliasEnv(
    env,
    'SEATBELT_RELAY_VERCEL_PROJECT_ID',
    'VERCEL_PROJECT_ID',
  );
  const orgId = readPrimaryOrAliasEnv(env, 'SEATBELT_RELAY_VERCEL_ORG_ID', 'VERCEL_ORG_ID');

  const missing: string[] = [];

  if (!token) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_TOKEN', 'VERCEL_TOKEN'));
  }

  if (!projectId) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_PROJECT_ID', 'VERCEL_PROJECT_ID'));
  }

  if (!orgId) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_ORG_ID', 'VERCEL_ORG_ID'));
  }

  if (missing.length > 0) {
    throw new Error(
      `Relay publish is missing required environment variables: ${missing.join(', ')}.`,
    );
  }

  if (!token || !projectId || !orgId) {
    throw new Error('Relay Vercel env validation failed unexpectedly.');
  }

  return {
    token,
    projectId,
    orgId,
  };
}

function appendPathToUrl(baseUrl: string, relativePath: string): string {
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}${relativePath}`;
  }

  return `${baseUrl}/${relativePath}`;
}

function toDeploymentUrl(value: string): string {
  if (value.startsWith('https://') || value.startsWith('http://')) {
    return value;
  }

  return `https://${value}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPublishLandingPage(logEntry: RelayPublishLogEntry): string {
  const metadataJson = escapeHtml(JSON.stringify(logEntry, null, 2));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Seatbelt publish artifact</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        margin: 2rem;
        line-height: 1.5;
        background: #0f1117;
        color: #e6edf3;
      }
      a {
        color: #7cc7ff;
      }
      h2 {
        margin-top: 2rem;
        margin-bottom: 0.75rem;
      }
      .muted {
        color: #9aa7b7;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        border-radius: 999px;
        border: 1px solid #2f3b4f;
        padding: 0.25rem 0.6rem;
        font-size: 0.85rem;
        color: #c7d2e1;
        background: #111827;
      }
      .status.error {
        border-color: #5b1f27;
        background: #2a1116;
        color: #fca5a5;
      }
      .panel {
        padding: 1rem;
        border-radius: 0.5rem;
        background: #111827;
        border: 1px solid #1f2937;
      }
      .checks {
        margin: 0.5rem 0 0;
        padding-left: 1.25rem;
      }
      .checks li {
        margin: 0.35rem 0;
      }
      .checks-status {
        font-weight: 700;
        margin-right: 0.35rem;
      }
      pre {
        padding: 1rem;
        border-radius: 0.5rem;
        background: #161b22;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <h1>Seatbelt simulation publish</h1>
    <p>This deployment contains a validated simulation artifact.</p>
    <ul>
      <li><a id="artifact-link" href="./simulation-results.json">simulation-results.json</a></li>
      <li><a href="./publish-metadata.json">publish-metadata.json</a></li>
    </ul>
    <h2>Report preview</h2>
    <p id="report-status" class="status">Loading report…</p>
    <div id="report-preview" class="panel" hidden>
      <h3 id="report-title">Governance simulation report</h3>
      <p id="report-summary" class="muted"></p>
      <h4>Checks</h4>
      <ul id="report-checks" class="checks"></ul>
      <h4>Markdown report</h4>
      <pre id="report-markdown"></pre>
    </div>
    <h2>Publish metadata</h2>
    <pre>${metadataJson}</pre>
    <script>
      (function () {
        function setStatus(message, isError) {
          var statusNode = document.getElementById('report-status');
          if (!statusNode) return;

          statusNode.textContent = message;
          statusNode.className = isError ? 'status error' : 'status';
        }

        function normalizeArtifactUrl(rawValue) {
          var fallback = './simulation-results.json';
          if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
            return fallback;
          }

          try {
            var parsed = new URL(rawValue, window.location.href);
            var pathname = parsed.pathname || '/';

            if (!pathname.endsWith('/simulation-results.json')) {
              pathname = pathname.replace(/\\/+$/, '');
              var lastSegment = pathname.split('/').pop() || '';
              if (lastSegment.indexOf('.') === -1) {
                pathname = pathname + '/simulation-results.json';
              }
            }

            parsed.pathname = pathname;
            parsed.hash = '';
            return parsed.toString();
          } catch (_error) {
            return fallback;
          }
        }

        function readFirstResult(value) {
          if (Array.isArray(value)) {
            return value[0] || null;
          }

          if (value && typeof value === 'object') {
            return value;
          }

          return null;
        }

        function toCheckLabel(check) {
          var status = typeof check.status === 'string' ? check.status.toUpperCase() : 'UNKNOWN';
          var title = typeof check.title === 'string' ? check.title : 'Untitled check';
          return status + ': ' + title;
        }

        async function loadReportPreview() {
          var params = new URLSearchParams(window.location.search);
          var artifactUrl = normalizeArtifactUrl(params.get('artifact'));

          var artifactLink = document.getElementById('artifact-link');
          if (artifactLink) {
            artifactLink.href = artifactUrl;
          }

          setStatus('Loading report…', false);

          var previewNode = document.getElementById('report-preview');
          var titleNode = document.getElementById('report-title');
          var summaryNode = document.getElementById('report-summary');
          var checksNode = document.getElementById('report-checks');
          var markdownNode = document.getElementById('report-markdown');

          try {
            var response = await fetch(artifactUrl, { cache: 'no-store' });
            if (!response.ok) {
              throw new Error('Artifact request failed (HTTP ' + response.status + ')');
            }

            var payload = await response.json();
            var firstResult = readFirstResult(payload);
            if (!firstResult || typeof firstResult !== 'object') {
              throw new Error('Artifact payload is not a simulation-results object');
            }

            var report = firstResult.report && typeof firstResult.report === 'object' ? firstResult.report : {};
            var structuredReport =
              report.structuredReport && typeof report.structuredReport === 'object'
                ? report.structuredReport
                : {};

            var title =
              typeof structuredReport.title === 'string' && structuredReport.title
                ? structuredReport.title
                : 'Governance simulation report';
            var summary =
              typeof structuredReport.summary === 'string'
                ? structuredReport.summary
                : typeof report.summary === 'string'
                  ? report.summary
                  : 'No summary available.';
            var markdown =
              typeof report.markdownReport === 'string' && report.markdownReport.length > 0
                ? report.markdownReport
                : 'Markdown report not available.';

            var checks = Array.isArray(structuredReport.checks) ? structuredReport.checks : [];

            if (titleNode) {
              titleNode.textContent = title;
            }

            if (summaryNode) {
              summaryNode.textContent = summary;
            }

            if (markdownNode) {
              markdownNode.textContent = markdown;
            }

            if (checksNode) {
              checksNode.innerHTML = '';
              if (checks.length === 0) {
                var emptyItem = document.createElement('li');
                emptyItem.textContent = 'No checks found in this report.';
                checksNode.appendChild(emptyItem);
              } else {
                for (var i = 0; i < checks.length; i += 1) {
                  var check = checks[i];
                  var item = document.createElement('li');
                  var label = toCheckLabel(check || {});
                  item.textContent = label;
                  checksNode.appendChild(item);
                }
              }
            }

            if (previewNode) {
              previewNode.hidden = false;
            }

            setStatus('Loaded report preview from artifact.', false);
          } catch (error) {
            setStatus(
              error instanceof Error ? error.message : 'Failed to load report preview from artifact.',
              true,
            );
          }
        }

        loadReportPreview();
      })();
    </script>
  </body>
</html>
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return undefined;
}

function summarizeErrorPayload(value: unknown): string {
  if (!isRecord(value)) {
    return '(non-JSON error payload)';
  }

  const errorCode = readOptionalString(value, 'error');
  const message = readOptionalString(value, 'message');

  if (errorCode && message) {
    return `${errorCode}: ${message}`;
  }

  if (message) {
    return message;
  }

  if (errorCode) {
    return errorCode;
  }

  return JSON.stringify(value);
}

function toPublishAliasHostname(publishId: string): string {
  const normalized = publishId.trim().toLowerCase();
  return `a-${normalized}.${PUBLISH_ALIAS_BASE_DOMAIN}`;
}

function buildDeploymentRequestBody(input: {
  projectId: string;
  publishLogEntry: RelayPublishLogEntry;
  artifactRaw: string;
}): OpenJsonObject {
  return {
    name: 'seatbelt-publish',
    project: input.projectId,
    target: 'production',
    files: [
      {
        file: 'simulation-results.json',
        data: input.artifactRaw,
      },
      {
        file: 'publish-metadata.json',
        data: `${JSON.stringify(input.publishLogEntry, null, 2)}\n`,
      },
      {
        file: 'index.html',
        data: buildPublishLandingPage(input.publishLogEntry),
      },
      {
        file: 'vercel.json',
        // Force static-file deployment even if the target Vercel project has a framework preset.
        data: `${JSON.stringify({ framework: null }, null, 2)}\n`,
      },
    ],
  };
}

async function createDeployment(input: {
  artifactRaw: string;
  publishLogEntry: RelayPublishLogEntry;
  vercelEnv: VercelPublishEnv;
}): Promise<CreatedDeployment> {
  const url = `${VERCEL_API_BASE_URL}/v13/deployments?teamId=${encodeURIComponent(input.vercelEnv.orgId)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.vercelEnv.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(
      buildDeploymentRequestBody({
        projectId: input.vercelEnv.projectId,
        publishLogEntry: input.publishLogEntry,
        artifactRaw: input.artifactRaw,
      }),
    ),
  });

  const responseText = await response.text();

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseText) as unknown;
  } catch {
    parsedBody = undefined;
  }

  if (!response.ok) {
    throw new Error(
      `Vercel deployment API request failed with HTTP ${response.status}. ${summarizeErrorPayload(parsedBody)}`,
    );
  }

  if (!isRecord(parsedBody)) {
    throw new Error('Vercel deployment API returned a non-object response.');
  }

  const deploymentUrl = readOptionalString(parsedBody, 'url');
  if (!deploymentUrl) {
    throw new Error('Vercel deployment API response was missing deployment url.');
  }

  const deploymentId =
    readOptionalString(parsedBody, 'id') ?? readOptionalString(parsedBody, 'uid');
  if (!deploymentId) {
    throw new Error('Vercel deployment API response was missing deployment id.');
  }

  return {
    id: deploymentId,
    deploymentUrl: toDeploymentUrl(deploymentUrl),
  };
}

async function createPublishAlias(input: {
  deploymentId: string;
  publishId: string;
  vercelEnv: VercelPublishEnv;
}): Promise<string> {
  const aliasHostname = toPublishAliasHostname(input.publishId);
  const url = `${VERCEL_API_BASE_URL}/v2/deployments/${encodeURIComponent(input.deploymentId)}/aliases?teamId=${encodeURIComponent(input.vercelEnv.orgId)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.vercelEnv.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      alias: aliasHostname,
    }),
  });

  if (response.status === 409) {
    return `https://${aliasHostname}`;
  }

  if (!response.ok) {
    const responseText = await response.text();

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(responseText) as unknown;
    } catch {
      parsedBody = undefined;
    }

    throw new Error(
      `Vercel alias API request failed with HTTP ${response.status}. ${summarizeErrorPayload(parsedBody)}`,
    );
  }

  return `https://${aliasHostname}`;
}

export async function publishViaVercelApi(
  input: RuntimePublisherInput,
): Promise<RelayPublisherResult> {
  const vercelEnv = readManagedVercelEnv(input.env);

  const deployment = await createDeployment({
    artifactRaw: input.artifactRaw,
    publishLogEntry: input.publishLogEntry,
    vercelEnv,
  });

  let artifactBaseUrl = deployment.deploymentUrl;
  try {
    artifactBaseUrl = await createPublishAlias({
      deploymentId: deployment.id,
      publishId: input.publishLogEntry.publish_id,
      vercelEnv,
    });
  } catch (error) {
    console.warn(
      `[relay] alias creation failed for publish_id=${input.publishLogEntry.publish_id}; falling back to deployment URL`,
      error,
    );
  }

  return {
    deploymentUrl: deployment.deploymentUrl,
    artifactUrl: appendPathToUrl(artifactBaseUrl, 'simulation-results.json'),
    metadataUrl: appendPathToUrl(artifactBaseUrl, 'publish-metadata.json'),
  };
}
