import { decodeFunctionData, getAddress, isHex, parseAbi, slice, toFunctionSelector } from 'viem';
import { avalanche, bsc, celo, monad, polygon } from 'viem/chains';
import type { CrossChainExecutionCall, CrossChainExecutionJob } from '../../types.d';

export const WORMHOLE_SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);

const WORMHOLE_SEND_MESSAGE_SELECTOR = toFunctionSelector(
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
);

const KNOWN_WORMHOLE_SENDER_TARGETS = new Set([
  // Governor action target used by Uniswap governance for Wormhole handoff messages.
  getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a').toLowerCase(),
]);

type WormholeLaneMetadata = {
  destinationChainId: number;
  l2FromAddress: `0x${string}`;
};

const WORMHOLE_CHAIN_ID_TO_LANE_METADATA: Record<number, WormholeLaneMetadata> = {
  // Live Uniswap governance authority values are sourced from the current destination-chain
  // factory/pool-manager owner fields as of 2026-03-19.
  4: {
    destinationChainId: bsc.id,
    l2FromAddress: getAddress('0x341c1511141022cf8eE20824Ae0fFA3491F1302b'),
  },
  5: {
    destinationChainId: polygon.id,
    l2FromAddress: getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374'),
  },
  6: {
    destinationChainId: avalanche.id,
    l2FromAddress: getAddress('0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc'),
  },
  14: {
    destinationChainId: celo.id,
    l2FromAddress: getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071'),
  },
  48: {
    destinationChainId: monad.id,
    l2FromAddress: getAddress('0xe783de89a7f0408687f051e3e6d0beb62719ebad'),
  },
};

function hasMatchingLengths(
  targets: readonly unknown[],
  values: readonly unknown[],
  datas: readonly unknown[],
): boolean {
  return targets.length === values.length && values.length === datas.length;
}

type WormholeDestinationContext = {
  destinationChainId: number;
  l2FromAddress: `0x${string}`;
};

type WormholeBatch = WormholeDestinationContext & {
  calls: CrossChainExecutionCall[];
};

function normalizeWormholeProposalTarget(target: string): string | null {
  try {
    return getAddress(target).toLowerCase();
  } catch {
    return null;
  }
}

function isKnownWormholeProposalCall(target: string, data: string): boolean {
  if (!isHex(data) || data === '0x' || data.length < 10) {
    return false;
  }

  const normalizedTarget = normalizeWormholeProposalTarget(target);
  if (!normalizedTarget || !KNOWN_WORMHOLE_SENDER_TARGETS.has(normalizedTarget)) {
    return false;
  }

  return slice(data, 0, 4) === WORMHOLE_SEND_MESSAGE_SELECTOR;
}

function resolveWormholeDestinationContext(
  wormholeChainId: number,
): WormholeDestinationContext | null {
  const metadata = WORMHOLE_CHAIN_ID_TO_LANE_METADATA[wormholeChainId];
  if (!metadata) return null;

  return {
    destinationChainId: metadata.destinationChainId,
    l2FromAddress: metadata.l2FromAddress,
  };
}

function toWormholeBatchCalls(
  wormholeTargets: readonly unknown[],
  wormholeValues: readonly unknown[],
  wormholeDatas: readonly unknown[],
): CrossChainExecutionCall[] {
  const calls: CrossChainExecutionCall[] = [];

  for (let index = 0; index < wormholeTargets.length; index += 1) {
    const target = wormholeTargets[index];
    const value = wormholeValues[index];
    const calldata = wormholeDatas[index];

    if (typeof target !== 'string' || typeof value !== 'bigint' || !isHex(calldata)) {
      continue;
    }

    calls.push({
      l2TargetAddress: getAddress(target),
      l2InputData: calldata,
      l2Value: value.toString(),
    });
  }

  return calls;
}

function tryDecodeWormholeBatch(data: string): WormholeBatch | null {
  try {
    if (!isHex(data)) return null;

    const decoded = decodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      data,
    });

    if (decoded.functionName !== 'sendMessage') return null;

    const [wormholeTargets, wormholeValues, wormholeDatas, , wormholeChainId] = decoded.args;

    if (!hasMatchingLengths(wormholeTargets, wormholeValues, wormholeDatas)) {
      return null;
    }

    const context = resolveWormholeDestinationContext(Number(wormholeChainId));
    if (!context) return null;

    return {
      ...context,
      calls: toWormholeBatchCalls(wormholeTargets, wormholeValues, wormholeDatas),
    };
  } catch {
    // Best-effort decode only; ignore malformed calldata and keep scanning.
    return null;
  }
}

/**
 * Extract wormhole destination calls from proposal calldata.
 *
 * Current coverage: BNB (4), Polygon (5), Avalanche (6), Celo (14), and Monad (48).
 */
export function extractWormholeExecutionJobsFromProposal(
  targets: readonly string[],
  calldatas: readonly string[],
): CrossChainExecutionJob[] {
  const jobs: CrossChainExecutionJob[] = [];

  for (let i = 0; i < Math.min(targets.length, calldatas.length); i += 1) {
    const target = targets[i];
    const data = calldatas[i];
    if (!target || !isKnownWormholeProposalCall(target, data)) continue;

    const batch = tryDecodeWormholeBatch(data);
    if (!batch) continue;

    jobs.push({
      bridgeType: 'WormholeL1L2',
      destinationChainId: batch.destinationChainId,
      l2FromAddress: batch.l2FromAddress,
      sourceOrder: i,
      calls: batch.calls,
    });
  }

  if (jobs.length > 0) {
    console.log(
      `[Wormhole Parser] Extracted ${jobs.length} L1->L2 execution job(s) from proposal targets/calldatas.`,
    );
  }

  return jobs;
}
