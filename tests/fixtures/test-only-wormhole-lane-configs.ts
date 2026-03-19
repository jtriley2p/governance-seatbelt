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

export function buildTestOnlyWormholeLaneSetupConfig(
  laneKey: TestOnlyWormholeLaneKey,
  artifacts: TestOnlyLaneArtifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey],
): SimulationConfigNew {
  const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];

  const call = buildWormholeProposalCall(
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

  return {
    type: 'new',
    daoName: 'Uniswap',
    governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
    governorType: 'bravo',
    targets: [call.target],
    values: [call.value],
    signatures: [call.signature],
    calldatas: [call.calldata],
    stateObjectsByChain: buildTestOnlyWormholeLaneState(
      lane.chainId,
      lane.l2FromAddress,
      [artifacts.v3Factory, artifacts.v2Factory, artifacts.v4PoolManager],
      artifacts.crossChainAccount,
    ),
    description: `# ${lane.name} Wormhole setup (test only)\n\nThis representative test-only lane sim uses the live ${lane.name} Wormhole authority as the destination sender and hands ownership of fresh fake V2/V3/V4 targets to a fresh fake CrossChainAccount. It exists to prove the lane-specific execution-job flow before a dependent follow-up run.`,
  };
}

export function buildTestOnlyWormholeLaneFollowupConfig(
  laneKey: TestOnlyWormholeLaneKey,
  artifacts: TestOnlyLaneArtifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey],
): SimulationConfigNew {
  const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];

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

  const call = buildWormholeProposalCall(
    laneKey,
    [artifacts.crossChainAccount, artifacts.crossChainAccount],
    [v3Forward, v2Forward],
  );

  return {
    type: 'new',
    daoName: 'Uniswap',
    governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
    governorType: 'bravo',
    targets: [call.target],
    values: [call.value],
    signatures: [call.signature],
    calldatas: [call.calldata],
    stateObjectsByChain: buildTestOnlyWormholeLaneState(
      lane.chainId,
      lane.l2FromAddress,
      [artifacts.v3Factory, artifacts.v2Factory, artifacts.v4PoolManager],
      artifacts.crossChainAccount,
    ),
    description: `# ${lane.name} Wormhole follow-up (test only)\n\nThis representative test-only lane sim mirrors the derived follow-up pattern from the Celo 94 -> 95 story. A plain run should fail because the fake targets are still owned by the live ${lane.name} Wormhole authority, while the CrossChainAccount forwarder is not yet the owner. Running this sim derived from the matching setup sim should pass after ownership handoff.`,
  };
}
