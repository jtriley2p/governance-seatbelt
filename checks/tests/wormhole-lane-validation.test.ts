import { describe, expect, test } from 'bun:test';
import { parseAbi } from 'viem';
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
import { getWormholeReceiverCoreAddressForChain } from '../../utils/bridges/wormhole';
import { getClientForChain } from '../../utils/clients/client';
import type { SimulationExecutionOptions } from '../../utils/clients/tenderly';
import {
  WORMHOLE_RECEIVER_ABI,
  WORMHOLE_RECEIVER_NEXT_MINIMUM_SEQUENCE_SLOT,
} from '../../utils/cross-chain/wormhole-receiver-sim';
import { handleCrossChainSimulations, simulateNew } from '../../utils/clients/tenderly';
import {
  buildDerivedBaselineChains,
  buildDerivedStateByChain,
  mergeStateObjects,
} from '../../utils/derived-state';
import type { DerivedStateByChain } from '../../utils/derived-state';

const OWNER_ABI = parseAbi(['function owner() view returns (address)']);
const V2_FACTORY_ABI = parseAbi(['function feeToSetter() view returns (address)']);
const EXTERNAL_API_TIMEOUT_MS = 180000;

type LaneKey = Extract<
  TestOnlyWormholeLaneKey,
  'bnb' | 'polygon' | 'avalanche' | 'celo' | 'monad' | 'tempo'
>;

const RECEIVER_MODE_LANE_KEYS: ReadonlySet<LaneKey> = new Set([
  'bnb',
  'celo',
  'monad',
  'tempo',
]);

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

      const code = await client.getCode({ address: lane.l2FromAddress });
      expect(code).toBeDefined();
      expect(code).not.toBe('0x');

      const wormholeReceiverCoreAddress = getWormholeReceiverCoreAddressForChain(lane.wormholeChainId);

      if (RECEIVER_MODE_LANE_KEYS.has(laneKey)) {
        expect(wormholeReceiverCoreAddress).not.toBeNull();

        const wormholeCoreCode = await client.getCode({
          address: wormholeReceiverCoreAddress!,
        });
        expect(wormholeCoreCode).toBeDefined();
        expect(wormholeCoreCode).not.toBe('0x');

        if (laneKey === 'bnb') {
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
            slot: WORMHOLE_RECEIVER_NEXT_MINIMUM_SEQUENCE_SLOT,
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
      const celoJob = (proposal94Result.destinationJobResults ?? []).find(
        (job) => job.chainId === TEST_ONLY_WORMHOLE_LANES.celo.chainId,
      );

      expect(celoJob?.bridgeType).toBe('WormholeL1L2');
      expect(celoJob?.job.l2FromAddress.toLowerCase()).toBe(
        TEST_ONLY_WORMHOLE_LANES.celo.l2FromAddress.toLowerCase(),
      );
      expect(celoJob?.status).toBe('success');
    },
    EXTERNAL_API_TIMEOUT_MS,
  );

  test(
    '95-test fails on Celo without the derived 94 baseline',
    async () => {
      const proposal95Result = await getStandalone95Result();
      const celoJob = (proposal95Result.destinationJobResults ?? []).find(
        (job) => job.chainId === TEST_ONLY_WORMHOLE_LANES.celo.chainId,
      );

      expect(celoJob?.status).toBe('failure');
    },
    EXTERNAL_API_TIMEOUT_MS,
  );

  test(
    '95-test succeeds on Celo when derived from the 94 baseline',
    async () => {
      const proposal95Result = await getDerived95Result();
      const celoJob = (proposal95Result.destinationJobResults ?? []).find(
        (job) => job.chainId === TEST_ONLY_WORMHOLE_LANES.celo.chainId,
      );

      expect(celoJob?.status).toBe('success');
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
