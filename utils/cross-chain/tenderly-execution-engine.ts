import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, type Address } from 'viem';
import { tempo } from 'viem/chains';
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
import { supportsTenderlyDestinationSimulation } from '../chains/capabilities';
import { getTenderlySaveFlags, sendSimulation } from '../clients/tenderly-api';
import { BLOCK_GAS_LIMIT } from '../constants';
import {
  type DerivedStateByChain,
  type SimulationStateObjects,
  extractStateOverridesFromSimulation,
  mergeStateObjects,
} from '../derived-state';

export interface TenderlySimulationExecutionOptions {
  derivedStateByChain?: DerivedStateByChain;
  initialStateByChain?: DerivedStateByChain;
}

export type TenderlyCrossChainSimulationSourceResult = Pick<
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

const WORMHOLE_RECEIVER_ABI = parseAbi(['function receiveMessage(bytes whMessage)']);
const WORMHOLE_EXPECTED_MESSAGE_PAYLOAD_VERSION =
  '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b' as const;
const WORMHOLE_CORE_STUB_RUNTIME_BYTECODE =
  '0x608060405234801561000f575f5ffd5b5060043610610029575f3560e01c8063c0fd8bde1461002d575b5f5ffd5b61004061003b3660046101b0565b610058565b60405161004f939291906102b2565b60405180910390f35b60408051610160810182525f8082526020820181905291810182905260608082018390526080820183905260a0820183905260c0820183905260e0820181905261010082018390526101208201526101408101919091525f60608180806100c1878901896103d4565b6040805161016081018252600180825263ffffffff861660208301525f9282018390526002606083015273f5f4496219f31cdcba6130b5402873624585615a608083015267ffffffffffffffff851660a083015260c082015260e081018390526101008101829052939650919450925061012082019060405190808252806020026020018201604052801561018757816020015b604080516080810182525f8082526020808301829052928201819052606082015282525f199092019101816101555790505b5081525f6020918201819052604080519283019052815290996001995090975095505050505050565b5f5f602083850312156101c1575f5ffd5b823567ffffffffffffffff8111156101d7575f5ffd5b8301601f810185136101e7575f5ffd5b803567ffffffffffffffff8111156101fd575f5ffd5b85602082840101111561020e575f5ffd5b6020919091019590945092505050565b5f81518084528060208401602086015e5f602082860101526020601f19601f83011685010191505092915050565b5f8151808452602084019350602083015f5b828110156102a8578151805187526020810151602088015260ff604082015116604088015260ff60608201511660608801525060808601955060208201915060018101905061025e565b5093949350505050565b606081526102c660608201855160ff169052565b5f60208501516102de608084018263ffffffff169052565b50604085015163ffffffff811660a084015250606085015161ffff811660c084015250608085015160e083015260a085015167ffffffffffffffff81166101008401525060c085015160ff81166101208401525060e085015161016061014084015261034e6101c084018261021e565b905061010086015161036961016085018263ffffffff169052565b50610120860151838203605f1901610180850152610387828261024c565b9150506101408601516101a08401526103a4602084018615159052565b82810360408401526103b6818561021e565b9695505050505050565b634e487b7160e01b5f52604160045260245ffd5b5f5f5f606084860312156103e6575f5ffd5b833563ffffffff811681146103f9575f5ffd5b9250602084013567ffffffffffffffff81168114610415575f5ffd5b9150604084013567ffffffffffffffff811115610430575f5ffd5b8401601f81018613610440575f5ffd5b803567ffffffffffffffff81111561045a5761045a6103c0565b604051601f8201601f19908116603f0116810167ffffffffffffffff81118282101715610489576104896103c0565b6040528181528282016020018810156104a0575f5ffd5b816020840160208301375f60208383010152809350505050925092509256fea26469706673582212206fa9c9eaf2c0ba0c1e9f3175957f3110f5020be643dd54c436de98a8bdde207964736f6c63430008210033' as const;

const WORMHOLE_RECEIVER_TENDERLY_CORE_BY_DESTINATION_CHAIN_ID: Record<number, Address> = {
  [tempo.id]: getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6'),
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

function getWormholeReceiverCoreAddress(job: CrossChainExecutionJob): Address | null {
  if (job.bridgeType !== 'WormholeL1L2') return null;
  return WORMHOLE_RECEIVER_TENDERLY_CORE_BY_DESTINATION_CHAIN_ID[job.destinationChainId] ?? null;
}

function getWormholeReceiverSequence(
  job: CrossChainExecutionJob,
  workingState: SimulationStateObjects | undefined,
): bigint {
  const currentValue = workingState?.[job.l2FromAddress]?.storage?.[
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  ];
  if (!currentValue) return 0n;

  try {
    return BigInt(currentValue);
  } catch {
    return 0n;
  }
}

function stripSimulationOnlyState(
  job: CrossChainExecutionJob,
  workingState: SimulationStateObjects | undefined,
): SimulationStateObjects | undefined {
  const wormholeCoreAddress = getWormholeReceiverCoreAddress(job);
  if (!wormholeCoreAddress || !workingState) return workingState;

  const nextState = { ...workingState };
  delete nextState[wormholeCoreAddress];
  return nextState;
}

function buildWormholeReceiverSimulationCall(
  job: CrossChainExecutionJob,
  sequence: bigint,
): CrossChainExecutionJob['calls'][number] {
  const totalValue = job.calls.reduce((sum, call) => sum + BigInt(call.l2Value), 0n);
  const whPayload = encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'address[]' },
      { type: 'uint256[]' },
      { type: 'bytes[]' },
      { type: 'address' },
      { type: 'uint16' },
    ],
    [
      WORMHOLE_EXPECTED_MESSAGE_PAYLOAD_VERSION,
      job.calls.map((call) => call.l2TargetAddress),
      job.calls.map((call) => BigInt(call.l2Value)),
      job.calls.map((call) => call.l2InputData),
      job.l2FromAddress,
      job.wormholeChainId ?? 0,
    ],
  );
  const whMessage = encodeAbiParameters(
    [
      { type: 'uint32' },
      { type: 'uint64' },
      { type: 'bytes' },
    ],
    [Math.floor(Date.now() / 1000), sequence, whPayload],
  );

  return {
    l2TargetAddress: job.l2FromAddress,
    l2InputData: encodeFunctionData({
      abi: WORMHOLE_RECEIVER_ABI,
      functionName: 'receiveMessage',
      args: [whMessage],
    }),
    l2Value: totalValue.toString(),
  };
}

function buildDestinationSimulationPayload(
  job: CrossChainExecutionJob,
  call: CrossChainExecutionJob['calls'][number],
  workingState: SimulationStateObjects | undefined,
): TenderlyPayload {
  const { save, saveIfFails } = getTenderlySaveFlags(true);
  const wormholeCoreAddress = getWormholeReceiverCoreAddress(job);
  const isWormholeReceiverMode = wormholeCoreAddress !== null && job.wormholeChainId !== undefined;
  const sequence = isWormholeReceiverMode ? getWormholeReceiverSequence(job, workingState) : 0n;
  const receiverCall = isWormholeReceiverMode
    ? buildWormholeReceiverSimulationCall(job, sequence)
    : null;
  const stateObjects = isWormholeReceiverMode
    ? mergeStateObjects(workingState, {
        [wormholeCoreAddress]: {
          code: WORMHOLE_CORE_STUB_RUNTIME_BYTECODE,
        },
      })
    : workingState;
  const effectiveCall = receiverCall ?? call;

  return {
    network_id: job.destinationChainId.toString() as TenderlyPayload['network_id'],
    from: isWormholeReceiverMode ? DEFAULT_CROSS_CHAIN_SIMULATION_SENDER : job.l2FromAddress,
    to: effectiveCall.l2TargetAddress,
    input: effectiveCall.l2InputData,
    gas: BLOCK_GAS_LIMIT,
    gas_price: '0',
    value: effectiveCall.l2Value,
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
): Promise<TenderlySimulation> {
  const payload = buildDestinationSimulationPayload(job, call, workingState);

  console.log(
    `[CrossChainHandler] Sending L2 Simulation Payload (Chain ${payload.network_id}, Step ${stepIndex + 1}/${totalSteps}):`,
    JSON.stringify(payload, null, 2),
  );

  return await sendSimulation(payload);
}

async function executeDestinationJob(
  job: CrossChainExecutionJob,
  committedState: SimulationStateObjects | undefined,
): Promise<DestinationJobExecutionOutcome> {
  let workingState = mergeStateObjects(committedState, undefined);
  const stepResults: CrossChainExecutionJobResult['stepResults'] = [];
  let accumulatedSim: TenderlySimulation | undefined;
  const wormholeReceiverMode = getWormholeReceiverCoreAddress(job) !== null;
  const stepCalls = wormholeReceiverMode
    ? [buildWormholeReceiverSimulationCall(job, getWormholeReceiverSequence(job, workingState))]
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
      workingState =
        mergeStateObjects(workingState, extractStateOverridesFromSimulation(destSim)) ??
        workingState;
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
