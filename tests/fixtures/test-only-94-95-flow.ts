import type { Address } from 'viem';
import { celo } from 'viem/chains';
import {
  TEST_ONLY_CELO_PRE_94_OWNER,
  buildTestOnlyWormholeLaneState,
} from './test-only-wormhole-lane-state';

type SeededStateObjects = Record<
  number,
  Record<string, { code?: string; balance?: string; storage?: Record<string, string> }>
>;

export function build94To95TestOnlyCeloState(targets: readonly Address[]): SeededStateObjects {
  return buildTestOnlyWormholeLaneState(celo.id, TEST_ONLY_CELO_PRE_94_OWNER, targets);
}
