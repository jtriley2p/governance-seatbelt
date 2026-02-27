import type {
  AllCheckResults,
  DependencyStatus,
  DerivedBaselineChain,
  DerivedSimulationProvenance,
  SimulationResult,
  TenderlyPayload,
  TenderlySimulation,
} from '../types.d';

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

export function mergeStateObjects(
  base: TenderlyPayload['state_objects'] | undefined,
  overrides: TenderlyPayload['state_objects'] | undefined,
): SimulationStateObjects | undefined {
  if (!base && !overrides) return undefined;
  if (!base) return { ...(overrides ?? {}) };
  if (!overrides) return { ...base };

  const merged: SimulationStateObjects = { ...base };

  for (const [address, overrideState] of Object.entries(overrides)) {
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

  for (const entry of stateDiff) {
    for (const raw of entry.raw ?? []) {
      const address = raw.address.toLowerCase();
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
 * - inconclusive if checks did not execute (all skipped)
 * - otherwise passed
 */
export function evaluateDependencyOutcome(
  predecessorResult: Pick<SimulationResult, 'sim' | 'crossChainFailure'>,
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

  const allCheckGroups = [predecessorChecks, ...Object.values(predecessorDestinationChecks)];
  let totalChecks = 0;
  let skippedChecks = 0;

  for (const group of allCheckGroups) {
    for (const check of Object.values(group)) {
      totalChecks += 1;

      if (check.result.errors.length > 0) {
        return {
          status: 'failed',
          reason: `Predecessor check failed: ${check.name}`,
        };
      }

      if (check.result.skipped) {
        skippedChecks += 1;
      }
    }
  }

  if (totalChecks === 0 || skippedChecks === totalChecks) {
    return {
      status: 'inconclusive',
      reason: 'Predecessor checks were inconclusive (all checks skipped)',
    };
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
