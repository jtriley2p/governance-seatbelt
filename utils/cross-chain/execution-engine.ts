import type { Address } from 'viem';
import type {
  CrossChainExecutionJob,
  CrossChainExecutionJobResult,
  SimulationResult,
  TenderlyPayload,
  TenderlySimulation,
} from '../../types.d';
import { extractArbitrumL1L2JobsFromProposal } from '../bridges/arbitrum';
import { extractOptimismL1L2JobsFromProposal } from '../bridges/optimism';
import { extractWormholeExecutionJobsFromProposal } from '../bridges/wormhole';
import {
  type DerivedStateByChain,
  type SimulationStateObjects,
  extractStateOverridesFromSimulation,
  mergeStateObjects,
} from '../derived-state';

export interface SimulationExecutionOptions {
  derivedStateByChain?: DerivedStateByChain;
  initialStateByChain?: DerivedStateByChain;
}

export type CrossChainSimulationSourceResult = Pick<
  SimulationResult,
  'proposal' | 'deps' | 'latestBlock'
> & {
  sim: {
    transaction: {
      status: boolean;
      transaction_info?: {
        call_trace?: {
          from: string;
          input: string;
          calls?: unknown[];
        };
      };
    };
  };
  destinationJobResults?: CrossChainExecutionJobResult[];
  destinationStateByChain?: Record<number, NonNullable<TenderlyPayload['state_objects']>>;
  crossChainFailure?: boolean;
};

export type CrossChainSimulationHandledResult<T extends CrossChainSimulationSourceResult> = Omit<
  T,
  'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'
> &
  Required<
    Pick<
      SimulationResult,
      'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'
    >
  >;

export interface CrossChainExecutionAdapter {
  supportsChain(chainId: number): boolean;
  simulateStep(
    job: CrossChainExecutionJob,
    call: CrossChainExecutionJob['calls'][number],
    workingState: SimulationStateObjects | undefined,
    stepIndex: number,
  ): Promise<TenderlySimulation>;
}

type DestinationJobExecutionOutcome =
  | {
      status: 'success';
      jobResult: CrossChainExecutionJobResult;
      committedState: SimulationStateObjects | undefined;
    }
  | {
      status: 'failure';
      jobResult: CrossChainExecutionJobResult;
    };

function extractDestinationJobs(
  targets: readonly string[],
  calldatas: readonly string[],
  l1Sender?: Address,
): CrossChainExecutionJob[] {
  const orderedJobs: Array<{ extractionIndex: number; job: CrossChainExecutionJob }> = [];
  let extractionIndex = 0;

  for (const job of extractArbitrumL1L2JobsFromProposal(targets, calldatas, l1Sender)) {
    orderedJobs.push({ extractionIndex, job });
    extractionIndex += 1;
  }

  for (const job of extractOptimismL1L2JobsFromProposal(targets, calldatas, l1Sender)) {
    orderedJobs.push({ extractionIndex, job });
    extractionIndex += 1;
  }

  for (const job of extractWormholeExecutionJobsFromProposal(targets, calldatas)) {
    orderedJobs.push({ extractionIndex, job });
    extractionIndex += 1;
  }

  orderedJobs.sort(
    (a, b) => a.job.sourceOrder - b.job.sourceOrder || a.extractionIndex - b.extractionIndex,
  );

  return orderedJobs.map(({ job }) => job);
}

function initializeCommittedStateByChain(
  jobs: CrossChainExecutionJob[],
  options?: SimulationExecutionOptions,
): DerivedStateByChain {
  const committedStateByChain: DerivedStateByChain = {};

  for (const chainId of new Set(jobs.map((job) => job.destinationChainId))) {
    const committed = mergeStateObjects(
      options?.initialStateByChain?.[chainId],
      options?.derivedStateByChain?.[chainId],
    );
    if (committed) {
      committedStateByChain[chainId] = committed;
    }
  }

  return committedStateByChain;
}

function getDestinationFailureReason(sim: TenderlySimulation): string {
  const traceReason = sim.transaction?.transaction_info?.call_trace?.error_reason;
  if (traceReason && traceReason.trim().length > 0) return traceReason;

  const stackReason = sim.transaction?.transaction_info?.stack_trace?.find(
    (frame) =>
      (typeof frame.error_reason === 'string' && frame.error_reason.trim().length > 0) ||
      (typeof frame.error === 'string' && frame.error.trim().length > 0),
  );
  if (stackReason?.error_reason?.trim()) return stackReason.error_reason;
  if (stackReason?.error?.trim()) return stackReason.error;

  return 'Destination job failed (no detailed error returned by Tenderly).';
}

function buildSkippedDestinationJobResult(
  job: CrossChainExecutionJob,
): CrossChainExecutionJobResult {
  return {
    chainId: job.destinationChainId,
    bridgeType: job.bridgeType,
    job,
    status: 'skipped',
    stepResults: [],
    error: `Skipping destination job: chain ${job.destinationChainId} is not currently supported in this Tenderly workflow.`,
  };
}

async function executeDestinationJob(
  job: CrossChainExecutionJob,
  committedState: SimulationStateObjects | undefined,
  adapter: CrossChainExecutionAdapter,
): Promise<DestinationJobExecutionOutcome> {
  let workingState = mergeStateObjects(committedState, undefined);
  const stepResults: CrossChainExecutionJobResult['stepResults'] = [];
  let accumulatedSim: TenderlySimulation | undefined;

  for (let stepIndex = 0; stepIndex < job.calls.length; stepIndex += 1) {
    const call = job.calls[stepIndex];

    try {
      const destSim = await adapter.simulateStep(job, call, workingState, stepIndex);

      if (!destSim.transaction.status) {
        const jobError = getDestinationFailureReason(destSim);
        console.error(
          `[CrossChainHandler] Destination job step failed for L2 target: ${call.l2TargetAddress}`,
        );
        stepResults.push({
          stepIndex,
          call,
          status: 'failure',
          sim: destSim,
          error: jobError,
        });

        return {
          status: 'failure',
          jobResult: {
            chainId: job.destinationChainId,
            bridgeType: job.bridgeType,
            job,
            status: 'failure',
            stepResults,
            error: jobError,
          },
        };
      }

      accumulatedSim = destSim;
      stepResults.push({
        stepIndex,
        call,
        status: 'success',
        sim: destSim,
      });
      workingState =
        mergeStateObjects(workingState, extractStateOverridesFromSimulation(destSim)) ??
        workingState;
    } catch (error: unknown) {
      const jobError = `Destination job step simulation API call failed: ${(error as Error).message}`;
      console.error(
        `[CrossChainHandler] Error during destination job step simulation API call for L2 target ${call.l2TargetAddress}:`,
        error,
      );
      stepResults.push({
        stepIndex,
        call,
        status: 'failure',
        error: jobError,
      });

      return {
        status: 'failure',
        jobResult: {
          chainId: job.destinationChainId,
          bridgeType: job.bridgeType,
          job,
          status: 'failure',
          stepResults,
          error: jobError,
        },
      };
    }
  }

  return {
    status: 'success',
    jobResult: {
      chainId: job.destinationChainId,
      bridgeType: job.bridgeType,
      job,
      status: 'success',
      stepResults,
      accumulatedSim,
    },
    committedState: workingState,
  };
}

export async function runCrossChainExecutionEngine<T extends CrossChainSimulationSourceResult>(
  sourceResult: T,
  adapter: CrossChainExecutionAdapter,
  options?: SimulationExecutionOptions,
): Promise<CrossChainSimulationHandledResult<T>> {
  const result: CrossChainSimulationHandledResult<T> = {
    ...sourceResult,
    destinationJobResults: sourceResult.destinationJobResults ?? [],
    destinationStateByChain: sourceResult.destinationStateByChain ?? {},
    crossChainFailure: sourceResult.crossChainFailure ?? false,
  };

  if (!result.sim.transaction.status) {
    console.log('[CrossChainHandler] Source simulation failed, skipping destination checks.');
    return result;
  }

  console.log('[CrossChainHandler] Parsing source sim for execution jobs...');

  if (!result.proposal?.targets?.length || !result.proposal?.calldatas?.length) {
    console.log('[CrossChainHandler] No cross-chain execution jobs detected.');
    return result;
  }

  const l1Sender = result.deps?.timelock?.address;
  const extractedJobs = extractDestinationJobs(
    result.proposal.targets,
    result.proposal.calldatas,
    l1Sender,
  );

  if (extractedJobs.length === 0) {
    console.log('[CrossChainHandler] No cross-chain execution jobs detected.');
    return result;
  }

  const committedStateByChain = initializeCommittedStateByChain(extractedJobs, options);
  const destinationResults: CrossChainExecutionJobResult[] = [];

  console.log(
    `[CrossChainHandler] Detected ${extractedJobs.length} execution jobs. Executing destination jobs...`,
  );

  for (const job of extractedJobs) {
    const destinationChainId = job.destinationChainId;
    const targetSummary = job.calls.map((call) => call.l2TargetAddress).join(', ');
    console.log(
      `[CrossChainHandler] Executing destination job on chain ${destinationChainId}: ${targetSummary}`,
    );

    if (!adapter.supportsChain(destinationChainId)) {
      const skippedResult = buildSkippedDestinationJobResult(job);
      console.warn(`[CrossChainHandler] ${skippedResult.error}`);
      destinationResults.push(skippedResult);
      continue;
    }

    const executionOutcome = await executeDestinationJob(
      job,
      committedStateByChain[destinationChainId],
      adapter,
    );
    if (executionOutcome.status === 'success' && executionOutcome.committedState) {
      committedStateByChain[destinationChainId] = executionOutcome.committedState;
    }
    destinationResults.push(executionOutcome.jobResult);
  }

  result.destinationJobResults = destinationResults;
  result.destinationStateByChain = committedStateByChain;
  result.crossChainFailure = destinationResults.some((res) => res.status === 'failure');

  return result;
}
