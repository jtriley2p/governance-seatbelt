import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, parseAbi } from 'viem';
import type { CrossChainExecutionJob } from '../../types.d';
import { LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT } from '../bridges/wormhole-runtime-state';
import type { SimulationStateObjects } from '../derived-state';

export { WORMHOLE_CORE_STUB_RUNTIME_BYTECODE } from './wormhole-core-stub-bytecode';

export const WORMHOLE_RECEIVER_ABI = parseAbi([
  'function receiveMessage(bytes whMessage)',
  'function nextMinimumSequence() view returns (uint64)',
  'function EXPECTED_MESSAGE_PAYLOAD_VERSION() view returns (bytes32)',
]);

export type WormholeReceiverRuntimeState = {
  expectedPayloadVersion: Hex;
  nextSequence: bigint;
};

export type WormholeReceiverRuntimeStateCacheKey = `${number}:${string}`;

export function getOverriddenWormholeReceiverSequence(
  workingState: SimulationStateObjects | undefined,
  receiverAddress: Address,
): bigint | null {
  const overriddenSequence =
    workingState?.[receiverAddress]?.storage?.[LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT];
  if (overriddenSequence === undefined) return null;
  return BigInt(overriddenSequence);
}

export function getWormholeReceiverRuntimeStateKey(
  destinationChainId: number,
  receiverAddress: Address,
): WormholeReceiverRuntimeStateCacheKey {
  return `${destinationChainId}:${receiverAddress.toLowerCase()}`;
}

export function getWormholeMessageTimestamp(sourceTimestamp: bigint): number {
  const timestamp = Number(sourceTimestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff) {
    throw new Error(
      `Invalid Wormhole message timestamp derived from source simulation: ${sourceTimestamp.toString()}`,
    );
  }
  return timestamp;
}

function buildWormholeExecutionPayload(
  job: CrossChainExecutionJob,
  runtimeState: WormholeReceiverRuntimeState,
): Hex {
  return encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'address[]' },
      { type: 'uint256[]' },
      { type: 'bytes[]' },
      { type: 'address' },
      { type: 'uint16' },
    ],
    [
      runtimeState.expectedPayloadVersion,
      job.calls.map((call) => call.l2TargetAddress),
      job.calls.map((call) => BigInt(call.l2Value)),
      job.calls.map((call) => call.l2InputData),
      job.l2FromAddress,
      job.wormholeChainId ?? 0,
    ],
  );
}

function buildWormholeMessageEnvelope(
  payload: Hex,
  sequence: bigint,
  sourceTimestamp: bigint,
): Hex {
  return encodeAbiParameters(
    [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
    [getWormholeMessageTimestamp(sourceTimestamp), sequence, payload],
  );
}

export function buildWormholeReceiverSimulationCall(
  job: CrossChainExecutionJob,
  runtimeState: WormholeReceiverRuntimeState,
  sourceTimestamp: bigint,
): CrossChainExecutionJob['calls'][number] {
  const totalValue = job.calls.reduce((sum, call) => sum + BigInt(call.l2Value), 0n);
  const whPayload = buildWormholeExecutionPayload(job, runtimeState);
  const whMessage = buildWormholeMessageEnvelope(
    whPayload,
    runtimeState.nextSequence,
    sourceTimestamp,
  );

  return {
    l2TargetAddress: job.l2FromAddress,
    l2InputData: encodeFunctionData({
      abi: WORMHOLE_RECEIVER_ABI,
      functionName: 'receiveMessage',
      args: [whMessage],
    }),
    l2Value: totalValue.toString(),
  };
}
