import type { Address } from 'viem';

export type SimulationType = 'new' | 'proposed' | 'executed';
export type WriteAction = 'propose' | 'execute';
export type ProposalActionBlockedReason = 'defeated' | 'expired' | 'canceled' | 'unknown';
export type ProposalActionResolution =
  | { kind: 'propose' }
  | { kind: 'execute' }
  | { kind: 'executed' }
  | { kind: 'invalid' }
  | { kind: 'blocked'; reason: ProposalActionBlockedReason };

export function parseSimulationType(value: unknown): SimulationType | null {
  if (value === 'new' || value === 'proposed' || value === 'executed') return value;
  return null;
}

export function resolveProposalAction(
  simulationType: unknown,
  proposalState?: string | null,
): ProposalActionResolution {
  if (simulationType == null) {
    return { kind: 'propose' };
  }

  const parsedSimulationType = parseSimulationType(simulationType);
  if (!parsedSimulationType) {
    return { kind: 'invalid' };
  }

  if (parsedSimulationType === 'new') {
    return { kind: 'propose' };
  }

  if (parsedSimulationType === 'executed') {
    return { kind: 'executed' };
  }

  if (proposalState === 'Queued') {
    return { kind: 'execute' };
  }

  if (proposalState === 'Defeated') {
    return { kind: 'blocked', reason: 'defeated' };
  }

  if (proposalState === 'Expired') {
    return { kind: 'blocked', reason: 'expired' };
  }

  if (proposalState === 'Canceled') {
    return { kind: 'blocked', reason: 'canceled' };
  }

  return { kind: 'blocked', reason: 'unknown' };
}

export type ProposeLike = {
  targets: readonly Address[];
  values: readonly (bigint | string | number)[];
  signatures: readonly string[];
  calldatas: readonly `0x${string}`[];
  description: string;
};

export function buildProposeArgs(proposalData: ProposeLike) {
  return [
    proposalData.targets,
    proposalData.values.map((value) => BigInt(value)),
    proposalData.signatures,
    proposalData.calldatas,
    proposalData.description,
  ] as const;
}

export function buildExecuteArgs(proposalId: string | bigint) {
  return [BigInt(proposalId)] as const;
}

export type ExecuteSimulationLike = {
  report: {
    structuredReport?: {
      metadata?: {
        proposalId?: string;
        simulationType?: SimulationType;
      };
    };
  };
};

export function buildExecuteArgsFromSimulationData(simulationData: ExecuteSimulationLike) {
  const proposalId = simulationData.report.structuredReport?.metadata?.proposalId;
  if (!proposalId) throw new Error('Proposal ID not found in simulation data');
  return buildExecuteArgs(proposalId);
}
