import type { Address } from 'viem';

export type SimulationType = 'new' | 'proposed' | 'executed';
export type WriteAction = 'propose' | 'execute';
export type ProposalActionMode = SimulationType | 'invalid';
export type ProposalActionAvailability = WriteAction | 'none';
export type ProposalBlockedState = 'defeated' | 'expired' | 'canceled' | 'unknown' | null;

export interface ProposalActionResolution {
  mode: ProposalActionMode;
  availability: ProposalActionAvailability;
  blockedState: ProposalBlockedState;
}

export function parseSimulationType(value: unknown): SimulationType | null {
  if (value === 'new' || value === 'proposed' || value === 'executed') return value;
  return null;
}

export function resolveProposalAction(
  simulationType: unknown,
  proposalState?: string | null,
): ProposalActionResolution {
  if (simulationType == null) {
    return {
      mode: 'new',
      availability: 'propose',
      blockedState: null,
    };
  }

  const parsedSimulationType = parseSimulationType(simulationType);
  if (!parsedSimulationType) {
    return {
      mode: 'invalid',
      availability: 'none',
      blockedState: null,
    };
  }

  if (parsedSimulationType === 'new') {
    return {
      mode: 'new',
      availability: 'propose',
      blockedState: null,
    };
  }

  if (parsedSimulationType === 'executed') {
    return {
      mode: 'executed',
      availability: 'none',
      blockedState: null,
    };
  }

  if (proposalState === 'Queued') {
    return {
      mode: 'proposed',
      availability: 'execute',
      blockedState: null,
    };
  }

  if (proposalState === 'Defeated') {
    return {
      mode: 'proposed',
      availability: 'none',
      blockedState: 'defeated',
    };
  }

  if (proposalState === 'Expired') {
    return {
      mode: 'proposed',
      availability: 'none',
      blockedState: 'expired',
    };
  }

  if (proposalState === 'Canceled') {
    return {
      mode: 'proposed',
      availability: 'none',
      blockedState: 'canceled',
    };
  }

  return {
    mode: 'proposed',
    availability: 'none',
    blockedState: 'unknown',
  };
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
