import { decodeFunctionData, getAddress, parseAbi, slice, toFunctionSelector } from 'viem';
import type { Hex } from 'viem';
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

function isHexString(value: unknown): value is Hex {
  return typeof value === 'string' && value.startsWith('0x');
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
    if (!target || !isHexString(data) || data === '0x' || data.length < 10) continue;

    let normalizedTarget: string;
    try {
      normalizedTarget = getAddress(target).toLowerCase();
    } catch {
      continue;
    }

    if (!KNOWN_WORMHOLE_SENDER_TARGETS.has(normalizedTarget)) continue;
    if (slice(data, 0, 4) !== WORMHOLE_SEND_MESSAGE_SELECTOR) continue;

    try {
      const decoded = decodeFunctionData({
        abi: WORMHOLE_SEND_MESSAGE_ABI,
        data,
      });

      if (decoded.functionName !== 'sendMessage') continue;

      const [wormholeTargets, wormholeValues, wormholeDatas, wormholeAddress, wormholeChainId] =
        decoded.args;

      if (!hasMatchingLengths(wormholeTargets, wormholeValues, wormholeDatas)) {
        continue;
      }

      const chainId = Number(wormholeChainId);
      const destinationChainId = WORMHOLE_CHAIN_ID_TO_EVM_CHAIN_ID[chainId];
      if (!destinationChainId) continue;

      const l2Executor = WORMHOLE_CHAIN_ID_TO_L2_EXECUTOR[chainId];
      const l2FromAddress = getAddress(l2Executor ?? wormholeAddress);

      for (let j = 0; j < wormholeTargets.length; j += 1) {
        const target = wormholeTargets[j];
        const value = wormholeValues[j];
        const calldata = wormholeDatas[j];

        if (typeof target !== 'string' || typeof value !== 'bigint' || !isHexString(calldata)) {
          continue;
        }

        messages.push({
          bridgeType: 'WormholeL1L2',
          destinationChainId,
          l2TargetAddress: getAddress(target),
          l2InputData: calldata,
          l2Value: value.toString(),
          l2FromAddress,
        });
      }
    } catch {
      // Skip invalid calldata.
    }
  }

  if (messages.length > 0) {
    console.log(
      `[Wormhole Parser] Extracted ${messages.length} L1->L2 message(s) from proposal targets/calldatas.`,
    );
  }

  return messages;
}
