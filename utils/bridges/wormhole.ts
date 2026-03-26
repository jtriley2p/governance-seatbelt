import { decodeFunctionData, getAddress, isHex, parseAbi, slice, toFunctionSelector } from 'viem';
import type { CrossChainExecutionCall, CrossChainExecutionJob } from '../../types.d';
import {
  getAllSupportedWormholeSenderTargets,
  getWormholeLaneByChainId,
} from './wormhole-support';

export const WORMHOLE_SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);

const WORMHOLE_SEND_MESSAGE_SELECTOR = toFunctionSelector(
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
);

const KNOWN_WORMHOLE_SENDER_TARGETS = new Set(
  getAllSupportedWormholeSenderTargets().map((target) => target.toLowerCase()),
);

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
  wormholeChainId: number;
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
  const lane = getWormholeLaneByChainId(wormholeChainId);
  if (!lane) return null;

  return {
    destinationChainId: lane.destinationChainId,
    l2FromAddress: lane.l2FromAddress,
    wormholeChainId,
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
 * Current coverage: BNB (4), Polygon (5), Avalanche (6), Celo (14), Monad (48), and Tempo (68).
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
      wormholeChainId: batch.wormholeChainId,
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

export function getWormholeReceiverCoreAddressForChain(
  wormholeChainId: number | undefined,
): `0x${string}` | null {
  if (wormholeChainId === undefined) return null;
  return getWormholeLaneByChainId(wormholeChainId)?.wormholeReceiverCoreAddress ?? null;
}
