import { describe, expect, test } from 'bun:test';
import { shouldWriteCanonicalProposalCache } from '../utils/cache/proposalCache';

describe('proposal cache policy', () => {
  test('allows canonical cache writes for normal runs', () => {
    expect(shouldWriteCanonicalProposalCache(undefined)).toBe(true);
  });

  test('disables canonical cache writes for derived runs', () => {
    expect(
      shouldWriteCanonicalProposalCache({
        derivedStateByChain: {
          1: {},
        },
      }),
    ).toBe(false);
  });
});
