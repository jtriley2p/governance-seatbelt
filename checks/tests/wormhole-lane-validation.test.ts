import { describe, expect, test } from 'bun:test';
import { parseAbi } from 'viem';
import {
  LIVE_WORMHOLE_LANE_VALIDATION_TARGETS,
  buildTestOnlyWormholeLaneFollowupConfig,
  buildTestOnlyWormholeLaneSetupConfig,
} from '../../tests/fixtures/test-only-wormhole-lane-configs';
import {
  TEST_ONLY_WORMHOLE_LANES,
  type TestOnlyWormholeLaneKey,
} from '../../tests/fixtures/test-only-wormhole-lane-state';
import type { SimulationConfigNew, SimulationResult } from '../../types';
import { getClientForChain } from '../../utils/clients/client';
import type { SimulationExecutionOptions } from '../../utils/clients/tenderly';
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

type LaneKey = Extract<TestOnlyWormholeLaneKey, 'bnb' | 'polygon' | 'avalanche' | 'monad'>;

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
    { laneKey: 'monad', chainName: 'Monad' },
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
    },
    EXTERNAL_API_TIMEOUT_MS,
  );
});

describe('Wormhole representative lane flows', () => {
  const supportedLanes: Array<{ laneKey: LaneKey; chainName: string }> = [
    { laneKey: 'bnb', chainName: 'BNB' },
    { laneKey: 'polygon', chainName: 'Polygon' },
    { laneKey: 'avalanche', chainName: 'Avalanche' },
    { laneKey: 'monad', chainName: 'Monad' },
  ];

  test.each(supportedLanes)(
    'proves setup pass, standalone failure, and derived success for $chainName',
    async ({ laneKey }) => {
      const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];

      const setupResult = await runRepresentativeLaneSimulation(
        buildTestOnlyWormholeLaneSetupConfig(laneKey),
      );
      const setupJob = (setupResult.destinationJobResults ?? []).find(
        (job) => job.chainId === lane.chainId,
      );
      expect(setupJob?.status).toBe('success');

      const derivedStateByChain = buildDerivedStateByChain(setupResult);
      expect(derivedStateByChain[lane.chainId]).toBeDefined();

      const baselineChains = buildDerivedBaselineChains(setupResult).map(
        (baseline) => baseline.chainId,
      );
      expect(baselineChains).toContain(1);
      expect(baselineChains).toContain(lane.chainId);

      const standaloneFollowupResult = await runRepresentativeLaneSimulation(
        buildTestOnlyWormholeLaneFollowupConfig(laneKey),
      );
      const standaloneJob = (standaloneFollowupResult.destinationJobResults ?? []).find(
        (job) => job.chainId === lane.chainId,
      );
      expect(standaloneJob?.status).toBe('failure');

      const derivedFollowupResult = await runRepresentativeLaneSimulation(
        buildTestOnlyWormholeLaneFollowupConfig(laneKey),
        derivedStateByChain,
      );
      const derivedJob = (derivedFollowupResult.destinationJobResults ?? []).find(
        (job) => job.chainId === lane.chainId,
      );
      expect(derivedJob?.status).toBe('success');
    },
    EXTERNAL_API_TIMEOUT_MS,
  );
});
