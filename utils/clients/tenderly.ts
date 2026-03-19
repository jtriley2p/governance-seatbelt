import mftch from 'micro-ftch';
import type { FETCH_OPT } from 'micro-ftch';
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  toBytes,
  toHex,
  zeroHash,
} from 'viem';
import type {
  CrossChainExecutionJob,
  CrossChainExecutionJobResult,
  GovernorType,
  ProposalData,
  ProposalEvent,
  SimulationBlock,
  SimulationConfig,
  SimulationConfigExecuted,
  SimulationConfigNew,
  SimulationConfigProposed,
  SimulationResult,
  StorageEncodingResponse,
  TenderlyContract,
  TenderlyPayload,
  TenderlySimulation,
} from '../../types.d';
import { GOVERNOR_ABI } from '../abis/GovernorBravo';
import { timelockAbi } from '../abis/Timelock';
import { extractArbitrumL1L2JobsFromProposal } from '../bridges/arbitrum';
import { extractOptimismL1L2JobsFromProposal } from '../bridges/optimism';
import { extractWormholeExecutionJobsFromProposal } from '../bridges/wormhole';
import { supportsTenderlyDestinationSimulation } from '../chains/capabilities';
import {
  BLOCK_GAS_LIMIT,
  TENDERLY_ACCESS_TOKEN,
  TENDERLY_BASE_URL,
  TENDERLY_ENCODE_URL,
  TENDERLY_SIM_URL,
} from '../constants';
import { GOVERNOR_OZ_ABI } from '../constants/abi';
import { fetchTokenMetadata } from '../contracts/erc20';
import {
  generateProposalId,
  getGovernor,
  getProposal,
  getTimelock,
  getVotingToken,
  hashOperationBatchOz,
  hashOperationOz,
} from '../contracts/governor';
import {
  type DerivedStateByChain,
  type SimulationStateObjects,
  extractStateOverridesFromSimulation,
  mergeStateObjects,
} from '../derived-state';
import { parseWithSchema, z } from '../validation/zod';
import { CacheManager } from './block-explorers/cache';
import { BlockExplorerFactory } from './block-explorers/factory';
import { getChainConfig, publicClient } from './client';

const fetchUrl = mftch;

const TENDERLY_FETCH_OPTIONS = {
  type: 'json' as const,
  headers: { 'X-Access-Key': TENDERLY_ACCESS_TOKEN },
};

const tenderlyBlockNumberSchema = z
  .object({
    block_number: z.number(),
  })
  .passthrough();

const tenderlyStorageEncodingSchema = z
  .object({
    stateOverrides: z.record(
      z.string(),
      z.object({
        value: z.record(z.string(), z.string()),
      }),
    ),
  })
  .passthrough();

const tenderlySimulationSchema: z.ZodType<TenderlySimulation> = z
  .custom<TenderlySimulation>((value) => typeof value === 'object' && value !== null, {
    message: 'Expected object',
  })
  .superRefine((value, ctx) => {
    const candidate = value as {
      transaction?: { status?: unknown; addresses?: unknown };
      contracts?: Array<{ address?: unknown }> | unknown;
      simulation?: { id?: unknown };
    };

    if (!candidate.transaction || typeof candidate.transaction !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected object',
        path: ['transaction'],
      });
    } else {
      if (typeof candidate.transaction.status !== 'boolean') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected boolean',
          path: ['transaction', 'status'],
        });
      }
      if (
        !Array.isArray(candidate.transaction.addresses) ||
        !candidate.transaction.addresses.every((address) => typeof address === 'string')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected string[]',
          path: ['transaction', 'addresses'],
        });
      }
    }

    if (!Array.isArray(candidate.contracts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected array',
        path: ['contracts'],
      });
    } else {
      candidate.contracts.forEach((contract, index) => {
        if (!contract || typeof contract.address !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Expected string',
            path: ['contracts', index, 'address'],
          });
        }
      });
    }

    if (!candidate.simulation || typeof candidate.simulation !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected object',
        path: ['simulation'],
      });
    } else if (typeof candidate.simulation.id !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected string',
        path: ['simulation', 'id'],
      });
    }
  });

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
}

function getTenderlySaveFlags(defaultSaveIfFails: boolean): {
  save: boolean;
  saveIfFails: boolean;
} {
  const save = parseBooleanEnv(process.env.TENDERLY_SAVE_SIMULATIONS) ?? true;
  const saveIfFails = parseBooleanEnv(process.env.TENDERLY_SAVE_IF_FAILS) ?? defaultSaveIfFails;
  return { save, saveIfFails: save ? saveIfFails : false };
}

// Placeholder sender for simulations.
// IMPORTANT: This MUST remain an empty EOA on mainnet (no code, nonce = 0).
// The test at tests/placeholder-constant.test.ts enforces this invariant.
export const DEFAULT_SIMULATION_ADDRESS = '0x0000000000000000000000000000000000001234' as Address;

type TenderlyError = {
  statusCode?: number;
};

type StateOverridesPayload = {
  networkID: string;
  stateOverrides: Record<string, { value: Record<string, string> }>;
};

interface GovernorOverrideParams {
  governorType: GovernorType;
  proposalId: bigint;
  votingTokenSupply: bigint;
  eta: bigint;
  simBlock: bigint;
  // For new proposals only
  targets?: readonly `0x${string}`[];
  values?: readonly bigint[];
  signatures?: readonly string[];
  calldatas?: readonly `0x${string}`[];
  description?: string;
  proposal?: ProposalEvent;
}

interface SimulationPayloadParams {
  governorType: GovernorType;
  // biome-ignore lint/suspicious/noExplicitAny: Complex contract types that vary by governor type
  governor: any; // Governor contract
  // biome-ignore lint/suspicious/noExplicitAny: Complex contract types that vary by governor type
  timelock: any; // Timelock contract
  from: Address;
  latestBlock: SimulationBlock;
  simBlock: bigint;
  simTimestamp: bigint;
  storageObj: StorageEncodingResponse;
  executeInputs: unknown[];
  saveIfFails?: boolean;
}

export interface SimulationExecutionOptions {
  derivedStateByChain?: DerivedStateByChain;
  initialStateByChain?: DerivedStateByChain;
}

type CrossChainSimulationSourceResult = Pick<
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

type CrossChainSimulationHandledResult<T extends CrossChainSimulationSourceResult> = Omit<
  T,
  'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'
> &
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

function extractDestinationJobs(
  targets: readonly string[],
  calldatas: readonly string[],
  l1Sender?: Address,
): CrossChainExecutionJob[] {
  return [
    ...extractArbitrumL1L2JobsFromProposal(targets, calldatas, l1Sender),
    ...extractOptimismL1L2JobsFromProposal(targets, calldatas, l1Sender),
    ...extractWormholeExecutionJobsFromProposal(targets, calldatas),
  ].sort((a, b) => a.sourceOrder - b.sourceOrder);
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

function buildDestinationSimulationPayload(
  job: CrossChainExecutionJob,
  call: CrossChainExecutionJob['calls'][number],
  workingState: SimulationStateObjects | undefined,
): TenderlyPayload {
  const { save: saveSimulation, saveIfFails: saveSimulationIfFails } = getTenderlySaveFlags(true);

  return {
    network_id: job.destinationChainId.toString() as TenderlyPayload['network_id'],
    from: job.l2FromAddress,
    to: call.l2TargetAddress,
    input: call.l2InputData,
    gas: BLOCK_GAS_LIMIT,
    gas_price: '0',
    value: call.l2Value,
    save_if_fails: saveSimulationIfFails,
    save: saveSimulation,
    state_objects: workingState,
  };
}

async function executeDestinationJob(
  job: CrossChainExecutionJob,
  committedState: SimulationStateObjects | undefined,
): Promise<DestinationJobExecutionOutcome> {
  let workingState = mergeStateObjects(committedState, undefined);
  const stepResults: CrossChainExecutionJobResult['stepResults'] = [];
  let accumulatedSim: TenderlySimulation | undefined;

  for (let stepIndex = 0; stepIndex < job.calls.length; stepIndex += 1) {
    const call = job.calls[stepIndex];
    const destinationPayload = buildDestinationSimulationPayload(job, call, workingState);

    console.log(
      `[CrossChainHandler] Sending L2 Simulation Payload (Chain ${destinationPayload.network_id}, Step ${stepIndex + 1}/${job.calls.length}):`,
      JSON.stringify(destinationPayload, null, 2),
    );

    try {
      const destSim = await sendSimulation(destinationPayload);

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

// --- Simulation methods ---

/**
 * @notice Simulates a proposal based on the provided configuration
 * @param config Configuration object
 */
export async function simulate(config: SimulationConfig, options?: SimulationExecutionOptions) {
  if (config.type === 'executed') return await simulateExecuted(config, options);
  if (config.type === 'proposed') return await simulateProposed(config, options);
  return await simulateNew(config, options);
}

/**
 * @notice Simulates execution of an on-chain proposal that has not yet been executed
 * @param config Configuration object
 */
export async function simulateNew(
  config: SimulationConfigNew,
  options?: SimulationExecutionOptions,
): Promise<SimulationResult> {
  // --- Validate config ---
  const { governorAddress, governorType, targets, values, signatures, calldatas, description } =
    config;
  if (targets.length !== values.length)
    throw new Error('targets and values must be the same length');
  if (targets.length !== signatures.length)
    throw new Error('targets and signatures must be the same length');
  if (targets.length !== calldatas.length)
    throw new Error('targets and calldatas must be the same length');

  // --- Get details about the proposal we're simulating ---
  const chainId = await publicClient.getChainId();
  const blockNumberToUse = (await getLatestBlock(chainId)) - 3; // subtracting a few blocks to ensure tenderly has the block
  const latestBlock = await publicClient.getBlock({ blockNumber: BigInt(blockNumberToUse) });
  const governor = getGovernor(governorType, governorAddress);
  const timelock = await getTimelock(governorType, governorAddress);
  const proposalId = await generateProposalId(governorType, governorAddress, {
    targets,
    values,
    calldatas,
    description,
  });

  const startBlock = latestBlock.number - 100n; // arbitrarily subtract 100
  const proposal: ProposalEvent = {
    id: proposalId, // Bravo governor
    proposalId, // OZ governor (for simplicity we just include both ID formats)
    proposer: DEFAULT_SIMULATION_ADDRESS,
    startBlock,
    endBlock: startBlock + 1n,
    description,
    targets,
    values,
    signatures,
    calldatas,
  };

  // --- Prepare simulation configuration ---
  // Get voting token and total supply
  const votingToken = await getVotingToken(governorType, governorAddress, proposalId);
  const votingTokenSupply = await votingToken.read.totalSupply(); // used to manipulate vote count

  // Set `from` arbitrarily.
  const from = DEFAULT_SIMULATION_ADDRESS;

  // Run simulation at a recent block rather than using artificial proposal.endBlock
  // This ensures we use current contract state and avoid potential cross-chain conflicts
  const simBlock = latestBlock.number;

  // For OZ governors we arbitrarily choose execution time. For Bravo governors, we
  // compute the approximate earliest possible execution time based on governance parameters. This
  // can only be approximate because voting period is defined in blocks, not as a timestamp. We
  // assume 12 second block times to prefer underestimating timestamp rather than overestimating,
  // and we prefer underestimating to avoid simulations reverting in cases where governance
  // proposals call methods that pass in a start timestamp that must be lower than the current
  // block timestamp (represented by the `simTimestamp` variable below)
  const simTimestamp =
    governorType === 'bravo'
      ? latestBlock.timestamp + (simBlock - (proposal.endBlock ?? latestBlock.number)) * 12n
      : latestBlock.timestamp + 1n;
  const eta = simTimestamp; // set proposal eta to be equal to the timestamp we simulate at

  // Compute transaction hashes used by the Timelock
  const txHashes = computeTransactionHashes(targets, values, signatures, calldatas, eta);

  // Generate the state object needed to mark the transactions as queued in the Timelock's storage
  const timelockStorageObj: Record<string, string> = {};
  for (const hash of txHashes) {
    timelockStorageObj[`queuedTransactions[${hash}]`] = 'true';
  }

  if (governorType === 'oz') {
    const id = hashOperationBatchOz(
      [...targets],
      [...values],
      [...calldatas],
      zeroHash,
      keccak256(toBytes(description)),
    );
    timelockStorageObj[`_timestamps[${toHex(id)}]`] = simTimestamp.toString();
  }

  // Use the Tenderly API to get the encoded state overrides for governor storage
  const governorStateOverrides = buildGovernorStateOverrides({
    governorType,
    proposalId,
    votingTokenSupply,
    eta,
    simBlock,
    targets,
    values,
    signatures,
    calldatas,
    description,
    proposal,
  });

  const stateOverrides: StateOverridesPayload = {
    networkID: '1',
    stateOverrides: {
      [timelock.address]: {
        value: timelockStorageObj,
      },
      [governor.address]: {
        value: governorStateOverrides,
      },
    },
  };

  const storageObj = await sendEncodeRequest(stateOverrides);

  // --- Simulate it ---
  // We need the following state conditions to be true to successfully simulate a proposal:
  //   - proposalCount >= proposal.id
  //   - proposal.canceled == false
  //   - proposal.executed == false
  //   - block.number > proposal.endBlock
  //   - proposal.forVotes > proposal.againstVotes
  //   - proposal.forVotes > quorumVotes
  //   - proposal.eta !== 0
  //   - block.timestamp >= proposal.eta
  //   - block.timestamp <  proposal.eta + timelock.GRACE_PERIOD()
  //   - queuedTransactions[txHash] = true for each action in the proposal
  const descriptionHash = keccak256(toBytes(description));
  const executeInputs =
    governorType === 'bravo' ? [proposalId] : [targets, values, calldatas, descriptionHash];

  const simulationPayload = buildSimulationPayload({
    governorType,
    governor,
    timelock,
    from,
    latestBlock,
    simBlock,
    simTimestamp,
    storageObj,
    executeInputs,
    saveIfFails: true,
  });

  const seededMainnetState = mergeStateObjects(
    options?.initialStateByChain?.[1],
    options?.derivedStateByChain?.[1],
  );
  simulationPayload.state_objects = mergeStateObjects(
    seededMainnetState,
    simulationPayload.state_objects,
  );

  // Handle ETH transfers if needed
  handleETHValueRequirements(simulationPayload, config.values, from, timelock.address);

  // Run the simulation
  const sim = await sendSimulation(simulationPayload);

  const deps: ProposalData = {
    governor,
    timelock,
    publicClient,
    chainConfig: getChainConfig(1), // Mainnet chain config
    targets: targets.map((target: string) => target),
    touchedContracts: sim.contracts.map((contract) => contract.address),
  };

  // For new proposals, use simulation timing as created timing since they don't exist on-chain yet
  const proposalCreatedBlock = latestBlock;

  return { sim, proposal, latestBlock, deps, proposalCreatedBlock };
}

/**
 * @notice Simulates execution of an on-chain proposal that has not yet been executed
 * @param config Configuration object
 */
async function simulateProposed(
  config: SimulationConfigProposed,
  options?: SimulationExecutionOptions,
): Promise<SimulationResult> {
  const { governorAddress, governorType, proposalId } = config;
  const proposalIdBigInt = typeof proposalId === 'bigint' ? proposalId : BigInt(proposalId);

  // --- Get details about the proposal we're simulating ---
  const chainId = await publicClient.getChainId();
  const blockNumberToUse = (await getLatestBlock(chainId)) - 3; // subtracting a few blocks to ensure tenderly has the block
  const latestBlock = await publicClient.getBlock({ blockNumber: BigInt(blockNumberToUse) });
  const blockRange = [0n, latestBlock.number];
  const governor = getGovernor(governorType, governorAddress);
  const timelock = await getTimelock(governorType, governorAddress);
  const proposal = await getProposal(governorType, governorAddress, proposalIdBigInt);
  const abi = governorType === 'bravo' ? GOVERNOR_ABI : GOVERNOR_OZ_ABI;

  const proposalCreatedEvents = await publicClient.getContractEvents({
    address: governorAddress,
    abi,
    eventName: 'ProposalCreated',
    fromBlock: blockRange[0],
    toBlock: blockRange[1],
  });

  const proposalCreatedEvent = proposalCreatedEvents.filter((e) => {
    const args = e.args;
    if (governorType === 'bravo' && 'id' in args) {
      return args.id === proposalIdBigInt;
    }
    if (governorType === 'oz' && 'proposalId' in args) {
      return args.proposalId === proposalIdBigInt;
    }
    return false;
  })[0];
  if (!proposalCreatedEvent)
    throw new Error(`Proposal creation log for #${proposalIdBigInt} not found in governor logs`);
  const { targets, signatures: sigs, calldatas, description, values } = proposalCreatedEvent.args;
  if (!targets || !values || !sigs || !calldatas || !description) {
    throw new Error('Missing required proposal data in creation event');
  }

  // --- Prepare simulation configuration ---
  // We need the following state conditions to be true to successfully simulate a proposal:
  //   - proposal.canceled == false
  //   - proposal.executed == false
  //   - block.number > proposal.endBlock
  //   - proposal.forVotes > proposal.againstVotes
  //   - proposal.forVotes > quorumVotes
  //   - proposal.eta !== 0
  //   - block.timestamp >= proposal.eta
  //   - block.timestamp <  proposal.eta + timelock.GRACE_PERIOD()
  //   - queuedTransactions[txHash] = true for each action in the proposal

  // Get voting token and total supply
  const votingToken = await getVotingToken(governorType, governorAddress, proposal.id);
  const votingTokenSupply = await votingToken.read.totalSupply(); // used to manipulate vote count

  // Set `from` arbitrarily.
  const from = DEFAULT_SIMULATION_ADDRESS;

  // For Bravo governors, we use the block right after the proposal ends, and for OZ
  // governors we arbitrarily use the next block number.
  const simBlock =
    governorType === 'bravo'
      ? (proposal.endBlock ?? latestBlock.number) + 1n
      : latestBlock.number + 1n;

  // For OZ governors we are given the earliest possible execution time. For Bravo governors, we
  // Compute the approximate earliest possible execution time based on governance parameters. This
  // can only be approximate because voting period is defined in blocks, not as a timestamp. We
  // assume 12 second block times to prefer underestimating timestamp rather than overestimating,
  // and we prefer underestimating to avoid simulations reverting in cases where governance
  // proposals call methods that pass in a start timestamp that must be lower than the current
  // block timestamp (represented by the `simTimestamp` variable below)
  const simTimestamp =
    governorType === 'bravo'
      ? latestBlock.timestamp + (simBlock - (proposal.endBlock ?? latestBlock.number)) * 12n
      : latestBlock.timestamp + 1n;
  const eta = simTimestamp; // set proposal eta to be equal to the timestamp we simulate at

  // Compute transaction hashes used by the Timelock
  const txHashes = computeTransactionHashes(
    targets as readonly `0x${string}`[],
    values,
    sigs,
    calldatas as readonly `0x${string}`[],
    eta,
  );

  // Generate the state object needed to mark the transactions as queued in the Timelock's storage
  const timelockStorageObj: Record<string, string> = {};
  for (const hash of txHashes) {
    timelockStorageObj[`queuedTransactions[${hash}]`] = 'true';
  }

  if (governorType === 'oz') {
    const id = hashOperationBatchOz(
      [...targets],
      [...values],
      [...calldatas],
      zeroHash,
      keccak256(toBytes(description)),
    );
    timelockStorageObj[`_timestamps[${toHex(id)}]`] = simTimestamp.toString();
  }

  const governorStateOverrides = buildGovernorStateOverrides({
    governorType,
    proposalId,
    votingTokenSupply,
    eta,
    simBlock,
    // No targets/values/signatures/calldatas for existing proposals
  });

  const stateOverrides: StateOverridesPayload = {
    networkID: '1',
    stateOverrides: {
      [timelock.address]: {
        value: timelockStorageObj,
      },
      [governor.address]: {
        value: governorStateOverrides,
      },
    },
  };
  const storageObj = await sendEncodeRequest(stateOverrides);

  // --- Simulate it ---
  // Note: The Tenderly API is sensitive to the input types, so all formatting below (e.g. stripping
  // leading zeroes, padding with zeros, strings vs. hex, etc.) are all intentional decisions to
  // ensure Tenderly properly parses the simulation payload
  const descriptionHash = keccak256(toBytes(description));
  const executeInputs =
    governorType === 'bravo' ? [proposalId] : [targets, values, calldatas, descriptionHash];

  const simulationPayload = buildSimulationPayload({
    governorType,
    governor,
    timelock,
    from,
    latestBlock,
    simBlock,
    simTimestamp,
    storageObj,
    executeInputs,
    saveIfFails: true, // Different for proposed
  });

  simulationPayload.state_objects = mergeStateObjects(
    options?.derivedStateByChain?.[1],
    simulationPayload.state_objects,
  );

  const formattedProposal: ProposalEvent = {
    id: proposalId,
    proposalId,
    proposer: proposalCreatedEvent.args.proposer ?? DEFAULT_SIMULATION_ADDRESS,
    startBlock: proposalCreatedEvent.args.startBlock ?? 0n,
    endBlock: proposalCreatedEvent.args.endBlock ?? 0n,
    description: proposalCreatedEvent.args.description ?? '',
    targets: [...(proposalCreatedEvent.args.targets ?? [])],
    values: [...values],
    signatures: [...(proposalCreatedEvent.args.signatures ?? [])],
    calldatas: [...(proposalCreatedEvent.args.calldatas ?? [])],
  };

  // Handle ETH transfers if needed
  handleETHValueRequirements(simulationPayload, values, from, timelock.address);

  // Run the simulation
  const sim = await sendSimulation(simulationPayload);

  const deps: ProposalData = {
    governor,
    timelock,
    publicClient,
    chainConfig: getChainConfig(1), // Mainnet chain config
    targets: proposalCreatedEvent.args.targets?.map((target: string) => target) ?? [],
    touchedContracts: sim.contracts.map((contract) => contract.address),
  };

  // Get block details for proposal creation timing
  const proposalCreatedBlock = await publicClient.getBlock({
    blockNumber: proposalCreatedEvent.blockNumber,
  });

  return { sim, proposal: formattedProposal, latestBlock, deps, proposalCreatedBlock };
}

/**
 * @notice Simulates execution of an already-executed governance proposal
 * @param config Configuration object
 */
async function simulateExecuted(
  config: SimulationConfigExecuted,
  options?: SimulationExecutionOptions,
): Promise<SimulationResult> {
  const { governorAddress, governorType, proposalId } = config;
  const proposalIdBigInt = typeof proposalId === 'bigint' ? proposalId : BigInt(proposalId);

  // --- Get details about the proposal we're analyzing ---
  const latestBlockNumber = await publicClient.getBlockNumber();
  const latestBlock = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNumber) });
  const governor = getGovernor(governorType, governorAddress);
  const timelock = await getTimelock(governorType, governorAddress);

  if (governorType === 'bravo') {
    const proposalStruct = await getProposal(governorType, governorAddress, proposalIdBigInt);
    const startBlock = proposalStruct.startBlock;
    if (!startBlock) throw new Error(`Missing startBlock for proposal ${proposalIdBigInt}`);

    const votingDelay = await publicClient.readContract({
      address: governorAddress,
      abi: GOVERNOR_ABI,
      functionName: 'votingDelay',
    });

    const approxCreatedBlock = startBlock > votingDelay ? startBlock - votingDelay : 0n;

    const proposalCreatedEvent = await findProposalCreatedEventNearBlock({
      governorType,
      governorAddress,
      proposalId: proposalIdBigInt,
      approxBlock: approxCreatedBlock,
      latestBlock: latestBlock.number ?? 0n,
    });

    const proposal = proposalCreatedEvent.args;

    if (!proposal.description) {
      throw new Error(
        `Missing description in ProposalCreated event for proposal ${proposalIdBigInt}`,
      );
    }

    const { targets, signatures, calldatas, values } = proposal;
    if (!targets || !values || !signatures || !calldatas) {
      throw new Error('Missing required proposal data in creation event');
    }

    const eta = proposalStruct.eta;
    if (!eta || eta === 0n) {
      throw new Error(`Missing eta for executed proposal ${proposalIdBigInt}`);
    }

    const txHashes = computeTransactionHashes(
      targets as readonly `0x${string}`[],
      values,
      signatures,
      calldatas as readonly `0x${string}`[],
      eta,
    );

    const executeEvents = await publicClient.getContractEvents({
      address: timelock.address,
      abi: timelockAbi,
      eventName: 'ExecuteTransaction',
      args: { txHash: txHashes[0] as `0x${string}` },
      fromBlock: 0n,
      toBlock: latestBlock.number,
    });

    const executeEvent = executeEvents[0];
    if (!executeEvent) {
      throw new Error(
        `Could not find timelock ExecuteTransaction event for proposal ${proposalIdBigInt} (txHash: ${txHashes[0]})`,
      );
    }

    // Prepare tenderly payload. Since this proposal was already executed, we directly use that transaction data
    const tx = await publicClient.getTransaction({ hash: executeEvent.transactionHash });
    const simulationPayload: TenderlyPayload = {
      network_id: String(tx.chainId) as TenderlyPayload['network_id'],
      block_number: Number(tx.blockNumber),
      from: tx.from,
      to: tx.to ?? '',
      input: tx.input,
      gas: Number(tx.gas),
      gas_price: tx.gasPrice?.toString(),
      value: tx.value.toString(),
      save_if_fails: false,
      save: false,
      generate_access_list: true,
    };
    simulationPayload.state_objects = mergeStateObjects(
      options?.derivedStateByChain?.[1],
      simulationPayload.state_objects,
    );
    const sim = await sendSimulation(simulationPayload);

    // Validate required fields
    if (!proposal.proposer) {
      throw new Error(`Missing proposer in ProposalCreated event for proposal ${proposalIdBigInt}`);
    }

    const formattedProposal: ProposalEvent = {
      ...proposal,
      id: proposalIdBigInt,
      proposalId: proposalIdBigInt,
      proposer: proposal.proposer,
      description: proposal.description,
      targets: [...(proposal.targets ?? [])],
      values: [...(proposal.values ?? [])],
      signatures: [...(proposal.signatures ?? [])],
      calldatas: [...(proposal.calldatas ?? [])],
      startBlock: proposal.startBlock ?? 0n,
      endBlock: proposal.endBlock ?? 0n,
    };
    const deps: ProposalData = {
      governor,
      timelock,
      publicClient,
      chainConfig: getChainConfig(1),
      targets: proposal.targets?.map((target: string) => target) ?? [],
      touchedContracts: sim.contracts.map((contract) => contract.address),
    };

    const [proposalCreatedBlock, proposalExecutedBlock] = await Promise.all([
      publicClient.getBlock({ blockNumber: proposalCreatedEvent.blockNumber }),
      tx.blockNumber
        ? publicClient.getBlock({ blockNumber: tx.blockNumber })
        : Promise.resolve(undefined),
    ]);

    return {
      sim,
      proposal: formattedProposal,
      latestBlock,
      deps,
      executor: tx.from,
      proposalCreatedBlock,
      proposalExecutedBlock,
    };
  }

  // --- OZ governors (fallback to governor logs) ---
  const blockRange = [0n, latestBlock.number];
  const [createProposalEvents, proposalExecutedEvents] = await Promise.all([
    publicClient.getContractEvents({
      address: governorAddress,
      abi: governor.abi,
      eventName: 'ProposalCreated',
      fromBlock: blockRange[0],
      toBlock: blockRange[1],
    }),
    publicClient.getContractEvents({
      address: governorAddress,
      abi: governor.abi,
      eventName: 'ProposalExecuted',
      fromBlock: blockRange[0],
      toBlock: blockRange[1],
    }),
  ]);

  const proposalCreatedEvent = createProposalEvents.filter((e) => {
    const args = e.args;
    if (governorType === 'oz' && 'proposalId' in args) {
      return args.proposalId === proposalIdBigInt;
    }
  })[0];
  if (!proposalCreatedEvent)
    throw new Error(`Proposal creation log for #${proposalIdBigInt} not found in governor logs`);

  const proposal = proposalCreatedEvent.args;

  const proposalExecutedEvent = proposalExecutedEvents.filter((e) => {
    const args = e.args;
    if (governorType === 'oz' && 'proposalId' in args) {
      return args.proposalId === proposalIdBigInt;
    }
  })[0];
  if (!proposalExecutedEvent)
    throw new Error(`Proposal executed log for #${proposalIdBigInt} not found in governor logs`);

  // --- Simulate it ---
  // Prepare tenderly payload. Since this proposal was already executed, we directly use that transaction data
  const tx = await publicClient.getTransaction({ hash: proposalExecutedEvent.transactionHash });
  const { save: saveSimulation, saveIfFails: saveSimulationIfFails } = getTenderlySaveFlags(true);
  const simulationPayload: TenderlyPayload = {
    network_id: String(tx.chainId) as TenderlyPayload['network_id'],
    block_number: Number(tx.blockNumber),
    from: tx.from,
    to: tx.to ?? '',
    input: tx.input,
    gas: Number(tx.gas),
    gas_price: tx.gasPrice?.toString(),
    value: tx.value.toString(),
    save_if_fails: saveSimulationIfFails, // Save failed sims when enabled.
    save: saveSimulation, // Save successful sims when enabled.
    generate_access_list: true,
  };
  simulationPayload.state_objects = mergeStateObjects(
    options?.derivedStateByChain?.[1],
    simulationPayload.state_objects,
  );
  const sim = await sendSimulation(simulationPayload);

  // Validate required fields
  if (!proposal.proposer) {
    throw new Error(`Missing proposer in ProposalCreated event for proposal ${proposalIdBigInt}`);
  }
  if (!proposal.description) {
    throw new Error(
      `Missing description in ProposalCreated event for proposal ${proposalIdBigInt}`,
    );
  }

  const formattedProposal: ProposalEvent = {
    ...proposal,
    id: proposalIdBigInt,
    proposalId: proposalIdBigInt,
    proposer: proposal.proposer, // Required field, validated above
    description: proposal.description, // Required field, validated above
    targets: [...(proposal.targets ?? [])],
    values: [...(proposal.values ?? [])],
    signatures: [...(proposal.signatures ?? [])],
    calldatas: [...(proposal.calldatas ?? [])],
    startBlock: proposal.startBlock ?? 0n,
    endBlock: proposal.endBlock ?? 0n,
  };
  const deps: ProposalData = {
    governor,
    timelock,
    publicClient,
    chainConfig: getChainConfig(1), // Mainnet chain config
    targets: proposalCreatedEvent.args.targets?.map((target: string) => target) ?? [],
    touchedContracts: sim.contracts.map((contract) => contract.address),
  };

  // Get block details for proposal creation and execution timing
  const [proposalCreatedBlock, proposalExecutedBlock] = await Promise.all([
    publicClient.getBlock({ blockNumber: proposalCreatedEvent.blockNumber }),
    publicClient.getBlock({ blockNumber: proposalExecutedEvent.blockNumber }),
  ]);

  return {
    sim,
    proposal: formattedProposal,
    latestBlock,
    deps,
    executor: tx.from,
    proposalCreatedBlock,
    proposalExecutedBlock,
  };
}

/**
 * @notice Takes a completed source simulation result and handles parsing for
 *         cross-chain execution jobs and executes them on destination chains.
 *
 * Runtime model:
 * - a job is the destination execution unit emitted by bridge parsers
 * - a successful one-call job usually yields one Tenderly simulation
 * - a successful multi-call job yields one step simulation per call, each run
 *   against the state accumulated by earlier successful steps in the same job
 * - `accumulatedSim` is the final successful simulation artifact for the job
 *
 * `accumulatedSim` is not specific to derived-state flows. Derived state is one
 * consumer of it, but reporting, checks, provenance, and debugging can all use
 * it as the canonical final successful result for a job.
 *
 * @param sourceResult The result of the source chain simulation.
 * @returns The potentially augmented SimulationResult including destination job results.
 */

export async function handleCrossChainSimulations<T extends CrossChainSimulationSourceResult>(
  sourceResult: T,
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

  // 1. Parse source simulation for cross-chain execution jobs
  console.log('[CrossChainHandler] Parsing source sim for execution jobs...');

  if (!result.proposal?.targets?.length || !result.proposal?.calldatas?.length) {
    console.log('[CrossChainHandler] No cross-chain execution jobs detected.');
    return result; // Return early with original source data
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

  // 2. If jobs found, execute them on destination chains
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

// --- Helper methods ---

/**
 * @notice Handles ETH value requirements for simulation payloads
 * @param simulationPayload The simulation payload to modify
 * @param values Array of ETH values to send with each transaction
 * @param from The sender address
 * @param timelockAddress The timelock contract address
 */
function handleETHValueRequirements(
  simulationPayload: TenderlyPayload,
  values: readonly bigint[],
  from: Address,
  timelockAddress: Address,
): void {
  const totalValue = values.reduce((sum, val) => sum + val, 0n);

  if (totalValue > 0n) {
    const normalizedFrom = getAddress(from);
    const normalizedTimelockAddress = getAddress(timelockAddress);

    // If we need to send ETH, update the value and from address balance
    simulationPayload.value = totalValue.toString();

    // Make sure the from address has enough balance to cover the transfer
    if (!simulationPayload.state_objects) {
      simulationPayload.state_objects = {};
    }
    simulationPayload.state_objects[normalizedFrom] = {
      ...simulationPayload.state_objects[normalizedFrom],
      balance: totalValue.toString(),
    };

    // Also ensure the timelock has enough ETH to execute the proposal
    simulationPayload.state_objects[normalizedTimelockAddress] = {
      ...simulationPayload.state_objects[normalizedTimelockAddress],
      balance: totalValue.toString(),
    };
  }
}

/**
 * @notice Builds a Tenderly simulation payload with common configuration
 * @param params Configuration parameters for the simulation payload
 */
function buildSimulationPayload(params: SimulationPayloadParams): TenderlyPayload {
  const {
    governor,
    timelock,
    from,
    latestBlock,
    simBlock,
    simTimestamp,
    storageObj,
    executeInputs,
    saveIfFails = false,
  } = params;

  const { save: saveSimulation, saveIfFails: saveSimulationIfFails } =
    getTenderlySaveFlags(saveIfFails);
  const normalizedFrom = getAddress(from);
  const normalizedTimelockAddress = getAddress(timelock.address);
  const normalizedGovernorAddress = getAddress(governor.address);

  return {
    network_id: '1',
    // this field represents the block state to simulate against, so we use the latest block number
    block_number: Number(latestBlock.number),
    from,
    to: governor.address,
    input: encodeFunctionData({
      abi: governor.abi,
      functionName: 'execute',
      args: executeInputs,
    }),
    gas: BLOCK_GAS_LIMIT,
    gas_price: '0',
    value: '0', // Will be updated by handleETHValueRequirements if needed
    save_if_fails: saveSimulationIfFails, // Save failed sims when enabled.
    save: saveSimulation, // Save successful sims when enabled.
    generate_access_list: true, // not required, but useful as a sanity check to ensure consistency in the simulation response
    block_header: {
      // this data represents what block.number and block.timestamp should return in the EVM during the simulation
      number: toHex(simBlock),
      timestamp: toHex(simTimestamp),
    },
    state_objects: {
      // Since gas price is zero, the sender needs no balance. If the sender does need a balance to
      // send ETH with the execution, this will be overridden later.
      [normalizedFrom]: { balance: '0' },
      // Ensure transactions are queued in the timelock
      [normalizedTimelockAddress]: {
        storage: storageObj.stateOverrides[timelock.address.toLowerCase()].value,
      },
      // Ensure governor storage is properly configured so `state(proposalId)` returns `Queued`
      [normalizedGovernorAddress]: {
        storage: storageObj.stateOverrides[governor.address.toLowerCase()].value,
      },
    },
  };
}

/**
 * @notice Builds governor state overrides for simulation
 * @param params Configuration parameters for governor overrides
 */
function buildGovernorStateOverrides(params: GovernorOverrideParams): Record<string, string> {
  const {
    governorType,
    proposalId,
    votingTokenSupply,
    eta,
    simBlock,
    targets,
    values,
    signatures,
    calldatas,
    description,
    proposal,
  } = params;

  if (governorType === 'bravo') {
    const proposalKey = `proposals[${proposalId.toString()}]`;
    const overrides: Record<string, string> = {
      proposalCount: proposalId.toString(),
      [`${proposalKey}.eta`]: eta.toString(),
      [`${proposalKey}.canceled`]: 'false',
      [`${proposalKey}.executed`]: 'false',
      [`${proposalKey}.forVotes`]: votingTokenSupply.toString(),
      [`${proposalKey}.againstVotes`]: '0',
      [`${proposalKey}.abstainVotes`]: '0',
    };

    // Add full proposal data for new proposals
    if (targets && values && signatures && calldatas && proposal) {
      overrides[`${proposalKey}.id`] = proposalId.toString();
      overrides[`${proposalKey}.proposer`] = DEFAULT_SIMULATION_ADDRESS;
      overrides[`${proposalKey}.startBlock`] = proposal.startBlock.toString();
      overrides[`${proposalKey}.endBlock`] = proposal.endBlock.toString();
      overrides[`${proposalKey}.targets.length`] = targets.length.toString();
      overrides[`${proposalKey}.values.length`] = targets.length.toString();
      overrides[`${proposalKey}.signatures.length`] = targets.length.toString();
      overrides[`${proposalKey}.calldatas.length`] = targets.length.toString();

      targets.forEach((target, i) => {
        const value = BigInt(values[i]).toString();
        overrides[`${proposalKey}.targets[${i}]`] = target;
        overrides[`${proposalKey}.values[${i}]`] = value;
        overrides[`${proposalKey}.signatures[${i}]`] = signatures[i];
        overrides[`${proposalKey}.calldatas[${i}]`] = calldatas[i];
      });
    }

    return overrides;
  }

  if (governorType === 'oz') {
    const proposalCoreKey = `_proposals[${proposalId.toString()}]`;
    const proposalVotesKey = `_proposalVotes[${proposalId.toString()}]`;
    const overrides: Record<string, string> = {
      [`${proposalCoreKey}.voteEnd._deadline`]: (simBlock - 1n).toString(),
      [`${proposalCoreKey}.canceled`]: 'false',
      [`${proposalCoreKey}.executed`]: 'false',
      [`${proposalVotesKey}.forVotes`]: votingTokenSupply.toString(),
      [`${proposalVotesKey}.againstVotes`]: '0',
      [`${proposalVotesKey}.abstainVotes`]: '0',
    };

    // Add operation hashes for new proposals
    if (targets && values && calldatas && description) {
      targets.forEach((target, i) => {
        const id = hashOperationOz(target, values[i], calldatas[i], zeroHash, zeroHash);
        overrides[`_timestamps[${id}]`] = '2'; // must be > 1.
      });
    }

    return overrides;
  }

  throw new Error(`Cannot generate overrides for unknown governor type: ${governorType}`);
}

// Sleep for the specified number of milliseconds
const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay)); // delay in milliseconds

// Get a random integer between two values
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min); // max is exclusive, min is inclusive

async function findProposalCreatedEventNearBlock(params: {
  governorType: GovernorType;
  governorAddress: Address;
  proposalId: bigint;
  approxBlock: bigint;
  latestBlock: bigint;
}) {
  const { governorType, governorAddress, proposalId, approxBlock, latestBlock } = params;

  const abi = governorType === 'bravo' ? GOVERNOR_ABI : GOVERNOR_OZ_ABI;
  const windows = [2_000n, 10_000n, 50_000n, 200_000n, 1_000_000n];

  for (const window of windows) {
    const fromBlock = approxBlock > window ? approxBlock - window : 0n;
    const toBlock = approxBlock + window < latestBlock ? approxBlock + window : latestBlock;

    const events = await publicClient.getContractEvents({
      address: governorAddress,
      abi,
      eventName: 'ProposalCreated',
      fromBlock,
      toBlock,
    });

    const match = events.find((e) => {
      const args = e.args;
      if (governorType === 'bravo' && 'id' in args) return args.id === proposalId;
      if (governorType === 'oz' && 'proposalId' in args) return args.proposalId === proposalId;
      return false;
    });

    if (match) return match;
  }

  throw new Error(`Proposal creation log for #${proposalId} not found near block ${approxBlock}`);
}

/**
 * @notice Given a Tenderly contract object, generates a descriptive human-friendly name for that contract
 * @param contract Tenderly contract object to generate name from
 * @param chainId Optional chain ID to fetch better contract names from block explorers
 */
export async function getContractName(
  contract: TenderlyContract | undefined,
  chainId?: number,
): Promise<string> {
  if (!contract) return 'Unknown Contract';

  const contractAddress = getAddress(contract.address);

  // Priority 1: Use token metadata for semantic names (like "ARB Token") when available
  if (contract?.token_data?.name) {
    const tokenName = contract.token_data.name;
    // Try to get token symbol to make it more descriptive
    try {
      if (chainId && (chainId === 42161 || chainId === 1)) {
        const metadata = await fetchTokenMetadata(contractAddress);
        const symbol = metadata.symbol || contract.token_data.symbol || tokenName;
        return `${tokenName} (${symbol}) at \`${contractAddress}\``;
      }
    } catch (error) {
      // Fallback to just token name if metadata fetch fails
      console.debug(
        `[Contract Name] Failed to fetch token metadata for ${contractAddress}:`,
        error,
      );
    }
    // Use token name with symbol from Tenderly if available
    const symbol = contract.token_data.symbol || tokenName;
    return `${tokenName} (${symbol}) at \`${contractAddress}\``;
  }

  // Priority 2: Use Tenderly's contract name (like "TransparentUpgradeableProxy")
  let contractName = contract?.contract_name?.trim() || 'Unknown Contract';

  // Best-effort fallback: Tenderly may not have indexed a verified contract yet, so try the
  // chain's configured block explorer for a better name when available.
  if (chainId && (contractName === 'Unknown Contract' || contractName.length === 0)) {
    const memoryCached = CacheManager.getContractNameFromMemory(chainId, contractAddress);
    if (memoryCached) {
      contractName = memoryCached;
    } else {
      const fileCached = CacheManager.getContractNameFromFile(chainId, contractAddress);
      if (fileCached) {
        CacheManager.setContractNameInMemory(chainId, contractAddress, fileCached);
        contractName = fileCached;
      } else {
        const fetched = await BlockExplorerFactory.fetchContractName(contractAddress, chainId);
        if (fetched) {
          CacheManager.setContractNameInMemory(chainId, contractAddress, fetched);
          CacheManager.setContractNameInFile(chainId, contractAddress, fetched);
          contractName = fetched;
        }
      }
    }
  }

  return `${contractName} at \`${contractAddress}\``;
}

/**
 * @notice Uses only Tenderly's contract metadata for naming (no additional API calls)
 * @param contract Tenderly contract object to generate name from
 */
export function getContractNameFromTenderly(contract: TenderlyContract | undefined): string {
  if (!contract) return 'Unknown Contract';

  const contractAddress = getAddress(contract.address);

  // Priority 1: Use token name if available for better semantic naming
  if (contract?.token_data?.name) {
    const tokenName = contract.token_data.name;
    const symbol = contract.token_data.symbol || tokenName;
    return `${tokenName} (${symbol}) at \`${contractAddress}\``;
  }

  // Priority 2: Fall back to technical contract name
  const contractName = contract?.contract_name || 'Unknown Contract';
  return `${contractName} at \`${contractAddress}\``;
}

/**
 * Gets the latest block number known to Tenderly
 * @param chainId Chain ID to get block number for
 */
async function getLatestBlock(chainId: number): Promise<number> {
  try {
    // Send simulation request
    const url = `${TENDERLY_BASE_URL}/network/${(chainId).toString()}/block-number`;
    const fetchOptions = <Partial<FETCH_OPT>>{
      method: 'GET',
      ...TENDERLY_FETCH_OPTIONS,
    };
    const rawRes = await fetchUrl(url, fetchOptions);
    const res = parseWithSchema(
      tenderlyBlockNumberSchema,
      rawRes,
      'Tenderly block-number response',
    );
    return res.block_number;
  } catch (err) {
    console.log('logging getLatestBlock error');
    console.log(JSON.stringify(err, null, 2));
    throw err;
  }
}

/**
 * @notice Encode state overrides
 * @param payload State overrides to send
 */
async function sendEncodeRequest(payload: StateOverridesPayload): Promise<StorageEncodingResponse> {
  try {
    const fetchOptions = <Partial<FETCH_OPT>>{
      method: 'POST',
      data: payload,
      ...TENDERLY_FETCH_OPTIONS,
    };
    const rawResponse = await fetchUrl(TENDERLY_ENCODE_URL, fetchOptions);
    const response = parseWithSchema(
      tenderlyStorageEncodingSchema,
      rawResponse,
      'Tenderly storage encoding response',
    );

    return response as StorageEncodingResponse;
  } catch (err) {
    console.log('logging sendEncodeRequest error');
    console.log(JSON.stringify(err, null, 2));
    console.log(JSON.stringify(payload));
    throw err;
  }
}

/**
 * @notice Sends a transaction simulation request to the Tenderly API
 * @dev Uses a simple exponential backoff when requests fail, with the following parameters:
 *   - Initial delay is 1 second
 *   - We randomize the delay duration to avoid synchronization issues if client is sending multiple requests simultaneously
 *   - We double delay each time and throw an error if delay is over 8 seconds
 * @param payload Transaction simulation parameters
 * @param delay How long to wait until next simulation request after failure, in milliseconds
 */
async function sendSimulation(payload: TenderlyPayload, delay = 1000): Promise<TenderlySimulation> {
  const fetchOptions = <Partial<FETCH_OPT>>{
    method: 'POST',
    data: payload,
    ...TENDERLY_FETCH_OPTIONS,
  };
  try {
    // Send simulation request
    const rawSim = await fetchUrl(TENDERLY_SIM_URL, fetchOptions);
    const sim = parseWithSchema(tenderlySimulationSchema, rawSim, 'Tenderly simulate response');

    // Post-processing to ensure addresses we use are checksummed (since ethers returns checksummed addresses)
    sim.transaction.addresses = sim.transaction.addresses.map(getAddress);
    for (const contract of sim.contracts) {
      contract.address = getAddress(contract.address);
    }

    return sim;
  } catch (err) {
    console.log('err in sendSimulation: ', JSON.stringify(err));
    const is429 = (err as TenderlyError)?.statusCode === 429;
    if (delay > 8000 || !is429) {
      console.warn('Simulation request failed with the below request payload and error');
      console.log(JSON.stringify(fetchOptions));
      throw err;
    }
    console.warn(err);
    console.warn(
      `Simulation request failed with the above error, retrying in ~${delay} milliseconds. See request payload below`,
    );
    console.log(JSON.stringify(payload));
    await sleep(delay + randomInt(0, 1000));
    return await sendSimulation(payload, delay * 2);
  }
}

/**
 * @notice Computes transaction hashes used by the Timelock for queuing transactions
 * @param targets Array of target contract addresses
 * @param values Array of ETH values to send with each transaction
 * @param signatures Array of function signatures
 * @param calldatas Array of encoded calldata
 * @param eta Execution timestamp
 * @returns Array of transaction hashes
 */
function computeTransactionHashes(
  targets: readonly `0x${string}`[],
  values: readonly bigint[],
  signatures: readonly string[],
  calldatas: readonly `0x${string}`[],
  eta: bigint,
): Hex[] {
  return targets.map((target, i) => {
    const [val, sig, calldata] = [values[i], signatures[i], calldatas[i]];
    return keccak256(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'string' },
          { type: 'bytes' },
          { type: 'uint256' },
        ],
        [target, val, sig, calldata, eta],
      ),
    );
  });
}
