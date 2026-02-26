import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { worldchain, xLayer, zora } from 'viem/chains';

function seedRpcEnv(): void {
  process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
  process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
  process.env.ETHERSCAN_API_KEY ??= 'test-key';
}

function uniqueAddress(seed: number): `0x${string}` {
  const value = BigInt(seed).toString(16).padStart(40, '0');
  return getAddress(`0x${value}`);
}

function toFetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

function sourcifyNotFoundResponse(chainId: number, address: string): Response {
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

function setMockFetch(mockFetch: typeof fetch): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe('verification backend provider mapping', () => {
  test('maps Zora to Blockscout and XLayer/Worldchain to Sourcify-only', async () => {
    seedRpcEnv();

    const { VerificationBackend, getChainConfig } = await import('../utils/clients/client');

    expect(getChainConfig(zora.id).verification?.backend).toBe(VerificationBackend.Blockscout);
    expect(getChainConfig(worldchain.id).verification?.backend).toBe(
      VerificationBackend.SourcifyOnly,
    );
    expect(getChainConfig(xLayer.id).verification?.backend).toBe(VerificationBackend.SourcifyOnly);
  });

  test('does not call unsupported explorer APIs for Sourcify-only chains', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const address = uniqueAddress(11);
    const chainId = xLayer.id;

    let sourcifyCalls = 0;
    let nonSourcifyCalls = 0;

    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        sourcifyCalls += 1;
        return sourcifyNotFoundResponse(chainId, address);
      }

      nonSourcifyCalls += 1;
      throw new Error(`Unexpected non-Sourcify call: ${url.toString()}`);
    });

    const originalSetVerificationInFile = CacheManager.setVerificationInFile;
    CacheManager.setVerificationInFile = () => {};

    try {
      BlockExplorerFactory.clear();
      const result = await BlockExplorerFactory.getContractVerification(address, chainId);

      expect(result.status).toBe('unverified');
      expect(result.source).toBe('none');
      expect(result.reason).toContain('Sourcify only');
      expect(sourcifyCalls).toBeGreaterThan(0);
      expect(nonSourcifyCalls).toBe(0);

      const sourcifyCallsAfterFirstCheck = sourcifyCalls;
      BlockExplorerFactory.clear();

      const cachedResult = await BlockExplorerFactory.getContractVerification(address, chainId);
      expect(cachedResult.status).toBe('unverified');
      expect(cachedResult.source).toBe('none');
      expect(sourcifyCalls).toBe(sourcifyCallsAfterFirstCheck);
    } finally {
      restoreFetch();
      CacheManager.setVerificationInFile = originalSetVerificationInFile;
    }
  });

  test('ignores stale cache entries written with a different verification backend', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const address = uniqueAddress(1024);
    const chainId = zora.id;

    BlockExplorerFactory.clear();
    CacheManager.setVerificationEntryInMemory(chainId, address, {
      schemaVersion: 2,
      verified: true,
      source: 'block-explorer',
      verificationBackend: 'etherscan-v2',
      blockExplorer: { name: 'Etherscan', verified: true },
      timestamp: Date.now(),
    });

    let blockscoutCalls = 0;

    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        return sourcifyNotFoundResponse(chainId, address);
      }

      if (url.toString().includes('explorer.zora.energy/api/v2/smart-contracts')) {
        blockscoutCalls += 1;
        return new Response(
          JSON.stringify({ is_verified: false, is_partially_verified: false, abi: null }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    });

    const originalSetVerificationInFile = CacheManager.setVerificationInFile;
    CacheManager.setVerificationInFile = () => {};

    try {
      const result = await BlockExplorerFactory.getContractVerification(address, chainId);

      expect(result.status).toBe('unverified');
      expect(result.source).toBe('none');
      expect(blockscoutCalls).toBeGreaterThan(0);
    } finally {
      restoreFetch();
      CacheManager.setVerificationInFile = originalSetVerificationInFile;
    }
  });

  test('uses Blockscout backend for Zora instead of Etherscan v2', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const address = uniqueAddress(12);
    const chainId = zora.id;

    let blockscoutCalls = 0;
    let etherscanCalls = 0;

    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        return sourcifyNotFoundResponse(chainId, address);
      }

      if (url.toString().includes('explorer.zora.energy/api/v2/smart-contracts')) {
        blockscoutCalls += 1;
        return new Response(
          JSON.stringify({
            is_verified: true,
            is_partially_verified: false,
            abi: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.hostname === 'api.etherscan.io') {
        etherscanCalls += 1;
      }

      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    });

    const originalSetVerificationInFile = CacheManager.setVerificationInFile;
    CacheManager.setVerificationInFile = () => {};

    try {
      BlockExplorerFactory.clear();
      const result = await BlockExplorerFactory.getContractVerification(address, chainId);

      expect(result.status).toBe('verified');
      expect(result.source).toBe('block-explorer');
      expect(blockscoutCalls).toBeGreaterThan(0);
      expect(etherscanCalls).toBe(0);
    } finally {
      restoreFetch();
      CacheManager.setVerificationInFile = originalSetVerificationInFile;
    }
  });
});
