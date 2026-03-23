import { getAddress } from 'viem';

export function seedRpcEnv(): void {
  process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
  process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
  process.env.ETHERSCAN_API_KEY ??= 'test-key';
}

export function uniqueAddress(seed: number): `0x${string}` {
  const value = BigInt(seed).toString(16).padStart(40, '0');
  return getAddress(`0x${value}`);
}

export function toFetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

export function sourcifyNotFoundResponse(chainId: number, address: string): Response {
  return new Response(
    JSON.stringify({
      match: null,
      creationMatch: null,
      runtimeMatch: null,
      chainId: String(chainId),
      address,
    }),
    {
      status: 404,
      headers: { 'content-type': 'application/json' },
    },
  );
}

export function setMockFetch(mockFetch: typeof fetch): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
