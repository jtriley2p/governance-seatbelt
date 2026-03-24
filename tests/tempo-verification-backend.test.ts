import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempo } from 'viem/chains';
import {
  seedRpcEnv,
  setMockFetch,
  sourcifyNotFoundResponse,
  toFetchUrl,
  uniqueAddress,
} from './helpers/verification-test-helpers';

function getVerificationCachePath(chainId: number, address: string): string {
  return join(process.cwd(), 'cache', 'verification', `${chainId}-${address}.json`);
}

function getAbiCachePath(chainId: number, address: string): string {
  return join(process.cwd(), 'cache', 'abis', `${chainId}-${address}.json`);
}

function getContractNameCachePath(chainId: number, address: string): string {
  return join(process.cwd(), 'cache', 'contract-names', `${chainId}-${address}.json`);
}

describe('Tempo verification backend', () => {
  test('uses Tempo backend for verification, ABI, and contract-name lookups', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');
    const { VerificationBackend } = await import('../utils/clients/client');

    const address = uniqueAddress(4217);
    const chainId = tempo.id;
    const abiCachePath = getAbiCachePath(chainId, address);
    const contractNameCachePath = getContractNameCachePath(chainId, address);

    let minimalCalls = 0;
    let metadataCalls = 0;
    let unexpectedCalls = 0;

    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        return sourcifyNotFoundResponse(chainId, address);
      }

      if (url.hostname === 'contracts.tempo.xyz') {
        if (url.searchParams.get('fields') === 'abi,name') {
          metadataCalls += 1;
          return new Response(
            JSON.stringify({
              match: 'exact_match',
              creationMatch: 'match',
              runtimeMatch: 'exact_match',
              chainId: String(chainId),
              address,
              abi: [],
              name: 'TempoContract',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        }

        minimalCalls += 1;
        return new Response(
          JSON.stringify({
            match: 'exact_match',
            creationMatch: 'match',
            runtimeMatch: 'exact_match',
            chainId: String(chainId),
            address,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      unexpectedCalls += 1;
      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    });

    const originalSetVerificationInFile = CacheManager.setVerificationInFile;
    CacheManager.setVerificationInFile = () => {};

    try {
      CacheManager.clearMemory();
      BlockExplorerFactory.clear();
      if (existsSync(abiCachePath)) unlinkSync(abiCachePath);
      if (existsSync(contractNameCachePath)) unlinkSync(contractNameCachePath);

      const verification = await BlockExplorerFactory.getContractVerification(address, chainId);
      expect(verification.status).toBe('verified');
      expect(verification.source).toBe('block-explorer');
      expect(verification.verificationBackend).toBe(VerificationBackend.Tempo);
      expect(verification.blockExplorer?.name).toBe('Tempo');

      const abi = await BlockExplorerFactory.fetchContractAbi(address, chainId);
      expect(abi).toEqual([]);

      const name = await BlockExplorerFactory.fetchContractName(address, chainId);
      expect(name).toBe('TempoContract');

      expect(minimalCalls).toBe(1);
      expect(metadataCalls).toBe(1);
      expect(unexpectedCalls).toBe(0);
    } finally {
      restoreFetch();
      CacheManager.clearMemory();
      BlockExplorerFactory.clear();
      if (existsSync(abiCachePath)) unlinkSync(abiCachePath);
      if (existsSync(contractNameCachePath)) unlinkSync(contractNameCachePath);
      CacheManager.setVerificationInFile = originalSetVerificationInFile;
    }
  });

  test('ignores stale sourcify-only cache entries after Tempo backend switch', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const address = uniqueAddress(4218);
    const chainId = tempo.id;
    const cachePath = getVerificationCachePath(chainId, address);

    if (existsSync(cachePath)) unlinkSync(cachePath);

    CacheManager.setVerificationEntryInMemory(chainId, address, {
      schemaVersion: 2,
      verified: false,
      source: 'none',
      verificationBackend: 'sourcify-only',
      timestamp: Date.now(),
    });
    writeFileSync(
      cachePath,
      JSON.stringify({
        schemaVersion: 2,
        verified: false,
        source: 'none',
        verificationBackend: 'sourcify-only',
        timestamp: Date.now(),
      }),
    );

    let tempoCalls = 0;
    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        return sourcifyNotFoundResponse(chainId, address);
      }

      if (url.hostname === 'contracts.tempo.xyz') {
        tempoCalls += 1;
        return new Response(
          JSON.stringify({
            match: 'exact_match',
            creationMatch: 'match',
            runtimeMatch: 'exact_match',
            chainId: String(chainId),
            address,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    });

    try {
      const result = await BlockExplorerFactory.getContractVerification(address, chainId);
      expect(result.status).toBe('verified');
      expect(tempoCalls).toBeGreaterThan(0);

      const persisted = JSON.parse(readFileSync(cachePath, 'utf8')) as {
        verificationBackend?: string;
      };
      expect(persisted.verificationBackend).toBe('tempo');
    } finally {
      restoreFetch();
      if (existsSync(cachePath)) unlinkSync(cachePath);
    }
  });

  test('rebuilds cached explorer instances when Tempo backend config changes', async () => {
    seedRpcEnv();

    const { CHAIN_CONFIGS, VerificationBackend } = await import('../utils/clients/client');
    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');

    const originalVerification = CHAIN_CONFIGS[tempo.id].verification;

    try {
      BlockExplorerFactory.clear();
      CHAIN_CONFIGS[tempo.id].verification = {
        backend: VerificationBackend.SourcifyOnly,
        degradedReason: 'test setup',
      };
      expect(BlockExplorerFactory.getExplorer(tempo.id)).toBeNull();

      BlockExplorerFactory.clear();
      CHAIN_CONFIGS[tempo.id].verification = {
        backend: VerificationBackend.Tempo,
        apiUrl: 'https://contracts.tempo.xyz',
      };

      const explorer = BlockExplorerFactory.getExplorer(tempo.id);
      expect(explorer).not.toBeNull();
      expect(explorer?.getName()).toBe('Tempo');
    } finally {
      CHAIN_CONFIGS[tempo.id].verification = originalVerification;
      BlockExplorerFactory.clear();
    }
  });
});
