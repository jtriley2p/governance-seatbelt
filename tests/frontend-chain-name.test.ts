import { describe, expect, test } from 'bun:test';
import { resolveChainName } from '../frontend/src/components/structured-report/chain-name';

describe('frontend resolveChainName', () => {
  test('prefers provided non-generic names', () => {
    expect(resolveChainName(42161, 'Arbitrum One')).toBe('Arbitrum One');
  });

  test('falls back to generic chain label when provided name is generic', () => {
    expect(resolveChainName(42161, 'Chain 42161')).toBe('Chain 42161');
  });

  test('falls back to generic chain label when name is missing', () => {
    expect(resolveChainName(8453)).toBe('Chain 8453');
  });
});
