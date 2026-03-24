import { type Address, type Hex, getAddress } from 'viem';
import type {
  CrossChainExecutionJob,
  CrossChainExecutionJobResult,
  SimulationResult,
  TenderlyPayload,
  TenderlySimulation,
} from '../../types.d';
import { extractArbitrumL1L2JobsFromProposal } from '../bridges/arbitrum';
import { extractOptimismL1L2JobsFromProposal } from '../bridges/optimism';
import {
  extractWormholeExecutionJobsFromProposal,
  getWormholeLaneCapabilities,
} from '../bridges/wormhole';
import { supportsTenderlyDestinationSimulation } from '../chains/capabilities';
import { getClientForChain } from '../clients/client';
import { getTenderlySaveFlags, sendSimulation } from '../clients/tenderly-api';
import { BLOCK_GAS_LIMIT } from '../constants';
import {
  type DerivedStateByChain,
  type SimulationStateObjects,
  extractStateOverridesFromSimulation,
  mergeStateObjects,
} from '../derived-state';
import {
  WORMHOLE_CORE_STUB_RUNTIME_BYTECODE,
  WORMHOLE_RECEIVER_ABI,
  type WormholeReceiverRuntimeState,
  type WormholeReceiverRuntimeStateCacheKey,
  buildWormholeReceiverSimulationCall,
  getOverriddenWormholeReceiverSequence,
  getWormholeReceiverRuntimeStateKey,
} from './wormhole-receiver-sim';

export interface TenderlySimulationExecutionOptions {
  derivedStateByChain?: DerivedStateByChain;
  initialStateByChain?: DerivedStateByChain;
}

export type TenderlyCrossChainSimulationSourceResult = Pick<
  SimulationResult,
  'proposal' | 'deps' | 'latestBlock' | 'simulationTimestamp'
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

export type TenderlyCrossChainSimulationHandledResult<
  T extends TenderlyCrossChainSimulationSourceResult,
> = Omit<T, 'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'> &
  Required<
    Pick<
      SimulationResult,
      'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'
    >
  >;

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

const DEFAULT_CROSS_CHAIN_SIMULATION_SENDER = getAddress(
  '0x0000000000000000000000000000000000001234',
);

type WormholeReceiverRuntimeStateByKey = Record<
  WormholeReceiverRuntimeStateCacheKey,
  WormholeReceiverRuntimeState
>;

const DESTINATION_SETUP_MAX_ATTEMPTS = 3;

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
  options?: TenderlySimulationExecutionOptions,
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withDestinationSetupRetry<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DESTINATION_SETUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt === DESTINATION_SETUP_MAX_ATTEMPTS) {
        throw error;
      }

      console.warn(
        `[CrossChainHandler] Retrying destination job setup ${label} (attempt ${attempt + 1}/${DESTINATION_SETUP_MAX_ATTEMPTS}) after error: ${getErrorMessage(error)}`,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function getWormholeReceiverCoreAddress(job: CrossChainExecutionJob): Address | null {
  if (job.bridgeType !== 'WormholeL1L2') return null;
  return getWormholeLaneCapabilities(job.wormholeChainId).receiverCoreAddress;
}

function isWormholeReceiverModeJob(job: CrossChainExecutionJob): boolean {
  return getWormholeReceiverCoreAddress(job) !== null && job.wormholeChainId !== undefined;
}

function parseLegacyWormholeReceiverSequenceStorage(
  storedSequence: Hex | undefined,
  job: CrossChainExecutionJob,
  runtimeStateBlockNumber: bigint,
): bigint {
  if (storedSequence === undefined || storedSequence === '0x') {
    throw new Error(
      `Missing legacy Wormhole receiver sequence storage for ${job.l2FromAddress} at block ${runtimeStateBlockNumber.toString()}`,
    );
  }

  try {
    return BigInt(storedSequence);
  } catch {
    throw new Error(
      `Invalid legacy Wormhole receiver sequence storage for ${job.l2FromAddress} at block ${runtimeStateBlockNumber.toString()}: ${storedSequence}`,
    );
  }
}

async function resolveLegacyWormholeReceiverRuntimeState(
  job: CrossChainExecutionJob,
  runtimeStateBlockNumber: bigint,
  payloadVersion: Hex,
  nextSequenceStorageSlot: `0x${string}`,
  overriddenSequence: bigint | null,
): Promise<WormholeReceiverRuntimeState> {
  const client = getClientForChain(job.destinationChainId);
  const nextSequence =
    overriddenSequence ??
    parseLegacyWormholeReceiverSequenceStorage(
      await withDestinationSetupRetry(
        `legacy sequence storage for ${job.l2FromAddress} on chain ${job.destinationChainId}`,
        async () =>
          await client.getStorageAt({
            address: job.l2FromAddress,
            slot: nextSequenceStorageSlot,
            blockNumber: runtimeStateBlockNumber,
          }),
      ),
      job,
      runtimeStateBlockNumber,
    );

  return {
    nextSequence,
    expectedPayloadVersion: payloadVersion,
  };
}

async function resolveModernWormholeReceiverRuntimeState(
  job: CrossChainExecutionJob,
  runtimeStateBlockNumber: bigint,
  overriddenSequence: bigint | null,
): Promise<WormholeReceiverRuntimeState> {
  const client = getClientForChain(job.destinationChainId);
  const expectedPayloadVersion = await withDestinationSetupRetry(
    `EXPECTED_MESSAGE_PAYLOAD_VERSION for ${job.l2FromAddress} on chain ${job.destinationChainId}`,
    async () =>
      await client.readContract({
        address: job.l2FromAddress,
        abi: WORMHOLE_RECEIVER_ABI,
        functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
        blockNumber: runtimeStateBlockNumber,
      }),
  );
  const nextSequence =
    overriddenSequence ??
    BigInt(
      await withDestinationSetupRetry(
        `nextMinimumSequence for ${job.l2FromAddress} on chain ${job.destinationChainId}`,
        async () =>
          await client.readContract({
            address: job.l2FromAddress,
            abi: WORMHOLE_RECEIVER_ABI,
            functionName: 'nextMinimumSequence',
            blockNumber: runtimeStateBlockNumber,
          }),
      ),
    );

  return {
    nextSequence,
    expectedPayloadVersion,
  };
}

async function findBlockNumberAtOrBeforeTimestamp(
  chainId: number,
  sourceTimestamp: bigint,
): Promise<bigint> {
  const client = getClientForChain(chainId);
  const latestBlockNumber = await withDestinationSetupRetry(
    `latest block number on chain ${chainId}`,
    async () => await client.getBlockNumber(),
  );
  const latestBlock = await withDestinationSetupRetry(
    `latest block on chain ${chainId}`,
    async () => await client.getBlock({ blockNumber: latestBlockNumber }),
  );
  if (latestBlock.timestamp <= sourceTimestamp) return latestBlock.number;

  let low = 0n;
  let high = latestBlock.number;
  let best = 0n;

  while (low <= high) {
    const mid = (low + high) / 2n;
    const candidateBlock = await withDestinationSetupRetry(
      `block ${mid} on chain ${chainId}`,
      async () => await client.getBlock({ blockNumber: mid }),
    );

    if (candidateBlock.timestamp <= sourceTimestamp) {
      best = candidateBlock.number;
      low = mid + 1n;
    } else {
      high = mid - 1n;
    }
  }

  return best;
}

async function resolveWormholeReceiverRuntimeState(
  job: CrossChainExecutionJob,
  runtimeStateByKey: WormholeReceiverRuntimeStateByKey,
  workingState: SimulationStateObjects | undefined,
  sourceTimestamp: bigint,
): Promise<WormholeReceiverRuntimeState | null> {
  if (!isWormholeReceiverModeJob(job)) return null;

  const runtimeStateKey = getWormholeReceiverRuntimeStateKey(
    job.destinationChainId,
    job.l2FromAddress,
  );
  const overriddenSequence = getOverriddenWormholeReceiverSequence(workingState, job.l2FromAddress);
  const cached = runtimeStateByKey[runtimeStateKey];
  if (cached) {
    if (overriddenSequence === null) return cached;

    const refreshedRuntimeState = {
      ...cached,
      nextSequence: overriddenSequence,
    } satisfies WormholeReceiverRuntimeState;
    runtimeStateByKey[runtimeStateKey] = refreshedRuntimeState;
    return refreshedRuntimeState;
  }

  const runtimeStateBlockNumber = await findBlockNumberAtOrBeforeTimestamp(
    job.destinationChainId,
    sourceTimestamp,
  );
  const laneCapabilities = getWormholeLaneCapabilities(job.wormholeChainId);
  const runtimeState =
    laneCapabilities.kind === 'legacy'
      ? await resolveLegacyWormholeReceiverRuntimeState(
          job,
          runtimeStateBlockNumber,
          laneCapabilities.payloadVersion,
          laneCapabilities.nextSequenceStorageSlot,
          overriddenSequence,
        )
      : await resolveModernWormholeReceiverRuntimeState(
          job,
          runtimeStateBlockNumber,
          overriddenSequence,
        );
  runtimeStateByKey[runtimeStateKey] = runtimeState;
  return runtimeState;
}

function formatPayloadForLog(payload: TenderlyPayload, isReceiverMode: boolean): string {
  if (!isReceiverMode) {
    return JSON.stringify(payload, null, 2);
  }

  return JSON.stringify(
    {
      network_id: payload.network_id,
      from: payload.from,
      to: payload.to,
      value: payload.value,
      gas: payload.gas,
      receiverMode: true,
      inputPrefix:
        typeof payload.input === 'string' ? `${payload.input.slice(0, 18)}...` : payload.input,
      stateObjectKeys: Object.keys(payload.state_objects ?? {}),
    },
    null,
    2,
  );
}

function stripSimulationOnlyState(
  job: CrossChainExecutionJob,
  workingState: SimulationStateObjects | undefined,
): SimulationStateObjects | undefined {
  const wormholeCoreAddress = getWormholeReceiverCoreAddress(job);
  if (!wormholeCoreAddress || !workingState) return workingState;

  const nextState = { ...workingState };
  const wormholeCoreState = nextState[wormholeCoreAddress];
  if (!wormholeCoreState) return nextState;

  const { code: _simulationOnlyCode, ...persistedState } = wormholeCoreState;
  if (Object.keys(persistedState).length === 0) {
    delete nextState[wormholeCoreAddress];
    return nextState;
  }

  nextState[wormholeCoreAddress] = persistedState;
  return nextState;
}

function buildDestinationSimulationPayload(
  job: CrossChainExecutionJob,
  call: CrossChainExecutionJob['calls'][number],
  workingState: SimulationStateObjects | undefined,
  isReceiverMode: boolean,
): TenderlyPayload {
  const { save, saveIfFails } = getTenderlySaveFlags(true);
  const wormholeCoreAddress = getWormholeReceiverCoreAddress(job);
  const stateObjects =
    isReceiverMode && wormholeCoreAddress
      ? mergeStateObjects(workingState, {
          [wormholeCoreAddress]: {
            code: WORMHOLE_CORE_STUB_RUNTIME_BYTECODE,
          },
        })
      : workingState;

  return {
    network_id: job.destinationChainId.toString() as TenderlyPayload['network_id'],
    from: isReceiverMode ? DEFAULT_CROSS_CHAIN_SIMULATION_SENDER : job.l2FromAddress,
    to: call.l2TargetAddress,
    input: call.l2InputData,
    gas: BLOCK_GAS_LIMIT,
    gas_price: '0',
    value: call.l2Value,
    save_if_fails: saveIfFails,
    save,
    state_objects: stateObjects,
  };
}

async function simulateDestinationCall(
  job: CrossChainExecutionJob,
  call: CrossChainExecutionJob['calls'][number],
  workingState: SimulationStateObjects | undefined,
  stepIndex: number,
  totalSteps: number,
  isReceiverMode: boolean,
): Promise<TenderlySimulation> {
  const payload = buildDestinationSimulationPayload(job, call, workingState, isReceiverMode);

  console.log(
    `[CrossChainHandler] Sending L2 Simulation Payload (Chain ${payload.network_id}, Step ${stepIndex + 1}/${totalSteps}):`,
    formatPayloadForLog(payload, isReceiverMode),
  );

  return await sendSimulation(payload);
}

async function executeDestinationJob(
  job: CrossChainExecutionJob,
  committedState: SimulationStateObjects | undefined,
  runtimeStateByKey: WormholeReceiverRuntimeStateByKey,
  sourceTimestamp: bigint,
): Promise<DestinationJobExecutionOutcome> {
  let workingState = mergeStateObjects(committedState, undefined);
  const stepResults: CrossChainExecutionJobResult['stepResults'] = [];
  let accumulatedSim: TenderlySimulation | undefined;
  let wormholeReceiverRuntimeState: WormholeReceiverRuntimeState | null;

  try {
    wormholeReceiverRuntimeState = await resolveWormholeReceiverRuntimeState(
      job,
      runtimeStateByKey,
      workingState,
      sourceTimestamp,
    );
  } catch (error: unknown) {
    const jobError = `Destination job setup failed: ${getErrorMessage(error)}`;
    console.error(
      `[CrossChainHandler] Error preparing destination job on chain ${job.destinationChainId}:`,
      error,
    );

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
  const wormholeReceiverMode = wormholeReceiverRuntimeState !== null;
  const stepCalls = wormholeReceiverRuntimeState
    ? [buildWormholeReceiverSimulationCall(job, wormholeReceiverRuntimeState, sourceTimestamp)]
    : job.calls;

  for (let stepIndex = 0; stepIndex < stepCalls.length; stepIndex += 1) {
    const call = stepCalls[stepIndex];

    try {
      const destSim = await simulateDestinationCall(
        job,
        call,
        workingState,
        stepIndex,
        stepCalls.length,
        wormholeReceiverMode,
      );

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
      const nextWorkingState =
        mergeStateObjects(workingState, extractStateOverridesFromSimulation(destSim)) ??
        workingState;

      if (wormholeReceiverRuntimeState) {
        const nextSequence =
          getOverriddenWormholeReceiverSequence(nextWorkingState, job.l2FromAddress) ??
          wormholeReceiverRuntimeState.nextSequence + 1n;
        runtimeStateByKey[
          getWormholeReceiverRuntimeStateKey(job.destinationChainId, job.l2FromAddress)
        ] = {
          ...wormholeReceiverRuntimeState,
          nextSequence,
        };
      }
      workingState = nextWorkingState;
    } catch (error: unknown) {
      const jobError = `Destination job step simulation API call failed: ${getErrorMessage(error)}`;
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
    committedState: stripSimulationOnlyState(job, workingState),
  };
}

export async function handleCrossChainSimulations<
  T extends TenderlyCrossChainSimulationSourceResult,
>(
  sourceResult: T,
  options?: TenderlySimulationExecutionOptions,
): Promise<TenderlyCrossChainSimulationHandledResult<T>> {
  const result: TenderlyCrossChainSimulationHandledResult<T> = {
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
  const wormholeReceiverRuntimeStateByKey: WormholeReceiverRuntimeStateByKey = {};
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

    if (!supportsTenderlyDestinationSimulation(destinationChainId)) {
      const skippedResult = buildSkippedDestinationJobResult(job);
      console.warn(`[CrossChainHandler] ${skippedResult.error}`);
      destinationResults.push(skippedResult);
      continue;
    }

    const executionOutcome = await executeDestinationJob(
      job,
      committedStateByChain[destinationChainId],
      wormholeReceiverRuntimeStateByKey,
      result.simulationTimestamp ?? result.latestBlock.timestamp,
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
