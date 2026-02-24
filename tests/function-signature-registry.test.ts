import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  clearFunctionSignatureRegistryCache,
  lookupFunctionSignatureBySelector,
} from '../utils/clients/function-signature-registry';

describe('function signature registry client (4byte)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearFunctionSignatureRegistryCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns decoded signature from a valid 4byte response', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          count: 1,
          results: [
            {
              text_signature: 'setOwner(address)',
              hex_signature: '0x13af4035',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch;

    const signature = await lookupFunctionSignatureBySelector('0x13af4035');
    expect(signature).toBe('setOwner(address)');
  });

  it('returns null for empty result sets', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          count: 0,
          results: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch;

    const signature = await lookupFunctionSignatureBySelector('0x13af4035');
    expect(signature).toBeNull();
  });

  it('returns null on non-ok status and invalid payloads', async () => {
    globalThis.fetch = (async () =>
      new Response('error', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(lookupFunctionSignatureBySelector('0x13af4035')).resolves.toBeNull();

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ not_results: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(lookupFunctionSignatureBySelector('0xa9059cbb')).resolves.toBeNull();
  });

  it('caches successful and null lookups', async () => {
    let successFetchCount = 0;
    globalThis.fetch = (async () => {
      successFetchCount += 1;
      return new Response(
        JSON.stringify({
          count: 1,
          results: [{ text_signature: 'setOwner(address)', hex_signature: '0x13af4035' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    await expect(lookupFunctionSignatureBySelector('0x13af4035')).resolves.toBe(
      'setOwner(address)',
    );
    await expect(lookupFunctionSignatureBySelector('0x13af4035')).resolves.toBe(
      'setOwner(address)',
    );
    expect(successFetchCount).toBe(1);

    clearFunctionSignatureRegistryCache();

    let missFetchCount = 0;
    globalThis.fetch = (async () => {
      missFetchCount += 1;
      return new Response(
        JSON.stringify({
          count: 0,
          results: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    await expect(lookupFunctionSignatureBySelector('0xa9059cbb')).resolves.toBeNull();
    await expect(lookupFunctionSignatureBySelector('0xa9059cbb')).resolves.toBeNull();
    expect(missFetchCount).toBe(1);
  });

  it('deduplicates concurrent lookups for the same selector', async () => {
    let fetchCount = 0;
    let release: (() => void) | undefined;
    const waitForRelease = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    globalThis.fetch = (async () => {
      fetchCount += 1;
      await waitForRelease;
      return new Response(
        JSON.stringify({
          count: 1,
          results: [{ text_signature: 'setOwner(address)', hex_signature: '0x13af4035' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const first = lookupFunctionSignatureBySelector('0x13af4035');
    const second = lookupFunctionSignatureBySelector('0x13af4035');
    release?.();

    await expect(first).resolves.toBe('setOwner(address)');
    await expect(second).resolves.toBe('setOwner(address)');
    expect(fetchCount).toBe(1);
  });

  it('selects deterministically when multiple valid signatures share a selector', async () => {
    // Real collision pair discovered locally for selector 0x0dd521bb.
    const selector = '0x0dd521bb';
    const longCandidate = 'fnzvnqqzv(uint256,bytes32,bool)';
    const shortCandidate = 'fwqdlhzfl(bool)';

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          count: 3,
          results: [
            { text_signature: longCandidate, hex_signature: selector },
            { text_signature: 'transfer(address,uint256)', hex_signature: '0xa9059cbb' },
            { text_signature: shortCandidate, hex_signature: selector },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch;

    const first = await lookupFunctionSignatureBySelector(selector);
    expect(first).toBe(shortCandidate);

    clearFunctionSignatureRegistryCache();

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          count: 2,
          results: [
            { text_signature: shortCandidate, hex_signature: selector },
            { text_signature: longCandidate, hex_signature: selector },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch;

    const second = await lookupFunctionSignatureBySelector(selector);
    expect(second).toBe(shortCandidate);
  });
});
