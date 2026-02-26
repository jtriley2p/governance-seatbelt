import { describe, expect, test } from 'bun:test';
import { resolveChainName as resolveFrontendChainName } from '../frontend/src/components/structured-report/chain-name';
import { getChainName } from '../utils/chains/capabilities';
import { CANONICAL_CHAIN_NAMES } from '../utils/chains/chain-name';

describe('frontend/backend chain-name parity', () => {
  test('uses the same canonical chain names for known chain IDs', () => {
    for (const [chainIdKey, canonicalName] of Object.entries(CANONICAL_CHAIN_NAMES)) {
      const chainId = Number(chainIdKey);

      expect(getChainName(chainId)).toBe(canonicalName);
      expect(resolveFrontendChainName(chainId)).toBe(canonicalName);
      expect(resolveFrontendChainName(chainId, `Chain ${chainId}`)).toBe(canonicalName);
    }
  });

  test('shares unknown-chain fallback label', () => {
    const unknownChainId = 999_999_999;
    const fallbackLabel = `Chain ${unknownChainId}`;

    expect(getChainName(unknownChainId)).toBe(fallbackLabel);
    expect(resolveFrontendChainName(unknownChainId)).toBe(fallbackLabel);
    expect(resolveFrontendChainName(unknownChainId, fallbackLabel)).toBe(fallbackLabel);
  });
});
