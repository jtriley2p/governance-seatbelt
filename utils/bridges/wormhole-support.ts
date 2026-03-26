import { getAddress } from 'viem';
import { avalanche, bsc, celo, monad, polygon, tempo } from 'viem/chains';

export type WormholeLaneKey = 'bnb' | 'polygon' | 'avalanche' | 'celo' | 'monad' | 'tempo';

export type WormholeLaneValidationTargets = {
  v2Factory: `0x${string}`;
  v3Factory?: `0x${string}`;
  v4PoolManager?: `0x${string}`;
};

export type WormholeLaneExecutionMode = 'direct' | 'receiver';

export type WormholeLaneSupport = {
  key: WormholeLaneKey;
  chainName: string;
  destinationChainId: number;
  wormholeChainId: number;
  executionMode: WormholeLaneExecutionMode;
  l2FromAddress: `0x${string}`;
  senderTargets: readonly `0x${string}`[];
  wormholeReceiverCoreAddress?: `0x${string}`;
  validationTargets: WormholeLaneValidationTargets;
};

const UNISWAP_WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');

export const WORMHOLE_LANE_SUPPORT_MATRIX: Record<WormholeLaneKey, WormholeLaneSupport> = {
  bnb: {
    key: 'bnb',
    chainName: 'BNB Smart Chain',
    destinationChainId: bsc.id,
    wormholeChainId: 4,
    executionMode: 'direct',
    l2FromAddress: getAddress('0x341c1511141022cf8eE20824Ae0fFA3491F1302b'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    validationTargets: {
      v2Factory: getAddress('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'),
    },
  },
  polygon: {
    key: 'polygon',
    chainName: 'Polygon',
    destinationChainId: polygon.id,
    wormholeChainId: 5,
    executionMode: 'direct',
    l2FromAddress: getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    validationTargets: {
      v2Factory: getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'),
    },
  },
  avalanche: {
    key: 'avalanche',
    chainName: 'Avalanche',
    destinationChainId: avalanche.id,
    wormholeChainId: 6,
    executionMode: 'direct',
    l2FromAddress: getAddress('0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    validationTargets: {
      v2Factory: getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'),
    },
  },
  celo: {
    key: 'celo',
    chainName: 'Celo',
    destinationChainId: celo.id,
    wormholeChainId: 14,
    executionMode: 'direct',
    l2FromAddress: getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    validationTargets: {
      v2Factory: getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f'),
      v3Factory: getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc'),
      v4PoolManager: getAddress('0x288dc841A52FCA2707c6947B3A777c5E56cd87BC'),
    },
  },
  monad: {
    key: 'monad',
    chainName: 'Monad',
    destinationChainId: monad.id,
    wormholeChainId: 48,
    executionMode: 'direct',
    l2FromAddress: getAddress('0xe783de89a7f0408687f051e3e6d0beb62719ebad'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    validationTargets: {
      v2Factory: getAddress('0x182a927119d56008d921126764bf884221b10f59'),
      v3Factory: getAddress('0x204faca1764b154221e35c0d20abb3c525710498'),
      v4PoolManager: getAddress('0x188d586ddcf52439676ca21a244753fa19f9ea8e'),
    },
  },
  tempo: {
    key: 'tempo',
    chainName: 'Tempo Mainnet',
    destinationChainId: tempo.id,
    wormholeChainId: 68,
    executionMode: 'receiver',
    l2FromAddress: getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    wormholeReceiverCoreAddress: getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6'),
    validationTargets: {
      v2Factory: getAddress('0xf9EC577a4E45B5278BB7Cf60FCBc20c3acAef68f'),
      v3Factory: getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6'),
      v4PoolManager: getAddress('0x33620f62C5b9B2086dD6b62F4A297A9f30347029'),
    },
  },
};

export const SUPPORTED_WORMHOLE_LANE_KEYS = Object.freeze(
  Object.keys(WORMHOLE_LANE_SUPPORT_MATRIX) as WormholeLaneKey[],
);

export function getWormholeLaneByChainId(
  wormholeChainId: number,
): WormholeLaneSupport | undefined {
  return SUPPORTED_WORMHOLE_LANE_KEYS
    .map((laneKey) => WORMHOLE_LANE_SUPPORT_MATRIX[laneKey])
    .find((lane) => lane.wormholeChainId === wormholeChainId);
}

export function getWormholeLaneByKey(laneKey: WormholeLaneKey): WormholeLaneSupport {
  return WORMHOLE_LANE_SUPPORT_MATRIX[laneKey];
}

export function getAllSupportedWormholeSenderTargets(): readonly `0x${string}`[] {
  return Array.from(
    new Set(
      SUPPORTED_WORMHOLE_LANE_KEYS.flatMap((laneKey) => WORMHOLE_LANE_SUPPORT_MATRIX[laneKey].senderTargets),
    ),
  );
}

export function getWormholeSupportMatrixIssues(): string[] {
  const issues: string[] = [];
  const seenWormholeChainIds = new Set<number>();
  const seenDestinationChainIds = new Set<number>();

  for (const laneKey of SUPPORTED_WORMHOLE_LANE_KEYS) {
    const lane = WORMHOLE_LANE_SUPPORT_MATRIX[laneKey];
    if (seenWormholeChainIds.has(lane.wormholeChainId)) {
      issues.push(`Duplicate Wormhole chain id ${lane.wormholeChainId} for lane ${lane.key}`);
    }
    seenWormholeChainIds.add(lane.wormholeChainId);

    if (seenDestinationChainIds.has(lane.destinationChainId)) {
      issues.push(`Duplicate destination chain id ${lane.destinationChainId} for lane ${lane.key}`);
    }
    seenDestinationChainIds.add(lane.destinationChainId);

    if (lane.senderTargets.length === 0) {
      issues.push(`Lane ${lane.key} has no recognized Wormhole sender targets`);
    }

    if (!lane.validationTargets.v2Factory) {
      issues.push(`Lane ${lane.key} is missing required v2 validation target`);
    }

    if (lane.executionMode === 'receiver' && !lane.wormholeReceiverCoreAddress) {
      issues.push(`Lane ${lane.key} uses receiver mode but is missing wormhole receiver core`);
    }
  }

  return issues;
}
