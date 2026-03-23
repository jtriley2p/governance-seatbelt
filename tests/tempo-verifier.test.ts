import { describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';
import { CacheManager } from '../utils/clients/block-explorers/cache';
import { TempoExplorer } from '../utils/clients/block-explorers/tempo';

function toFetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

describe('Tempo verifier explorer', () => {
  test('treats contract_not_found as unverified instead of an API failure', async () => {
    const originalFetch = globalThis.fetch;
    const explorer = new TempoExplorer();
    const address = getAddress('0x0000000000000000000000000000000000000042');

    globalThis.fetch = (async (input) => {
      const url = toFetchUrl(input);
      expect(url.hostname).toBe('contracts.tempo.xyz');
      return new Response(
        JSON.stringify({
          customCode: 'contract_not_found',
          message: `Contract ${address} on chain 4217 not found or not verified`,
          errorId: 'tempo-test',
        }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      await expect(explorer.isContractVerified(address, 4217, { skipCache: true })).resolves.toBe(
        false,
      );
      await expect(explorer.fetchContractAbi(address, 4217)).resolves.toBeNull();
      await expect(explorer.fetchContractName(address, 4217)).resolves.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ignores stale verification cache entries written for a different backend', async () => {
    const originalFetch = globalThis.fetch;
    const explorer = new TempoExplorer();
    const address = getAddress('0x0000000000000000000000000000000000000043');
    const cachePath = join(process.cwd(), 'cache', 'verification', `4217-${address}.json`);
    let tempoCalls = 0;

    CacheManager.clearMemory();
    if (existsSync(cachePath)) unlinkSync(cachePath);
    CacheManager.setVerificationEntryInMemory(4217, address, {
      schemaVersion: 2,
      verified: false,
      source: 'none',
      verificationBackend: 'sourcify-only',
      timestamp: Date.now(),
    });

    globalThis.fetch = (async (input) => {
      const url = toFetchUrl(input);
      expect(url.hostname).toBe('contracts.tempo.xyz');
      tempoCalls += 1;
      return new Response(
        JSON.stringify({
          match: 'exact_match',
          creationMatch: 'match',
          runtimeMatch: 'exact_match',
          chainId: '4217',
          address,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      await expect(explorer.isContractVerified(address, 4217)).resolves.toBe(true);
      expect(tempoCalls).toBe(1);
    } finally {
      CacheManager.clearMemory();
      if (existsSync(cachePath)) unlinkSync(cachePath);
      globalThis.fetch = originalFetch;
    }
  });
});
