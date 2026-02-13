import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRelayFetchHandler } from './server.js';
import { publishViaVercelApi } from './vercel-runtime-publisher.js';

type RelayApiRequest = IncomingMessage & {
  body?: unknown;
};

const relayFetchHandler = createRelayFetchHandler({
  dependencies: {
    publisher: publishViaVercelApi,
  },
});

function readFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }

  return undefined;
}

function toRequestHeaders(req: RelayApiRequest): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (name.toLowerCase() === 'content-length') {
      continue;
    }

    const firstValue = readFirstHeaderValue(value);
    if (firstValue) {
      headers.set(name, firstValue);
    }
  }

  return headers;
}

async function readRawBody(req: RelayApiRequest): Promise<string> {
  if (typeof req.body === 'string') {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }

  if (req.body instanceof Uint8Array) {
    return Buffer.from(req.body).toString('utf8');
  }

  if (typeof req.body !== 'undefined') {
    return JSON.stringify(req.body);
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }

    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function isRequestWithNoBody(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

function buildRequestUrl(req: RelayApiRequest): string {
  const protocol = readFirstHeaderValue(req.headers['x-forwarded-proto']) ?? 'https';
  const host =
    readFirstHeaderValue(req.headers['x-forwarded-host']) ??
    readFirstHeaderValue(req.headers.host) ??
    'localhost';
  const path = req.url ?? '/';

  return `${protocol}://${host}${path}`;
}

async function toFetchRequest(req: RelayApiRequest): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();

  if (isRequestWithNoBody(method)) {
    return new Request(buildRequestUrl(req), {
      method,
      headers: toRequestHeaders(req),
    });
  }

  const rawBody = await readRawBody(req);

  return new Request(buildRequestUrl(req), {
    method,
    headers: toRequestHeaders(req),
    body: rawBody,
  });
}

async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const responseBytes = Buffer.from(await response.arrayBuffer());
  res.end(responseBytes);
}

export default async function relayApiHandler(
  req: RelayApiRequest,
  res: ServerResponse,
): Promise<void> {
  try {
    const fetchRequest = await toFetchRequest(req);
    const fetchResponse = await relayFetchHandler(fetchRequest);
    await writeFetchResponse(res, fetchResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown relay runtime error';

    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'relay_runtime_error',
        message,
      }),
    );
  }
}
