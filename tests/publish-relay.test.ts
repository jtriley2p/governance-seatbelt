import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRelayFetchHandler } from '../relay/server';

type JsonObject = Record<string, unknown>;

function fixturePath(name: string): string {
  return join(__dirname, 'fixtures', 'upload', name);
}

function loadFixture(name: string): unknown {
  const raw = readFileSync(fixturePath(name), 'utf8');
  return JSON.parse(raw) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field: ${field}`);
  }
  return value;
}

async function readJsonResponse(response: Response): Promise<JsonObject> {
  const body = (await response.json()) as unknown;
  if (!isRecord(body)) {
    throw new Error('Expected JSON object response');
  }

  return body;
}

describe('managed publish relay endpoints', () => {
  it('serves health endpoint', async () => {
    const handler = createRelayFetchHandler({
      config: {
        rateLimitEnabled: false,
      },
      dependencies: {
        publisher: async () => ({
          deploymentUrl: 'https://unused-health-check.vercel.app',
          artifactUrl: 'https://unused-health-check.vercel.app/simulation-results.json',
          metadataUrl: 'https://unused-health-check.vercel.app/publish-metadata.json',
        }),
      },
    });

    const response = await handler(new Request('http://relay.local/api/v1/health'));
    expect(response.status).toBe(200);

    const json = await readJsonResponse(response);
    expect(json.ok).toBe(true);
    expect(json.service).toBe('seatbelt-managed-publish-relay');
  });

  it('publishes a valid artifact and returns deployment urls', async () => {
    let publishCallCount = 0;

    const handler = createRelayFetchHandler({
      config: {
        rateLimitEnabled: false,
      },
      dependencies: {
        publisher: async () => {
          publishCallCount += 1;
          return {
            deploymentUrl: 'https://seatbelt-managed-publish.vercel.app',
            artifactUrl: 'https://seatbelt-managed-publish.vercel.app/simulation-results.json',
            metadataUrl: 'https://seatbelt-managed-publish.vercel.app/publish-metadata.json',
          };
        },
      },
    });

    const response = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'publish-key-1',
          'x-forwarded-for': '203.0.113.11',
        },
        body: JSON.stringify({
          artifact: loadFixture('simulation-results.proposed.json'),
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(publishCallCount).toBe(1);

    const json = await readJsonResponse(response);

    expect(readStringField(json, 'publishId').length).toBeGreaterThan(0);
    expect(readStringField(json, 'idempotencyKey')).toBe('publish-key-1');
    expect(readStringField(json, 'artifactHash').length).toBe(64);
    expect(readStringField(json, 'deploymentUrl')).toBe(
      'https://seatbelt-managed-publish.vercel.app',
    );
    expect(readStringField(json, 'artifactUrl')).toContain('simulation-results.json');
    expect(readStringField(json, 'metadataUrl')).toContain('publish-metadata.json');
  });

  it('revalidates artifact payload and blocks invalid contracts', async () => {
    let publishCallCount = 0;

    const handler = createRelayFetchHandler({
      config: {
        rateLimitEnabled: false,
      },
      dependencies: {
        publisher: async () => {
          publishCallCount += 1;
          return {
            deploymentUrl: 'https://should-not-run.vercel.app',
            artifactUrl: 'https://should-not-run.vercel.app/simulation-results.json',
            metadataUrl: 'https://should-not-run.vercel.app/publish-metadata.json',
          };
        },
      },
    });

    const response = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.12',
        },
        body: JSON.stringify({
          artifact: loadFixture('simulation-results.invalid.missing-schema-version.json'),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(publishCallCount).toBe(0);

    const json = await readJsonResponse(response);
    expect(readStringField(json, 'error')).toBe('artifact_validation_failed');
    expect(readStringField(json, 'message')).toContain('schemaVersion');
  });

  it('enforces payload size cap', async () => {
    const handler = createRelayFetchHandler({
      config: {
        maxBodyBytes: 64,
        rateLimitEnabled: false,
      },
      dependencies: {
        publisher: async () => ({
          deploymentUrl: 'https://should-not-run.vercel.app',
          artifactUrl: 'https://should-not-run.vercel.app/simulation-results.json',
          metadataUrl: 'https://should-not-run.vercel.app/publish-metadata.json',
        }),
      },
    });

    const response = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '100',
          'x-forwarded-for': '203.0.113.13',
        },
        body: JSON.stringify({
          artifact: loadFixture('simulation-results.proposed.json'),
        }),
      }),
    );

    expect(response.status).toBe(413);
    const json = await readJsonResponse(response);
    expect(readStringField(json, 'error')).toBe('payload_too_large');
  });

  it('enforces simple rate limit when enabled', async () => {
    let publishCallCount = 0;

    const handler = createRelayFetchHandler({
      config: {
        rateLimitEnabled: true,
        rateLimitMaxRequests: 1,
        rateLimitWindowMs: 60_000,
      },
      dependencies: {
        publisher: async () => {
          publishCallCount += 1;
          return {
            deploymentUrl: 'https://seatbelt-rate-limit.vercel.app',
            artifactUrl: 'https://seatbelt-rate-limit.vercel.app/simulation-results.json',
            metadataUrl: 'https://seatbelt-rate-limit.vercel.app/publish-metadata.json',
          };
        },
      },
    });

    const firstResponse = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.4',
          'idempotency-key': 'rate-limit-first',
        },
        body: JSON.stringify({ artifact: loadFixture('simulation-results.proposed.json') }),
      }),
    );

    const secondResponse = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.4',
          'idempotency-key': 'rate-limit-second',
        },
        body: JSON.stringify({ artifact: loadFixture('simulation-results.new.json') }),
      }),
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(429);
    expect(publishCallCount).toBe(1);
  });

  it('deduplicates duplicate idempotency keys in a single relay instance', async () => {
    let publishCallCount = 0;

    const handler = createRelayFetchHandler({
      config: {
        rateLimitEnabled: false,
      },
      dependencies: {
        publisher: async () => {
          publishCallCount += 1;
          return {
            deploymentUrl: 'https://seatbelt-idempotent.vercel.app',
            artifactUrl: 'https://seatbelt-idempotent.vercel.app/simulation-results.json',
            metadataUrl: 'https://seatbelt-idempotent.vercel.app/publish-metadata.json',
          };
        },
      },
    });

    const requestBody = JSON.stringify({
      artifact: loadFixture('simulation-results.proposed.json'),
    });

    const firstResponse = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'same-key',
          'x-forwarded-for': '192.0.2.3',
        },
        body: requestBody,
      }),
    );

    const secondResponse = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'same-key',
          'x-forwarded-for': '192.0.2.3',
        },
        body: requestBody,
      }),
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(secondResponse.headers.get('x-idempotent-replay')).toBe('true');
    expect(publishCallCount).toBe(1);

    const firstJson = await readJsonResponse(firstResponse);
    const secondJson = await readJsonResponse(secondResponse);

    expect(readStringField(secondJson, 'publishId')).toBe(readStringField(firstJson, 'publishId'));
    expect(readStringField(secondJson, 'deploymentUrl')).toBe(
      readStringField(firstJson, 'deploymentUrl'),
    );
  });

  it('returns conflict for duplicate idempotency key with different artifact hash', async () => {
    let publishCallCount = 0;

    const handler = createRelayFetchHandler({
      config: {
        rateLimitEnabled: false,
      },
      dependencies: {
        publisher: async () => {
          publishCallCount += 1;
          return {
            deploymentUrl: 'https://seatbelt-idempotent-conflict.vercel.app',
            artifactUrl: 'https://seatbelt-idempotent-conflict.vercel.app/simulation-results.json',
            metadataUrl: 'https://seatbelt-idempotent-conflict.vercel.app/publish-metadata.json',
          };
        },
      },
    });

    const firstResponse = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'conflict-key',
          'x-forwarded-for': '192.0.2.4',
        },
        body: JSON.stringify({
          artifact: loadFixture('simulation-results.proposed.json'),
        }),
      }),
    );

    const secondResponse = await handler(
      new Request('http://relay.local/api/v1/publishes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'conflict-key',
          'x-forwarded-for': '192.0.2.4',
        },
        body: JSON.stringify({
          artifact: loadFixture('simulation-results.new.json'),
        }),
      }),
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(409);
    expect(publishCallCount).toBe(1);

    const secondJson = await readJsonResponse(secondResponse);
    expect(readStringField(secondJson, 'error')).toBe('idempotency_conflict');
  });
});
