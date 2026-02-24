import { describe, expect, it } from 'bun:test';
import { publishViaVercelApi } from '../relay/vercel-runtime-publisher';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('vercel runtime publisher', () => {
  it('forces static framework config in deployment payload and returns clean alias artifact urls', async () => {
    const originalFetch = globalThis.fetch;

    let deploymentRequestBody = '';
    let aliasRequestBody = '';
    const requestedUrls: string[] = [];

    const mockedFetch: typeof fetch = async (input, init) => {
      const requestUrl = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(requestUrl);

      if (requestUrl.includes('/v13/deployments')) {
        if (typeof init?.body === 'string') {
          deploymentRequestBody = init.body;
        }

        return new Response(
          JSON.stringify({ id: 'dpl_123', url: 'seatbelt-publish-example.vercel.app' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes('/v2/deployments/dpl_123/aliases')) {
        if (typeof init?.body === 'string') {
          aliasRequestBody = init.body;
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    globalThis.fetch = mockedFetch;

    try {
      const result = await publishViaVercelApi({
        artifactRaw: '{"ok":true}\n',
        publishLogEntry: {
          publish_id: 'pub-123',
          artifact_hash: 'abc123',
          published_at: '2026-02-17T00:00:00.000Z',
        },
        env: {
          SEATBELT_RELAY_VERCEL_TOKEN: 'token',
          SEATBELT_RELAY_VERCEL_PROJECT_ID: 'project-id',
          SEATBELT_RELAY_VERCEL_ORG_ID: 'team-id',
        },
      });

      expect(result.deploymentUrl).toBe('https://seatbelt-publish-example.vercel.app');
      expect(result.artifactUrl).toBe(
        'https://a-pub-123.publish.scopelift.co/simulation-results.json',
      );
      expect(result.metadataUrl).toBe(
        'https://a-pub-123.publish.scopelift.co/publish-metadata.json',
      );

      const parsedBody: unknown = JSON.parse(deploymentRequestBody);
      if (!isRecord(parsedBody)) {
        throw new Error('Expected deployment request payload to be an object');
      }

      const files = parsedBody.files;
      if (!Array.isArray(files)) {
        throw new Error('Expected deployment request payload to include files');
      }

      const vercelConfigFile = files.find((entry) => {
        if (!isRecord(entry)) {
          return false;
        }

        return entry.file === 'vercel.json';
      });

      if (!isRecord(vercelConfigFile)) {
        throw new Error('Expected deployment request payload to include vercel.json');
      }

      expect(vercelConfigFile.data).toBe('{\n  "framework": null\n}\n');

      const parsedAliasBody: unknown = JSON.parse(aliasRequestBody);
      if (!isRecord(parsedAliasBody)) {
        throw new Error('Expected alias request payload to be an object');
      }

      expect(parsedAliasBody.alias).toBe('a-pub-123.publish.scopelift.co');
      expect(requestedUrls.some((url) => url.includes('/v2/deployments/dpl_123/aliases'))).toBe(
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to deployment urls when alias creation fails', async () => {
    const originalFetch = globalThis.fetch;

    const mockedFetch: typeof fetch = async (input) => {
      const requestUrl = typeof input === 'string' ? input : input.toString();

      if (requestUrl.includes('/v13/deployments')) {
        return new Response(
          JSON.stringify({ id: 'dpl_456', url: 'seatbelt-publish-fallback.vercel.app' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes('/v2/deployments/dpl_456/aliases')) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    globalThis.fetch = mockedFetch;

    try {
      const result = await publishViaVercelApi({
        artifactRaw: '{"ok":true}\n',
        publishLogEntry: {
          publish_id: 'pub-456',
          artifact_hash: 'def456',
          published_at: '2026-02-17T00:00:00.000Z',
        },
        env: {
          SEATBELT_RELAY_VERCEL_TOKEN: 'token',
          SEATBELT_RELAY_VERCEL_PROJECT_ID: 'project-id',
          SEATBELT_RELAY_VERCEL_ORG_ID: 'team-id',
        },
      });

      expect(result.deploymentUrl).toBe('https://seatbelt-publish-fallback.vercel.app');
      expect(result.artifactUrl).toBe(
        'https://seatbelt-publish-fallback.vercel.app/simulation-results.json',
      );
      expect(result.metadataUrl).toBe(
        'https://seatbelt-publish-fallback.vercel.app/publish-metadata.json',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries alias creation when deployment is not ready, then returns branded alias urls', async () => {
    const originalFetch = globalThis.fetch;

    let aliasAttempts = 0;

    const mockedFetch: typeof fetch = async (input) => {
      const requestUrl = typeof input === 'string' ? input : input.toString();

      if (requestUrl.includes('/v13/deployments')) {
        return new Response(
          JSON.stringify({ id: 'dpl_retry', url: 'seatbelt-publish-retry.vercel.app' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes('/v2/deployments/dpl_retry/aliases')) {
        aliasAttempts += 1;

        if (aliasAttempts < 3) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'deployment_not_ready',
                message: 'The deployment `readyState` is not `READY`',
              },
            }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' },
            },
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    globalThis.fetch = mockedFetch;

    try {
      const result = await publishViaVercelApi({
        artifactRaw: '{"ok":true}\n',
        publishLogEntry: {
          publish_id: 'pub-retry',
          artifact_hash: 'retry123',
          published_at: '2026-02-24T00:00:00.000Z',
        },
        env: {
          SEATBELT_RELAY_VERCEL_TOKEN: 'token',
          SEATBELT_RELAY_VERCEL_PROJECT_ID: 'project-id',
          SEATBELT_RELAY_VERCEL_ORG_ID: 'team-id',
        },
        deployTimeoutMs: 1_000,
        aliasRetryBaseMs: 1,
        aliasRetryMaxMs: 1,
      });

      expect(aliasAttempts).toBe(3);
      expect(result.deploymentUrl).toBe('https://seatbelt-publish-retry.vercel.app');
      expect(result.artifactUrl).toBe(
        'https://a-pub-retry.publish.scopelift.co/simulation-results.json',
      );
      expect(result.metadataUrl).toBe(
        'https://a-pub-retry.publish.scopelift.co/publish-metadata.json',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries alias creation on transient 5xx responses, then returns branded alias urls', async () => {
    const originalFetch = globalThis.fetch;

    let aliasAttempts = 0;

    const mockedFetch: typeof fetch = async (input) => {
      const requestUrl = typeof input === 'string' ? input : input.toString();

      if (requestUrl.includes('/v13/deployments')) {
        return new Response(
          JSON.stringify({ id: 'dpl_5xx', url: 'seatbelt-publish-5xx.vercel.app' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes('/v2/deployments/dpl_5xx/aliases')) {
        aliasAttempts += 1;

        if (aliasAttempts < 3) {
          return new Response(JSON.stringify({ error: 'upstream temporarily unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    globalThis.fetch = mockedFetch;

    try {
      const result = await publishViaVercelApi({
        artifactRaw: '{"ok":true}\n',
        publishLogEntry: {
          publish_id: 'pub-5xx',
          artifact_hash: 'fiveexx',
          published_at: '2026-02-24T00:00:00.000Z',
        },
        env: {
          SEATBELT_RELAY_VERCEL_TOKEN: 'token',
          SEATBELT_RELAY_VERCEL_PROJECT_ID: 'project-id',
          SEATBELT_RELAY_VERCEL_ORG_ID: 'team-id',
        },
        deployTimeoutMs: 1_000,
        aliasRetryBaseMs: 1,
        aliasRetryMaxMs: 1,
      });

      expect(aliasAttempts).toBe(3);
      expect(result.deploymentUrl).toBe('https://seatbelt-publish-5xx.vercel.app');
      expect(result.artifactUrl).toBe(
        'https://a-pub-5xx.publish.scopelift.co/simulation-results.json',
      );
      expect(result.metadataUrl).toBe(
        'https://a-pub-5xx.publish.scopelift.co/publish-metadata.json',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries alias creation on transient network errors, then returns branded alias urls', async () => {
    const originalFetch = globalThis.fetch;

    let aliasAttempts = 0;

    const mockedFetch: typeof fetch = async (input) => {
      const requestUrl = typeof input === 'string' ? input : input.toString();

      if (requestUrl.includes('/v13/deployments')) {
        return new Response(
          JSON.stringify({ id: 'dpl_network', url: 'seatbelt-publish-network.vercel.app' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes('/v2/deployments/dpl_network/aliases')) {
        aliasAttempts += 1;

        if (aliasAttempts < 3) {
          throw new TypeError('fetch failed');
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    globalThis.fetch = mockedFetch;

    try {
      const result = await publishViaVercelApi({
        artifactRaw: '{"ok":true}\n',
        publishLogEntry: {
          publish_id: 'pub-network',
          artifact_hash: 'network123',
          published_at: '2026-02-24T00:00:00.000Z',
        },
        env: {
          SEATBELT_RELAY_VERCEL_TOKEN: 'token',
          SEATBELT_RELAY_VERCEL_PROJECT_ID: 'project-id',
          SEATBELT_RELAY_VERCEL_ORG_ID: 'team-id',
        },
        deployTimeoutMs: 1_000,
        aliasRetryBaseMs: 1,
        aliasRetryMaxMs: 1,
      });

      expect(aliasAttempts).toBe(3);
      expect(result.deploymentUrl).toBe('https://seatbelt-publish-network.vercel.app');
      expect(result.artifactUrl).toBe(
        'https://a-pub-network.publish.scopelift.co/simulation-results.json',
      );
      expect(result.metadataUrl).toBe(
        'https://a-pub-network.publish.scopelift.co/publish-metadata.json',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to deployment urls when retryable alias errors persist until retry budget is exhausted', async () => {
    const originalFetch = globalThis.fetch;

    let aliasAttempts = 0;

    const mockedFetch: typeof fetch = async (input) => {
      const requestUrl = typeof input === 'string' ? input : input.toString();

      if (requestUrl.includes('/v13/deployments')) {
        return new Response(
          JSON.stringify({ id: 'dpl_timeout', url: 'seatbelt-publish-timeout.vercel.app' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes('/v2/deployments/dpl_timeout/aliases')) {
        aliasAttempts += 1;
        return new Response(
          JSON.stringify({
            error: {
              code: 'deployment_not_ready',
              message: 'The deployment `readyState` is not `READY`',
            },
          }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    globalThis.fetch = mockedFetch;

    try {
      const result = await publishViaVercelApi({
        artifactRaw: '{"ok":true}\n',
        publishLogEntry: {
          publish_id: 'pub-timeout',
          artifact_hash: 'timeout123',
          published_at: '2026-02-24T00:00:00.000Z',
        },
        env: {
          SEATBELT_RELAY_VERCEL_TOKEN: 'token',
          SEATBELT_RELAY_VERCEL_PROJECT_ID: 'project-id',
          SEATBELT_RELAY_VERCEL_ORG_ID: 'team-id',
        },
        deployTimeoutMs: 20,
        aliasRetryBaseMs: 1,
        aliasRetryMaxMs: 1,
      });

      expect(aliasAttempts).toBeGreaterThan(1);
      expect(result.deploymentUrl).toBe('https://seatbelt-publish-timeout.vercel.app');
      expect(result.artifactUrl).toBe(
        'https://seatbelt-publish-timeout.vercel.app/simulation-results.json',
      );
      expect(result.metadataUrl).toBe(
        'https://seatbelt-publish-timeout.vercel.app/publish-metadata.json',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
