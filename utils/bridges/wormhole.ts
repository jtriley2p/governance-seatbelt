import { decodeFunctionData, getAddress, isHex, parseAbi, slice, toFunctionSelector } from 'viem';
import { avalanche, bsc, celo, monad, polygon, tempo } from 'viem/chains';
import type { CrossChainExecutionCall, CrossChainExecutionJob } from '../../types.d';
import {
  LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION,
  LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
} from './wormhole-runtime-state';

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

type DirectWormholeLaneMetadata = {
  destinationChainId: number;
  l2FromAddress: `0x${string}`;
};

type ModernReceiverWormholeLaneMetadata = DirectWormholeLaneMetadata & {
  receiverRuntimeState: {
    kind: 'modern';
    receiverCoreAddress: `0x${string}`;
  };
};

type LegacyReceiverWormholeLaneMetadata = DirectWormholeLaneMetadata & {
  receiverRuntimeState: {
    kind: 'legacy';
    receiverCoreAddress: `0x${string}`;
    payloadVersion: typeof LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION;
    nextSequenceStorageSlot: typeof LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT;
  };
};

type WormholeLaneMetadata =
  | DirectWormholeLaneMetadata
  | ModernReceiverWormholeLaneMetadata
  | LegacyReceiverWormholeLaneMetadata;

export type WormholeLaneCapabilities =
  | {
      kind: 'direct';
      receiverCoreAddress: null;
    }
  | {
      kind: 'modern';
      receiverCoreAddress: `0x${string}`;
    }
  | {
      kind: 'legacy';
      receiverCoreAddress: `0x${string}`;
      payloadVersion: typeof LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION;
      nextSequenceStorageSlot: typeof LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT;
    };

export const SUPPORTED_WORMHOLE_CHAIN_IDS = [4, 5, 6, 14, 48, 68] as const;

const WORMHOLE_CHAIN_ID_TO_LANE_METADATA: Record<number, WormholeLaneMetadata> = {
  // Live Uniswap governance authority values are sourced from the current destination-chain
  // factory/pool-manager owner fields as of 2026-03-19.
  // Only lanes with a `wormholeReceiverCoreAddress` currently use receiver-mode simulation.
  // Polygon and Avalanche still execute through direct mode because their live destination
  // authorities are not Uniswap Wormhole receiver contracts.
  4: {
    destinationChainId: bsc.id,
    l2FromAddress: getAddress('0x341c1511141022cf8eE20824Ae0fFA3491F1302b'),
    receiverRuntimeState: {
      kind: 'legacy',
      receiverCoreAddress: getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
      // BNB still uses an older receiver shape that does not expose the modern runtime-state
      // getters. We therefore keep the payload version and sequence slot as explicit metadata,
      // with provenance documented in `wormhole-runtime-state.ts` and guarded by the opt-in
      // live BNB validation test added for issue #238.
      payloadVersion: LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION,
      nextSequenceStorageSlot: LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
    },
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
    receiverRuntimeState: {
      kind: 'modern',
      receiverCoreAddress: getAddress('0xa321448d90d4e5b0A732867c18eA198e75CAC48E'),
    },
  },
  48: {
    destinationChainId: monad.id,
    l2FromAddress: getAddress('0xe783de89a7f0408687f051e3e6d0beb62719ebad'),
    receiverRuntimeState: {
      kind: 'modern',
      receiverCoreAddress: getAddress('0x194B123c5E96B9B2e49763619985790Dc241CAC0'),
    },
  },
  68: {
    destinationChainId: tempo.id,
    l2FromAddress: getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b'),
    receiverRuntimeState: {
      kind: 'modern',
      receiverCoreAddress: getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6'),
    },
  },
};

function assertConfiguredWormholeLaneMetadata(): void {
  const configuredChainIds = Object.keys(WORMHOLE_CHAIN_ID_TO_LANE_METADATA)
    .map((chainId) => Number(chainId))
    .sort((left, right) => left - right);
  const supportedChainIds = [...SUPPORTED_WORMHOLE_CHAIN_IDS];

  if (
    configuredChainIds.length !== supportedChainIds.length ||
    configuredChainIds.some((chainId, index) => chainId !== supportedChainIds[index])
  ) {
    throw new Error(
      `Wormhole lane metadata must explicitly cover supported chain ids ${supportedChainIds.join(', ')}, got ${configuredChainIds.join(', ')}`,
    );
  }
}

assertConfiguredWormholeLaneMetadata();

function hasMatchingLengths(
  targets: readonly unknown[],
  values: readonly unknown[],
  datas: readonly unknown[],
): boolean {
  return targets.length === values.length && values.length === datas.length;
}

function hasReceiverRuntimeState(
  metadata: WormholeLaneMetadata,
): metadata is ModernReceiverWormholeLaneMetadata | LegacyReceiverWormholeLaneMetadata {
  return 'receiverRuntimeState' in metadata;
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
  const metadata = WORMHOLE_CHAIN_ID_TO_LANE_METADATA[wormholeChainId];
  if (!metadata) return null;

  return {
    destinationChainId: metadata.destinationChainId,
    l2FromAddress: metadata.l2FromAddress,
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
 * Receiver-mode is enabled where the destination authority is a Wormhole receiver; other lanes
 * continue to use direct-mode simulation until their live destination contracts match that path.
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

export function getWormholeLaneCapabilities(
  wormholeChainId: number | undefined,
): WormholeLaneCapabilities {
  if (wormholeChainId === undefined) {
    return assertValidWormholeLaneCapabilities(wormholeChainId, {
      kind: 'direct',
      receiverCoreAddress: null,
    });
  }
  const metadata = WORMHOLE_CHAIN_ID_TO_LANE_METADATA[wormholeChainId];
  if (!metadata) {
    throw new Error(`Unsupported Wormhole chain id ${wormholeChainId}`);
  }
  if (!hasReceiverRuntimeState(metadata)) {
    return assertValidWormholeLaneCapabilities(wormholeChainId, {
      kind: 'direct',
      receiverCoreAddress: null,
    });
  }

  if (metadata.receiverRuntimeState.kind === 'legacy') {
    return assertValidWormholeLaneCapabilities(wormholeChainId, {
      kind: 'legacy',
      receiverCoreAddress: metadata.receiverRuntimeState.receiverCoreAddress,
      payloadVersion: metadata.receiverRuntimeState.payloadVersion,
      nextSequenceStorageSlot: metadata.receiverRuntimeState.nextSequenceStorageSlot,
    });
  }

  return assertValidWormholeLaneCapabilities(wormholeChainId, {
    kind: 'modern',
    receiverCoreAddress: metadata.receiverRuntimeState.receiverCoreAddress,
  });
}

export function assertValidWormholeLaneCapabilities(
  wormholeChainId: number | undefined,
  capabilities: WormholeLaneCapabilities,
): WormholeLaneCapabilities {
  if (capabilities.kind === 'direct') {
    if (capabilities.receiverCoreAddress !== null) {
      throw new Error(
        `Direct Wormhole lane ${String(wormholeChainId)} has inconsistent receiver config`,
      );
    }
    return capabilities;
  }

  if (capabilities.kind === 'modern') {
    if (
      typeof capabilities.receiverCoreAddress !== 'string' ||
      !isHex(capabilities.receiverCoreAddress) ||
      capabilities.receiverCoreAddress.length !== 42
    ) {
      throw new Error(
        `Modern Wormhole lane ${String(wormholeChainId)} has invalid receiverCoreAddress`,
      );
    }
    return capabilities;
  }

  if (
    typeof capabilities.receiverCoreAddress !== 'string' ||
    capabilities.receiverCoreAddress.length === 0 ||
    !isHex(capabilities.receiverCoreAddress) ||
    capabilities.receiverCoreAddress.length !== 42
  ) {
    throw new Error(
      `Legacy Wormhole lane ${String(wormholeChainId)} has invalid receiverCoreAddress`,
    );
  }
  if (!isHex(capabilities.payloadVersion) || capabilities.payloadVersion.length !== 66) {
    throw new Error(`Legacy Wormhole lane ${String(wormholeChainId)} has invalid payloadVersion`);
  }
  if (
    !isHex(capabilities.nextSequenceStorageSlot) ||
    capabilities.nextSequenceStorageSlot.length !== 66
  ) {
    throw new Error(
      `Legacy Wormhole lane ${String(wormholeChainId)} has invalid nextSequenceStorageSlot`,
    );
  }

  return capabilities;
}
