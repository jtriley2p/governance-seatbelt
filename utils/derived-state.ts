import { getAddress } from 'viem';
import type {
  AllCheckResults,
  DependencyStatus,
  DerivedBaselineChain,
  DerivedSimulationProvenance,
  SimulationResult,
  TenderlyPayload,
  TenderlySimulation,
} from '../types.d';
import { supportsL2Checks } from './chains/capabilities';

export type SimulationStateObjects = NonNullable<TenderlyPayload['state_objects']>;
export type DerivedStateByChain = Record<number, SimulationStateObjects>;

export interface DependencyReference {
  proposalId?: string;
  simulationId?: string;
}

export interface DependencyOutcome {
  status: Exclude<DependencyStatus, 'skipped'>;
  reason?: string;
}

function normalizeStateObjects(
  stateObjects: TenderlyPayload['state_objects'] | undefined,
): SimulationStateObjects | undefined {
  if (!stateObjects) return undefined;

  const normalized: SimulationStateObjects = {};

  for (const [address, state] of Object.entries(stateObjects)) {
    const normalizedAddress = getAddress(address);
    const current = normalized[normalizedAddress] ?? {};
    const balance =
      typeof state.balance === 'string' && state.balance.length > 0 ? state.balance : undefined;

    const normalizedState = {
      ...current,
      ...state,
      ...(balance ? { balance } : {}),
      storage: {
        ...(current.storage ?? {}),
        ...(state.storage ?? {}),
      },
    };

    normalized[normalizedAddress] = balance
      ? normalizedState
      : {
          ...normalizedState,
          balance: undefined,
        };
  }

  return normalized;
}

export function mergeStateObjects(
  base: TenderlyPayload['state_objects'] | undefined,
  overrides: TenderlyPayload['state_objects'] | undefined,
): SimulationStateObjects | undefined {
  const normalizedBase = normalizeStateObjects(base);
  const normalizedOverrides = normalizeStateObjects(overrides);

  if (!normalizedBase && !normalizedOverrides) return undefined;
  if (!normalizedBase) return { ...(normalizedOverrides ?? {}) };
  if (!normalizedOverrides) return { ...normalizedBase };

  const merged: SimulationStateObjects = { ...normalizedBase };

  for (const [address, overrideState] of Object.entries(normalizedOverrides)) {
    const current = merged[address] ?? {};
    merged[address] = {
      ...current,
      ...overrideState,
      storage: {
        ...(current.storage ?? {}),
        ...(overrideState.storage ?? {}),
      },
    };
  }

  return merged;
}

/**
 * Extract final storage writes from a Tenderly simulation and convert them
 * into state_objects overrides that can seed a dependent simulation.
 */
export function extractStateOverridesFromSimulation(
  sim: TenderlySimulation,
): SimulationStateObjects {
  const overrides: SimulationStateObjects = {};
  const stateDiff = sim.transaction.transaction_info.state_diff ?? [];

  for (const contract of sim.contracts ?? []) {
    const address = getAddress(contract.address);
    const state = overrides[address] ?? {};

    overrides[address] = {
      ...state,
      ...(contract.balance ? { balance: contract.balance } : {}),
    };
  }

  for (const entry of stateDiff) {
    for (const raw of entry.raw ?? []) {
      const address = getAddress(raw.address);
      const state = overrides[address] ?? {};
      const storage = {
        ...(state.storage ?? {}),
        [raw.key]: raw.dirty,
      };

      overrides[address] = {
        ...state,
        storage,
      };
    }
  }

  return overrides;
}

/**
 * Build per-chain state overrides from a completed simulation (source + destination).
 */
export function buildDerivedStateByChain(
  result: Pick<SimulationResult, 'sim' | 'destinationSimulations'>,
): DerivedStateByChain {
  const byChain: DerivedStateByChain = {};

  const sourceOverrides = extractStateOverridesFromSimulation(result.sim);
  if (Object.keys(sourceOverrides).length > 0) {
    byChain[1] = sourceOverrides;
  }

  for (const destination of result.destinationSimulations ?? []) {
    if (!destination.sim || destination.status !== 'success') continue;

    const chainOverrides = extractStateOverridesFromSimulation(destination.sim);
    if (Object.keys(chainOverrides).length === 0) continue;

    byChain[destination.chainId] =
      mergeStateObjects(byChain[destination.chainId], chainOverrides) ?? chainOverrides;
  }

  return byChain;
}

/**
 * Fail-closed dependency gate.
 * - failed if source/destination simulation failed or any check has errors
 * - inconclusive if checks did not execute for source/destination chains
 * - otherwise passed
 */
export function evaluateDependencyOutcome(
  predecessorResult: Pick<SimulationResult, 'sim' | 'crossChainFailure' | 'destinationSimulations'>,
  predecessorChecks: AllCheckResults,
  predecessorDestinationChecks: Record<number, AllCheckResults>,
): DependencyOutcome {
  if (!predecessorResult.sim.transaction.status) {
    return {
      status: 'failed',
      reason: 'Predecessor source simulation failed',
    };
  }

  if (predecessorResult.crossChainFailure) {
    return {
      status: 'failed',
      reason: 'Predecessor cross-chain simulation failed',
    };
  }

  const summarizeChecks = (checks: AllCheckResults) => {
    let total = 0;
    let skipped = 0;

    for (const check of Object.values(checks)) {
      total += 1;

      if (check.result.errors.length > 0) {
        return {
          total,
          skipped,
          failedCheckName: check.name,
        };
      }

      if (check.result.skipped) {
        skipped += 1;
      }
    }

    return {
      total,
      skipped,
      failedCheckName: undefined,
    };
  };

  const sourceSummary = summarizeChecks(predecessorChecks);
  if (sourceSummary.failedCheckName) {
    return {
      status: 'failed',
      reason: `Predecessor check failed: ${sourceSummary.failedCheckName}`,
    };
  }

  if (sourceSummary.total === 0 || sourceSummary.skipped === sourceSummary.total) {
    return {
      status: 'inconclusive',
      reason: 'Predecessor source checks were inconclusive (all checks skipped)',
    };
  }

  const destinationByChain = new Map<
    number,
    Array<NonNullable<SimulationResult['destinationSimulations']>[number]>
  >();

  for (const destination of predecessorResult.destinationSimulations ?? []) {
    const existing = destinationByChain.get(destination.chainId) ?? [];
    existing.push(destination);
    destinationByChain.set(destination.chainId, existing);
  }

  for (const [chainId, destinationSims] of destinationByChain.entries()) {
    if (!supportsL2Checks(chainId)) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination chain ${chainId} does not support L2 checks`,
      };
    }

    const notFullyValidated = destinationSims.some((sim) => sim.status !== 'success' || !sim.sim);
    if (notFullyValidated) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination simulation for chain ${chainId} was not fully validated`,
      };
    }

    const destinationChecks = predecessorDestinationChecks[chainId];
    if (!destinationChecks) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination checks missing for chain ${chainId}`,
      };
    }

    const destinationSummary = summarizeChecks(destinationChecks);
    if (destinationSummary.failedCheckName) {
      return {
        status: 'failed',
        reason: `Predecessor check failed: ${destinationSummary.failedCheckName}`,
      };
    }

    if (destinationSummary.total === 0 || destinationSummary.skipped === destinationSummary.total) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination checks were inconclusive for chain ${chainId} (all checks skipped)`,
      };
    }
  }

  return { status: 'passed' };
}

export function buildDerivedBaselineChains(
  result: Pick<SimulationResult, 'sim' | 'destinationSimulations'>,
): DerivedBaselineChain[] {
  const baselines: DerivedBaselineChain[] = [];

  baselines.push({
    chainId: 1,
    simulationId: result.sim.simulation.id,
    blockNumber: result.sim.simulation.block_number.toString(),
  });

  for (const destination of result.destinationSimulations ?? []) {
    if (!destination.sim) continue;
    baselines.push({
      chainId: destination.chainId,
      simulationId: destination.sim.simulation.id,
      blockNumber: destination.sim.simulation.block_number.toString(),
    });
  }

  return baselines;
}

export function buildDerivedProvenance(params: {
  outcome: DependencyOutcome | { status: 'skipped'; reason: string };
  reference: DependencyReference;
  baselineChains?: DerivedBaselineChain[];
}): DerivedSimulationProvenance {
  return {
    mode: 'derived',
    status: params.outcome.status,
    reason: params.outcome.reason,
    derivedFromProposalId: params.reference.proposalId,
    derivedFromSimulationId: params.reference.simulationId,
    baselineChains: params.baselineChains ?? [],
  };
}
