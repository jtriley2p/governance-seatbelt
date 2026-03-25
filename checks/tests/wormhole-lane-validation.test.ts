import { describe, expect, test } from 'bun:test';
import { encodeAbiParameters, keccak256, parseAbi } from 'viem';
import { config as proposal94TestConfig } from '../../sims/94-test.sim';
import { config as proposal95TestConfig } from '../../sims/95-test.sim';
import {
  LIVE_WORMHOLE_LANE_VALIDATION_TARGETS,
  REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS,
  buildTestOnlyWormholeRolloutFollowupConfig,
  buildTestOnlyWormholeRolloutSetupConfig,
} from '../../tests/fixtures/test-only-wormhole-lane-configs';
import {
  TEST_ONLY_WORMHOLE_LANES,
  type TestOnlyWormholeLaneKey,
} from '../../tests/fixtures/test-only-wormhole-lane-state';
import type { SimulationConfigNew, SimulationResult } from '../../types';
import { getWormholeLaneCapabilities } from '../../utils/bridges/wormhole';
import {
  LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION,
  LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
} from '../../utils/bridges/wormhole-runtime-state';
import { BlockExplorerFactory } from '../../utils/clients/block-explorers/factory';
import { getClientForChain } from '../../utils/clients/client';
import type { SimulationExecutionOptions } from '../../utils/clients/tenderly';
import { handleCrossChainSimulations, simulateNew } from '../../utils/clients/tenderly';
import { WORMHOLE_RECEIVER_ABI } from '../../utils/cross-chain/wormhole-receiver-sim';
import {
  buildDerivedBaselineChains,
  buildDerivedStateByChain,
  mergeStateObjects,
} from '../../utils/derived-state';
import type { DerivedStateByChain } from '../../utils/derived-state';

const OWNER_ABI = parseAbi(['function owner() view returns (address)']);
const V2_FACTORY_ABI = parseAbi(['function feeToSetter() view returns (address)']);
const EXTERNAL_API_TIMEOUT_MS = 180000;
const RUN_LIVE_BNB_LEGACY_VALIDATION = process.env.RUN_LIVE_BNB_LEGACY_VALIDATION === '1';
const maybeLiveBnbLegacy = RUN_LIVE_BNB_LEGACY_VALIDATION ? test : test.skip;
const BNB_SOURCIFY_SOURCE_BASE_URL =
  'https://repo.sourcify.dev/contracts/full_match/56/0x341c1511141022cf8eE20824Ae0fFA3491F1302b/sources';
const LEGACY_BNB_WORMHOLE_PAYLOAD_DESCRIPTOR =
  'UniswapWormholeMessageSenderV1 (bytes32 receivedMessagePayloadVersion, address[] memory targets, uint256[] memory values, bytes[] memory datas, address messageReceiver, uint16 receiverChainId)';

type LaneKey = Extract<
  TestOnlyWormholeLaneKey,
  'bnb' | 'polygon' | 'avalanche' | 'celo' | 'monad' | 'tempo'
>;

async function expectLiveGovernanceAuthorityMatchesLane(laneKey: LaneKey): Promise<void> {
  const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
  const validationTargets = LIVE_WORMHOLE_LANE_VALIDATION_TARGETS[laneKey];
  const client = getClientForChain(lane.chainId);

  const feeToSetter = await client.readContract({
    address: validationTargets.v2Factory,
    abi: V2_FACTORY_ABI,
    functionName: 'feeToSetter',
  });

  expect(feeToSetter.toLowerCase()).toBe(lane.l2FromAddress.toLowerCase());

  if (validationTargets.v3Factory) {
    const owner = await client.readContract({
      address: validationTargets.v3Factory,
      abi: OWNER_ABI,
      functionName: 'owner',
    });
    expect(owner.toLowerCase()).toBe(lane.l2FromAddress.toLowerCase());
  }

  if (validationTargets.v4PoolManager) {
    const owner = await client.readContract({
      address: validationTargets.v4PoolManager,
      abi: OWNER_ABI,
      functionName: 'owner',
    });
    expect(owner.toLowerCase()).toBe(lane.l2FromAddress.toLowerCase());
  }
}

async function fetchLegacyBnbVerifiedSource(relativePath: string): Promise<string> {
  const response = await fetch(`${BNB_SOURCIFY_SOURCE_BASE_URL}/${relativePath}`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch legacy BNB verified source ${relativePath}: ${response.status} ${response.statusText}`,
    );
  }

  return await response.text();
}

function buildExecutionOptions(
  config: SimulationConfigNew,
  derivedStateByChain?: DerivedStateByChain,
): SimulationExecutionOptions {
  const initialStateByChain: DerivedStateByChain = {};

  for (const [chainId, stateObjects] of Object.entries(config.stateObjectsByChain ?? {})) {
    const normalizedChainId = Number(chainId);
    const mergedState = mergeStateObjects(stateObjects, initialStateByChain[normalizedChainId]);
    if (mergedState) {
      initialStateByChain[normalizedChainId] = mergedState;
    }
  }

  return {
    initialStateByChain,
    derivedStateByChain,
  };
}

async function runRepresentativeLaneSimulation(
  config: SimulationConfigNew,
  derivedStateByChain?: DerivedStateByChain,
): Promise<SimulationResult> {
  const executionOptions = buildExecutionOptions(config, derivedStateByChain);
  const sourceResult = await simulateNew(config, executionOptions);
  return await handleCrossChainSimulations(sourceResult, executionOptions);
}

function getCeloWormholeJob(result: SimulationResult) {
  return (result.destinationJobResults ?? []).find(
    (job) =>
      job.bridgeType === 'WormholeL1L2' &&
      job.chainId === TEST_ONLY_WORMHOLE_LANES.celo.chainId &&
      job.job.l2FromAddress.toLowerCase() ===
        TEST_ONLY_WORMHOLE_LANES.celo.l2FromAddress.toLowerCase(),
  );
}

function getCeloFollowupJobs(result: SimulationResult) {
  return (result.destinationJobResults ?? []).filter(
    (job) =>
      job.bridgeType === 'OptimismL1L2' && job.chainId === TEST_ONLY_WORMHOLE_LANES.celo.chainId,
  );
}

describe('Wormhole lane live authority validation', () => {
  const supportedLanes: Array<{ laneKey: LaneKey; chainName: string }> = [
    { laneKey: 'bnb', chainName: 'BNB' },
    { laneKey: 'polygon', chainName: 'Polygon' },
    { laneKey: 'avalanche', chainName: 'Avalanche' },
    { laneKey: 'celo', chainName: 'Celo' },
    { laneKey: 'monad', chainName: 'Monad' },
    { laneKey: 'tempo', chainName: 'Tempo' },
  ];

  test.each(supportedLanes)(
    'confirms the configured $chainName lane authority matches live destination governance state',
    async ({ laneKey }) => {
      const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
      const client = getClientForChain(lane.chainId);

      await expectLiveGovernanceAuthorityMatchesLane(laneKey);

      const code = await client.getCode({ address: lane.l2FromAddress });
      expect(code).toBeDefined();
      expect(code).not.toBe('0x');

      const laneCapabilities = getWormholeLaneCapabilities(lane.wormholeChainId);
      const wormholeReceiverCoreAddress = laneCapabilities.receiverCoreAddress;
      const usesReceiverMode = laneCapabilities.kind !== 'direct';
      const usesLegacyRuntimeState = laneCapabilities.kind === 'legacy';

      expect(usesReceiverMode).toBe(wormholeReceiverCoreAddress !== null);
      expect(usesLegacyRuntimeState && !usesReceiverMode).toBe(false);

      if (usesReceiverMode) {
        expect(wormholeReceiverCoreAddress).not.toBeNull();
        const receiverCoreAddress = wormholeReceiverCoreAddress!;

        const wormholeCoreCode = await client.getCode({
          address: receiverCoreAddress,
        });
        expect(wormholeCoreCode).toBeDefined();
        expect(wormholeCoreCode).not.toBe('0x');

        if (usesLegacyRuntimeState) {
          await expect(
            client.readContract({
              address: lane.l2FromAddress,
              abi: WORMHOLE_RECEIVER_ABI,
              functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
            }),
          ).rejects.toThrow();
          await expect(
            client.readContract({
              address: lane.l2FromAddress,
              abi: WORMHOLE_RECEIVER_ABI,
              functionName: 'nextMinimumSequence',
            }),
          ).rejects.toThrow();

          const storedSequence = await client.getStorageAt({
            address: lane.l2FromAddress,
            slot: LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
          });
          expect(storedSequence).toBeDefined();
        } else {
          const payloadVersion = await client.readContract({
            address: lane.l2FromAddress,
            abi: WORMHOLE_RECEIVER_ABI,
            functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
          });
          const nextMinimumSequence = await client.readContract({
            address: lane.l2FromAddress,
            abi: WORMHOLE_RECEIVER_ABI,
            functionName: 'nextMinimumSequence',
          });

          expect(payloadVersion).toMatch(/^0x[0-9a-fA-F]{64}$/);
          expect(typeof nextMinimumSequence).toBe('bigint');
        }
      } else {
        expect(wormholeReceiverCoreAddress).toBeNull();
        await expect(
          client.readContract({
            address: lane.l2FromAddress,
            abi: WORMHOLE_RECEIVER_ABI,
            functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
          }),
        ).rejects.toThrow();
      }
    },
    EXTERNAL_API_TIMEOUT_MS,
  );
});

describe('BNB legacy Wormhole live validation', () => {
  maybeLiveBnbLegacy(
    'confirms the legacy BNB receiver assumptions against live chain state',
    async () => {
      const lane = TEST_ONLY_WORMHOLE_LANES.bnb;
      const client = getClientForChain(lane.chainId);
      const laneCapabilities = getWormholeLaneCapabilities(lane.wormholeChainId);

      await expectLiveGovernanceAuthorityMatchesLane('bnb');
      if (laneCapabilities.kind !== 'legacy') {
        throw new Error('Expected BNB to remain on the legacy Wormhole receiver path');
      }

      const verification = await BlockExplorerFactory.getContractVerification(
        lane.l2FromAddress,
        lane.chainId,
      );
      const contractName = await BlockExplorerFactory.fetchContractName(
        lane.l2FromAddress,
        lane.chainId,
      );
      const verifiedSource = await fetchLegacyBnbVerifiedSource(
        'contracts/UniswapWormholeMessageReceiver.sol',
      );
      const externallyDerivedPayloadVersion = keccak256(
        encodeAbiParameters([{ type: 'string' }], [LEGACY_BNB_WORMHOLE_PAYLOAD_DESCRIPTOR]),
      );

      expect(verification.status).toBe('verified');
      expect(verification.source).toBe('sourcify');
      expect(verification.sourcifyMatch).toBe('exact_match');
      expect(contractName).toBe('UniswapWormholeMessageReceiver');
      expect(verifiedSource).toContain(LEGACY_BNB_WORMHOLE_PAYLOAD_DESCRIPTOR);
      expect(verifiedSource).toContain('uint64 nextMinimumSequence = 0;');
      expect(verifiedSource).not.toContain('function nextMinimumSequence()');
      expect(verifiedSource).not.toContain('EXPECTED_MESSAGE_PAYLOAD_VERSION');
      expect(laneCapabilities.payloadVersion).toBe(LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION);
      expect(externallyDerivedPayloadVersion).toBe(LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION);
      expect(laneCapabilities.nextSequenceStorageSlot).toBe(
        LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
      );

      await expect(
        client.readContract({
          address: lane.l2FromAddress,
          abi: WORMHOLE_RECEIVER_ABI,
          functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
        }),
      ).rejects.toThrow();
      await expect(
        client.readContract({
          address: lane.l2FromAddress,
          abi: WORMHOLE_RECEIVER_ABI,
          functionName: 'nextMinimumSequence',
        }),
      ).rejects.toThrow();

      const storedSequence = await client.getStorageAt({
        address: lane.l2FromAddress,
        slot: laneCapabilities.nextSequenceStorageSlot,
      });

      expect(storedSequence).toBeDefined();
      if (!storedSequence) {
        throw new Error('Expected BNB legacy receiver sequence slot to be readable');
      }
      expect(storedSequence).toMatch(/^0x[0-9a-fA-F]{64}$/);
      const parsedSequence = BigInt(storedSequence);
      expect(parsedSequence).toBeGreaterThanOrEqual(0n);
      expect(parsedSequence).toBeLessThanOrEqual(2n ** 64n - 1n);
    },
    EXTERNAL_API_TIMEOUT_MS,
  );
});

describe('Celo 94 -> 95 derived-state validation', () => {
  let proposal94ResultPromise: Promise<SimulationResult> | undefined;
  let standalone95ResultPromise: Promise<SimulationResult> | undefined;
  let derived95ResultPromise: Promise<SimulationResult> | undefined;

  function getProposal94Result() {
    proposal94ResultPromise ??= runRepresentativeLaneSimulation(proposal94TestConfig);
    return proposal94ResultPromise;
  }

  function getStandalone95Result() {
    standalone95ResultPromise ??= runRepresentativeLaneSimulation(proposal95TestConfig);
    return standalone95ResultPromise;
  }

  function getDerived95Result() {
    derived95ResultPromise ??= (async () => {
      const proposal94Result = await getProposal94Result();
      const derivedStateByChain = buildDerivedStateByChain(proposal94Result);
      return await runRepresentativeLaneSimulation(proposal95TestConfig, derivedStateByChain);
    })();
    return derived95ResultPromise;
  }

  test(
    '94-test succeeds on the Celo Wormhole handoff lane',
    async () => {
      const proposal94Result = await getProposal94Result();
      const celoJob = getCeloWormholeJob(proposal94Result);

      expect(celoJob?.bridgeType).toBe('WormholeL1L2');
      expect(celoJob?.job.l2FromAddress.toLowerCase()).toBe(
        TEST_ONLY_WORMHOLE_LANES.celo.l2FromAddress.toLowerCase(),
      );
      expect(celoJob?.status).toBe('success');
      expect(celoJob?.stepResults.every((step) => step.status === 'success')).toBe(true);
      expect(proposal94Result.crossChainFailure).toBe(false);
    },
    EXTERNAL_API_TIMEOUT_MS,
  );

  test(
    '95-test fails on Celo without the derived 94 baseline',
    async () => {
      const proposal95Result = await getStandalone95Result();
      const celoJobs = getCeloFollowupJobs(proposal95Result);

      expect(celoJobs).toHaveLength(2);
      expect(celoJobs.every((job) => job.status === 'failure')).toBe(true);
      expect(proposal95Result.crossChainFailure).toBe(true);
    },
    EXTERNAL_API_TIMEOUT_MS,
  );

  test(
    '95-test succeeds on Celo when derived from the 94 baseline',
    async () => {
      const proposal95Result = await getDerived95Result();
      const celoJobs = getCeloFollowupJobs(proposal95Result);

      expect(celoJobs).toHaveLength(2);
      expect(celoJobs.every((job) => job.status === 'success')).toBe(true);
      expect(
        celoJobs.every((job) => job.stepResults.every((step) => step.status === 'success')),
      ).toBe(true);
      expect(proposal95Result.crossChainFailure).toBe(false);
    },
    EXTERNAL_API_TIMEOUT_MS,
  );
});

describe('Representative Wormhole rollout validation', () => {
  const laneKeys = [...REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS];

  let setupResultPromise: Promise<SimulationResult> | undefined;
  let standaloneFollowupResultPromise: Promise<SimulationResult> | undefined;
  let derivedFollowupResultPromise: Promise<SimulationResult> | undefined;

  function getSetupResult() {
    setupResultPromise ??= runRepresentativeLaneSimulation(
      buildTestOnlyWormholeRolloutSetupConfig(),
    );
    return setupResultPromise;
  }

  function getStandaloneFollowupResult() {
    standaloneFollowupResultPromise ??= runRepresentativeLaneSimulation(
      buildTestOnlyWormholeRolloutFollowupConfig(),
    );
    return standaloneFollowupResultPromise;
  }

  function getDerivedFollowupResult() {
    derivedFollowupResultPromise ??= (async () => {
      const setupResult = await getSetupResult();
      const derivedStateByChain = buildDerivedStateByChain(setupResult);
      return await runRepresentativeLaneSimulation(
        buildTestOnlyWormholeRolloutFollowupConfig(),
        derivedStateByChain,
      );
    })();

    return derivedFollowupResultPromise;
  }

  test(
    'setup rollout succeeds on every representative lane',
    async () => {
      const setupResult = await getSetupResult();

      expect(setupResult.destinationJobResults).toHaveLength(laneKeys.length);

      for (const laneKey of laneKeys) {
        const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
        const setupJob = (setupResult.destinationJobResults ?? []).find(
          (job) => job.chainId === lane.chainId,
        );
        expect(setupJob?.status).toBe('success');
      }
    },
    EXTERNAL_API_TIMEOUT_MS,
  );

  test(
    'setup rollout produces derived baselines for mainnet and every representative lane',
    async () => {
      const setupResult = await getSetupResult();
      const derivedStateByChain = buildDerivedStateByChain(setupResult);

      for (const laneKey of laneKeys) {
        const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
        expect(derivedStateByChain[lane.chainId]).toBeDefined();
      }

      const baselineChains = buildDerivedBaselineChains(setupResult).map(
        (baseline) => baseline.chainId,
      );
      expect(baselineChains).toContain(1);

      for (const laneKey of laneKeys) {
        expect(baselineChains).toContain(TEST_ONLY_WORMHOLE_LANES[laneKey].chainId);
      }
    },
    EXTERNAL_API_TIMEOUT_MS,
  );

  test(
    'standalone follow-up rollout fails on every representative lane',
    async () => {
      const standaloneFollowupResult = await getStandaloneFollowupResult();

      expect(standaloneFollowupResult.destinationJobResults).toHaveLength(laneKeys.length);

      for (const laneKey of laneKeys) {
        const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
        const standaloneJob = (standaloneFollowupResult.destinationJobResults ?? []).find(
          (job) => job.chainId === lane.chainId,
        );
        expect(standaloneJob?.status).toBe('failure');
      }
    },
    EXTERNAL_API_TIMEOUT_MS,
  );

  test(
    'derived follow-up rollout succeeds on every representative lane',
    async () => {
      const derivedFollowupResult = await getDerivedFollowupResult();

      expect(derivedFollowupResult.destinationJobResults).toHaveLength(laneKeys.length);

      for (const laneKey of laneKeys) {
        const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
        const derivedJob = (derivedFollowupResult.destinationJobResults ?? []).find(
          (job) => job.chainId === lane.chainId,
        );
        expect(derivedJob?.status).toBe('success');
      }
    },
    EXTERNAL_API_TIMEOUT_MS,
  );
});
