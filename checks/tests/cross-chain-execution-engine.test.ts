import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { encodeFunctionData, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import type { TenderlySimulation } from '../../types.d';
import { WORMHOLE_SEND_MESSAGE_ABI } from '../../utils/bridges/wormhole';
import { getChainConfig } from '../../utils/clients/client';
import { createMockSimulation } from './test-utils';

const mockedSendSimulation = mock(
  async (payload: Record<string, unknown>): Promise<TenderlySimulation> => {
    transportCalls.push(payload);
    const next = transportQueue.shift();

    if (!next) {
      throw new Error('Unexpected simulation call');
    }

    if (next.type === 'throw') {
      throw next.error;
    }

    return next.sim;
  },
);

mock.module('../../utils/clients/tenderly-api', () => ({
  getLatestBlock: async () => {
    throw new Error('Unexpected getLatestBlock call');
  },
  getTenderlySaveFlags: () => ({ save: true, saveIfFails: true }),
  sendEncodeRequest: async () => {
    throw new Error('Unexpected sendEncodeRequest call');
  },
  sendSimulation: mockedSendSimulation,
}));

const WORMHOLE_PROPOSAL_TARGET = '0xf5F4496219F31CDCBa6130B5402873624585615a' as const;
const WORMHOLE_ADDRESS = '0x00000000000000000000000000000000000000AA' as const;
const CELO_CHAIN_ID = 42220;
const TIMELOCK_ADDRESS = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';

type CrossChainHandler = typeof import('../../utils/clients/tenderly').handleCrossChainSimulations;
type CrossChainSourceResult = Parameters<CrossChainHandler>[0];

type TransportOutcome =
  | { type: 'return'; sim: TenderlySimulation }
  | { type: 'throw'; error: Error };

const transportCalls: Array<Record<string, unknown> | undefined> = [];
const transportQueue: TransportOutcome[] = [];

let handleCrossChainSimulations: CrossChainHandler;
let tenderlyImportVersion = 0;

beforeEach(async () => {
  ({ handleCrossChainSimulations } = await import(
    `../../utils/clients/tenderly?execution-engine-test=${tenderlyImportVersion++}`
  ));
});

afterEach(() => {
  transportCalls.length = 0;
  transportQueue.length = 0;
  mockedSendSimulation.mockClear();
});

function enqueueSimulation(sim: TenderlySimulation) {
  transportQueue.push({ type: 'return', sim });
}

function enqueueFailure(error: string) {
  transportQueue.push({ type: 'throw', error: new Error(error) });
}

function makeSimulation(params: {
  id: string;
  status?: boolean;
  stateDiff?: Array<{ address: string; key: string; dirty: string; original?: string }>;
  errorReason?: string;
}): TenderlySimulation {
  const sim = createMockSimulation([]);

  sim.simulation.id = params.id;
  sim.simulation.network_id = String(CELO_CHAIN_ID);
  sim.simulation.block_number = 31_000_000;
  sim.simulation.status = params.status ?? true;

  sim.transaction.network_id = String(CELO_CHAIN_ID);
  sim.transaction.block_number = 31_000_000;
  sim.transaction.status = params.status ?? true;

  const callTrace = sim.transaction.transaction_info
    .call_trace as typeof sim.transaction.transaction_info.call_trace & {
    error_reason?: string;
  };
  callTrace.error_reason = params.errorReason;
  sim.transaction.transaction_info.state_diff =
    params.stateDiff?.map((entry) => ({
      soltype: null,
      original: entry.original ?? '0x0',
      dirty: entry.dirty,
      raw: [
        {
          address: entry.address,
          key: entry.key,
          original: entry.original ?? '0x0',
          dirty: entry.dirty,
        },
      ],
    })) ?? [];

  return sim;
}

function makeWormholeCalldata(
  calls: Array<{
    target: `0x${string}`;
    value?: bigint;
    data: `0x${string}`;
  }>,
): `0x${string}` {
  return encodeFunctionData({
    abi: WORMHOLE_SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [
      calls.map((call) => call.target),
      calls.map((call) => call.value ?? 0n),
      calls.map((call) => call.data),
      WORMHOLE_ADDRESS,
      14,
    ],
  });
}

function makeSourceResult(calldatas: readonly `0x${string}`[]): CrossChainSourceResult {
  const sim = createMockSimulation([]);
  sim.transaction.status = true;

  return {
    sim,
    proposal: {
      id: 999n,
      proposalId: 999n,
      proposer: TIMELOCK_ADDRESS,
      targets: calldatas.map(() => WORMHOLE_PROPOSAL_TARGET),
      values: calldatas.map(() => 0n),
      signatures: calldatas.map(() => ''),
      calldatas: [...calldatas],
      startBlock: 1000n,
      endBlock: 2000n,
      description: 'Test wormhole proposal',
    },
    deps: {
      governor: null,
      timelock: { address: TIMELOCK_ADDRESS },
      publicClient: null,
      chainConfig: getChainConfig(mainnet.id),
      targets: calldatas.map(() => WORMHOLE_PROPOSAL_TARGET),
      touchedContracts: [],
    },
    latestBlock: {
      number: 1500n,
      timestamp: 1_600_000_000n,
    },
  };
}

describe('cross-chain destination execution engine', () => {
  test('keeps step results and commits merged state for a successful multi-step job', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000A1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000A2');
    const calldata = makeWormholeCalldata([
      { target: firstTarget, data: '0x11111111' },
      { target: secondTarget, data: '0x22222222' },
    ]);

    enqueueSimulation(
      makeSimulation({
        id: 'step-1',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xaa' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'step-2',
        stateDiff: [{ address: secondTarget, key: '0x02', dirty: '0xbb' }],
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xaa',
        },
      },
    });

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('success');
    expect(jobResult?.stepResults).toHaveLength(2);
    expect(jobResult?.stepResults[0]?.sim?.simulation.id).toBe('step-1');
    expect(jobResult?.stepResults[1]?.sim?.simulation.id).toBe('step-2');
    expect(jobResult?.accumulatedSim?.simulation.id).toBe('step-2');
    expect(result.crossChainFailure).toBe(false);
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[firstTarget]?.storage?.['0x01']).toBe(
      '0xaa',
    );
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[secondTarget]?.storage?.['0x02']).toBe(
      '0xbb',
    );
  });

  test('preserves earlier successful steps but does not commit state when a later step fails', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000B1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000B2');
    const calldata = makeWormholeCalldata([
      { target: firstTarget, data: '0x33333333' },
      { target: secondTarget, data: '0x44444444' },
    ]);

    enqueueSimulation(
      makeSimulation({
        id: 'step-success',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xcc' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'step-failure',
        status: false,
        errorReason: 'bridge reverted',
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xcc',
        },
      },
    });

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('failure');
    expect(jobResult?.stepResults).toHaveLength(2);
    expect(jobResult?.stepResults[0]?.status).toBe('success');
    expect(jobResult?.stepResults[0]?.sim?.simulation.id).toBe('step-success');
    expect(jobResult?.stepResults[1]?.status).toBe('failure');
    expect(jobResult?.stepResults[1]?.sim?.simulation.id).toBe('step-failure');
    expect(jobResult?.error).toBe('bridge reverted');
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationStateByChain[CELO_CHAIN_ID]).toBeUndefined();
  });

  test('later jobs on the same chain start from committed state of earlier successful jobs', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000C1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000C2');
    const firstJob = makeWormholeCalldata([{ target: firstTarget, data: '0x55555555' }]);
    const secondJob = makeWormholeCalldata([{ target: secondTarget, data: '0x66666666' }]);

    enqueueSimulation(
      makeSimulation({
        id: 'job-1-step',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xdd' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'job-2-step',
        stateDiff: [{ address: secondTarget, key: '0x02', dirty: '0xee' }],
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([firstJob, secondJob]));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xdd',
        },
      },
    });

    expect(result.crossChainFailure).toBe(false);
    expect(result.destinationJobResults).toHaveLength(2);
    expect(result.destinationJobResults.every((jobResult) => jobResult.status === 'success')).toBe(
      true,
    );
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[firstTarget]?.storage?.['0x01']).toBe(
      '0xdd',
    );
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[secondTarget]?.storage?.['0x02']).toBe(
      '0xee',
    );
  });

  test('later failed jobs on the same chain do not roll back earlier committed state', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000D1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000D2');
    const firstJob = makeWormholeCalldata([{ target: firstTarget, data: '0x77777777' }]);
    const secondJob = makeWormholeCalldata([{ target: secondTarget, data: '0x88888888' }]);

    enqueueSimulation(
      makeSimulation({
        id: 'job-1-step',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xff' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'job-2-step',
        status: false,
        errorReason: 'second job reverted',
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([firstJob, secondJob]));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xff',
        },
      },
    });

    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults).toHaveLength(2);
    expect(result.destinationJobResults[0]?.status).toBe('success');
    expect(result.destinationJobResults[1]?.status).toBe('failure');
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[firstTarget]?.storage?.['0x01']).toBe(
      '0xff',
    );
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[secondTarget]).toBeUndefined();
  });

  test('records API exceptions without recording a sim or committing state', async () => {
    const target = getAddress('0x00000000000000000000000000000000000000E1');
    const seededAddress = getAddress('0x00000000000000000000000000000000000000E2');
    const calldata = makeWormholeCalldata([{ target, data: '0x77777777' }]);

    enqueueFailure('network down');

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]), {
      initialStateByChain: {
        [CELO_CHAIN_ID]: {
          [seededAddress]: {
            storage: {
              '0x09': '0xseed',
            },
          },
        },
      },
    });

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('failure');
    expect(jobResult?.stepResults).toHaveLength(1);
    expect(jobResult?.stepResults[0]?.sim).toBeUndefined();
    expect(jobResult?.error).toContain('network down');
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[seededAddress]?.storage?.['0x09']).toBe(
      '0xseed',
    );
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[target]).toBeUndefined();
  });
});
