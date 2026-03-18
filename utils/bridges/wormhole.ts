import { decodeFunctionData, getAddress, isHex, parseAbi, slice, toFunctionSelector } from 'viem';
import type { ExtractedCrossChainMessage } from '../../types.d';

const WORMHOLE_SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);

const WORMHOLE_SEND_MESSAGE_SELECTOR = toFunctionSelector(
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
);

const KNOWN_WORMHOLE_SENDER_TARGETS = new Set([
  // Governor action target used by Uniswap governance for Wormhole handoff messages.
  getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a').toLowerCase(),
]);

const WORMHOLE_CHAIN_ID_TO_EVM_CHAIN_ID: Record<number, string> = {
  14: '42220', // Celo
};

const WORMHOLE_CHAIN_ID_TO_L2_EXECUTOR: Record<number, string> = {
  // Celo wormhole-owned Uniswap contracts are administered by this executor.
  14: '0x0Eb863541278308c3A64F8E908BC646e27BFD071',
};

function hasMatchingLengths(
  targets: readonly unknown[],
  values: readonly unknown[],
  datas: readonly unknown[],
): boolean {
  return targets.length === values.length && values.length === datas.length;
}

type WormholeDestinationContext = {
  destinationChainId: string;
  l2FromAddress: `0x${string}`;
};

type WormholeBatchCall = {
  l2TargetAddress: `0x${string}`;
  l2InputData: `0x${string}`;
  l2Value: string;
};

type WormholeBatch = WormholeDestinationContext & {
  calls: WormholeBatchCall[];
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
  wormholeAddress: string,
): WormholeDestinationContext | null {
  const destinationChainId = WORMHOLE_CHAIN_ID_TO_EVM_CHAIN_ID[wormholeChainId];
  if (!destinationChainId) return null;

  const l2Executor = WORMHOLE_CHAIN_ID_TO_L2_EXECUTOR[wormholeChainId];
  return {
    destinationChainId,
    l2FromAddress: getAddress(l2Executor ?? wormholeAddress),
  };
}

function toWormholeBatchCalls(
  wormholeTargets: readonly unknown[],
  wormholeValues: readonly unknown[],
  wormholeDatas: readonly unknown[],
): WormholeBatchCall[] {
  const calls: WormholeBatchCall[] = [];

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

    const [wormholeTargets, wormholeValues, wormholeDatas, wormholeAddress, wormholeChainId] =
      decoded.args;

    if (!hasMatchingLengths(wormholeTargets, wormholeValues, wormholeDatas)) {
      return null;
    }

    const context = resolveWormholeDestinationContext(Number(wormholeChainId), wormholeAddress);
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
 * Current coverage: Celo wormhole chain id 14 -> EVM chain id 42220.
 */
export function parseWormholeMessagesFromProposal(
  targets: readonly string[],
  calldatas: readonly string[],
): ExtractedCrossChainMessage[] {
  const messages: ExtractedCrossChainMessage[] = [];

  for (let i = 0; i < Math.min(targets.length, calldatas.length); i += 1) {
    const target = targets[i];
    const data = calldatas[i];
    if (!target || !isKnownWormholeProposalCall(target, data)) continue;

    const batch = tryDecodeWormholeBatch(data);
    if (!batch) continue;

    for (const call of batch.calls) {
      messages.push({
        bridgeType: 'WormholeL1L2',
        destinationChainId: batch.destinationChainId,
        l2TargetAddress: call.l2TargetAddress,
        l2InputData: call.l2InputData,
        l2Value: call.l2Value,
        l2FromAddress: batch.l2FromAddress,
      });
    }
  }

  if (messages.length > 0) {
    console.log(
      `[Wormhole Parser] Extracted ${messages.length} L1->L2 message(s) from proposal targets/calldatas.`,
    );
  }

  return messages;
}
