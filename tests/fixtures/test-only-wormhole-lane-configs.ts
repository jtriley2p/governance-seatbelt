import { encodeFunctionData, getAddress, parseAbi } from 'viem';
import type { SimulationConfigNew } from '../../types';
import {
  TEST_ONLY_WORMHOLE_LANES,
  TEST_ONLY_WORMHOLE_LANE_ARTIFACTS,
  type TestOnlyLaneArtifacts,
  type TestOnlyWormholeLaneKey,
  buildTestOnlyWormholeLaneState,
} from './test-only-wormhole-lane-state';

const WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');
const WORMHOLE_BRIDGE = getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B');

const WORMHOLE_SENDER_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);
const FORWARD_ABI = parseAbi(['function forward(address target, bytes data)']);
const SET_OWNER_ABI = parseAbi(['function setOwner(address _owner)']);
const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)', 'function setFeeToSetter(address)']);
const OWNED_ABI = parseAbi(['function transferOwnership(address newOwner)']);

export const REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS = [
  'bnb',
  'polygon',
  'avalanche',
  'monad',
] as const satisfies ReadonlyArray<
  Extract<TestOnlyWormholeLaneKey, 'bnb' | 'polygon' | 'avalanche' | 'monad'>
>;

export type LiveWormholeLaneValidationTargets = {
  v2Factory: `0x${string}`;
  v3Factory?: `0x${string}`;
  v4PoolManager?: `0x${string}`;
};

export const LIVE_WORMHOLE_LANE_VALIDATION_TARGETS: Record<
  Extract<TestOnlyWormholeLaneKey, 'bnb' | 'polygon' | 'avalanche' | 'monad'>,
  LiveWormholeLaneValidationTargets
> = {
  bnb: {
    v2Factory: getAddress('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'),
  },
  polygon: {
    v2Factory: getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'),
  },
  avalanche: {
    v2Factory: getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'),
  },
  monad: {
    v2Factory: getAddress('0x182a927119d56008d921126764bf884221b10f59'),
    v3Factory: getAddress('0x204faca1764b154221e35c0d20abb3c525710498'),
    v4PoolManager: getAddress('0x188d586ddcf52439676ca21a244753fa19f9ea8e'),
  },
};

function buildWormholeProposalCall(
  laneKey: TestOnlyWormholeLaneKey,
  targets: readonly `0x${string}`[],
  calldatas: readonly `0x${string}`[],
) {
  const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
  return {
    target: WORMHOLE_SENDER,
    calldata: encodeFunctionData({
      abi: WORMHOLE_SENDER_ABI,
      functionName: 'sendMessage',
      args: [
        [...targets],
        new Array(targets.length).fill(0n),
        [...calldatas],
        WORMHOLE_BRIDGE,
        lane.wormholeChainId,
      ],
    }),
    value: 0n,
    signature: '',
  };
}

function buildRepresentativeWormholeSetupAction(
  laneKey: TestOnlyWormholeLaneKey,
  artifacts: TestOnlyLaneArtifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey],
) {
  return buildWormholeProposalCall(
    laneKey,
    [artifacts.v3Factory, artifacts.v2Factory, artifacts.v4PoolManager],
    [
      encodeFunctionData({
        abi: SET_OWNER_ABI,
        functionName: 'setOwner',
        args: [artifacts.crossChainAccount],
      }),
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeToSetter',
        args: [artifacts.crossChainAccount],
      }),
      encodeFunctionData({
        abi: OWNED_ABI,
        functionName: 'transferOwnership',
        args: [artifacts.crossChainAccount],
      }),
    ],
  );
}

function buildRepresentativeWormholeFollowupAction(
  laneKey: TestOnlyWormholeLaneKey,
  artifacts: TestOnlyLaneArtifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey],
) {
  const v3Forward = encodeFunctionData({
    abi: FORWARD_ABI,
    functionName: 'forward',
    args: [
      artifacts.v3Factory,
      encodeFunctionData({
        abi: SET_OWNER_ABI,
        functionName: 'setOwner',
        args: [artifacts.feeAdapter],
      }),
    ],
  });

  const v2Forward = encodeFunctionData({
    abi: FORWARD_ABI,
    functionName: 'forward',
    args: [
      artifacts.v2Factory,
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeTo',
        args: [artifacts.tokenJar],
      }),
    ],
  });

  return buildWormholeProposalCall(
    laneKey,
    [artifacts.crossChainAccount, artifacts.crossChainAccount],
    [v3Forward, v2Forward],
  );
}

function buildRepresentativeWormholeRolloutState(): NonNullable<
  SimulationConfigNew['stateObjectsByChain']
> {
  const stateObjectsByChain: NonNullable<SimulationConfigNew['stateObjectsByChain']> = {};

  for (const laneKey of REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS) {
    const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
    const artifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey];
    stateObjectsByChain[lane.chainId] = buildTestOnlyWormholeLaneState(
      lane.chainId,
      lane.l2FromAddress,
      [artifacts.v3Factory, artifacts.v2Factory, artifacts.v4PoolManager],
      artifacts.crossChainAccount,
    )[lane.chainId]!;
  }

  return stateObjectsByChain;
}

function buildRepresentativeLaneSummary(): string {
  return REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS.map(
    (laneKey) => TEST_ONLY_WORMHOLE_LANES[laneKey].name,
  ).join(', ');
}

function buildRepresentativeWormholeRolloutActions(kind: 'setup' | 'followup') {
  return REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS.map((laneKey) =>
    kind === 'setup'
      ? buildRepresentativeWormholeSetupAction(laneKey)
      : buildRepresentativeWormholeFollowupAction(laneKey),
  );
}

function buildRepresentativeWormholeRolloutConfig(kind: 'setup' | 'followup'): SimulationConfigNew {
  const actions = buildRepresentativeWormholeRolloutActions(kind);
  const description =
    kind === 'setup'
      ? `# Representative Wormhole rollout setup (test only)\n\nThis representative multi-lane setup proposal uses the live Wormhole authorities for ${buildRepresentativeLaneSummary()} as the destination senders and hands ownership of fresh fake V2/V3/V4 targets to fresh fake CrossChainAccounts. It exists to model the kind of consolidated rollout proposal governance would likely use across multiple lanes.`
      : `# Representative Wormhole rollout follow-up (test only)\n\nThis representative multi-lane follow-up proposal mirrors the derived dependency pattern from the Celo 94 -> 95 story. A plain run should fail because the fresh fake targets are still owned by the live Wormhole authorities, while the fake CrossChainAccounts are not yet the owners. Running this proposal derived from the matching setup proposal should pass after the ownership handoff for ${buildRepresentativeLaneSummary()}.`;

  return {
    type: 'new',
    daoName: 'Uniswap',
    governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
    governorType: 'bravo',
    targets: actions.map((action) => action.target),
    values: actions.map((action) => action.value),
    signatures: actions.map((action) => action.signature),
    calldatas: actions.map((action) => action.calldata),
    stateObjectsByChain: buildRepresentativeWormholeRolloutState(),
    description,
  };
}

export function buildTestOnlyWormholeRolloutSetupConfig(): SimulationConfigNew {
  return buildRepresentativeWormholeRolloutConfig('setup');
}

export function buildTestOnlyWormholeRolloutFollowupConfig(): SimulationConfigNew {
  return buildRepresentativeWormholeRolloutConfig('followup');
}
