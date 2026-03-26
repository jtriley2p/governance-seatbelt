import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  parseAbi,
} from 'viem';
import { mainnet, tempo } from 'viem/chains';
import type { TenderlySimulation } from '../../types.d';
import { WORMHOLE_SEND_MESSAGE_ABI } from '../../utils/bridges/wormhole';
import {
  SUPPORTED_WORMHOLE_LANE_KEYS,
  getWormholeLaneByKey,
} from '../../utils/bridges/wormhole-support';
import { createMockSimulation } from './test-utils';

process.env.ETHERSCAN_API_KEY ??= 'test-etherscan-key';
process.env.TENDERLY_ACCESS_TOKEN ??= 'test-tenderly-token';
process.env.TENDERLY_USER ??= 'test-user';
process.env.TENDERLY_PROJECT_SLUG ??= 'test-project';
process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';

async function defaultReceiverReadContract(request: {
  address: `0x${string}`;
  functionName: string;
  blockNumber?: bigint;
}) {
  expect(request.address).toBe(getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b'));
  if (request.functionName === 'nextMinimumSequence') return 7n;
  if (request.functionName === 'EXPECTED_MESSAGE_PAYLOAD_VERSION') {
    return '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b';
  }
  throw new Error(`Unexpected readContract call for ${request.functionName}`);
}

async function defaultGetBlockNumber() {
  return 100n;
}

async function defaultGetBlock(request?: { blockNumber?: bigint }) {
  const blockNumber = request?.blockNumber ?? 100n;
  return {
    number: blockNumber,
    timestamp: 1_600_000_000n + blockNumber,
  };
}

const mockedReceiverReadContract = mock(defaultReceiverReadContract);
const mockedGetBlockNumber = mock(defaultGetBlockNumber);
const mockedGetBlock = mock(defaultGetBlock);

const mockedGetClientForChain = mock(() => ({
  getBlockNumber: mockedGetBlockNumber,
  getBlock: mockedGetBlock,
  readContract: mockedReceiverReadContract,
}));

mock.module('../../utils/clients/client', () => ({
  BlockExplorerSource: {
    Blockscout: 'blockscout',
    Etherscan: 'etherscan',
  },
  VerificationBackend: {
    EtherscanV2: 'etherscan-v2',
    Blockscout: 'blockscout',
    Tempo: 'tempo',
    SourcifyOnly: 'sourcify-only',
  },
  formatVerificationBackend: (backend: string) => backend,
  getBlockExplorerBaseUrlForChain: () => 'https://etherscan.io',
  getClientForChain: mockedGetClientForChain,
  getChainConfig: () => ({
    chainId: mainnet.id,
    blockExplorer: { baseUrl: 'https://etherscan.io' },
    rpcUrl: 'http://localhost:8545',
  }),
  resolveVerificationConfig: () => ({
    backend: 'etherscan-v2',
    apiUrl: 'https://api.etherscan.io/v2/api',
    apiKey: 'test-etherscan-key',
    degradedReason: undefined,
  }),
  CHAIN_CONFIGS: {
    [mainnet.id]: {
      chainId: mainnet.id,
      blockExplorer: { baseUrl: 'https://etherscan.io' },
      rpcUrl: 'http://localhost:8545',
    },
  },
  publicClient: {
    getChainId: async () => mainnet.id,
    getBlock: async () => ({
      number: 31_000_000n,
      timestamp: 1_600_000_000n,
    }),
  },
}));

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
  mockedGetClientForChain.mockClear();
  mockedGetBlockNumber.mockClear();
  mockedGetBlock.mockClear();
  mockedReceiverReadContract.mockClear();
  mockedGetBlockNumber.mockImplementation(defaultGetBlockNumber);
  mockedGetBlock.mockImplementation(defaultGetBlock);
  mockedReceiverReadContract.mockImplementation(defaultReceiverReadContract);
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
  chainId?: number;
  stateDiff?: Array<{ address: string; key: string; dirty: string; original?: string }>;
  errorReason?: string;
}): TenderlySimulation {
  const sim = createMockSimulation([]);
  const chainId = params.chainId ?? CELO_CHAIN_ID;

  sim.simulation.id = params.id;
  sim.simulation.network_id = String(chainId);
  sim.simulation.block_number = 31_000_000;
  sim.simulation.status = params.status ?? true;

  sim.transaction.network_id = String(chainId);
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
  wormholeChainId = 14,
): `0x${string}` {
  return encodeFunctionData({
    abi: WORMHOLE_SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [
      calls.map((call) => call.target),
      calls.map((call) => call.value ?? 0n),
      calls.map((call) => call.data),
      WORMHOLE_ADDRESS,
      wormholeChainId,
    ],
  });
}

function makeSourceResult(
  calldatas: readonly `0x${string}`[],
  options?: { simulationTimestamp?: bigint },
): CrossChainSourceResult {
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
      chainConfig: {
        chainId: mainnet.id,
        blockExplorer: { baseUrl: 'https://etherscan.io' },
        rpcUrl: 'http://localhost:8545',
      },
      targets: calldatas.map(() => WORMHOLE_PROPOSAL_TARGET),
      touchedContracts: [],
    },
    latestBlock: {
      number: 1500n,
      timestamp: 1_600_000_000n,
    },
    simulationTimestamp: options?.simulationTimestamp,
  };
}

describe('cross-chain destination execution engine', () => {
  test('executes one simulated destination job per supported Wormhole lane', async () => {
    const calldatas = SUPPORTED_WORMHOLE_LANE_KEYS.map((laneKey) => {
      const lane = getWormholeLaneByKey(laneKey);
      const target = getAddress('0x00000000000000000000000000000000000000A1');
      return makeWormholeCalldata([{ target, data: '0x11111111' }], lane.wormholeChainId);
    });

    for (const laneKey of SUPPORTED_WORMHOLE_LANE_KEYS) {
      const lane = getWormholeLaneByKey(laneKey);
      enqueueSimulation(
        makeSimulation({
          id: `${laneKey}-step-1`,
          chainId: lane.destinationChainId,
        }),
      );
    }

    const result = await handleCrossChainSimulations(makeSourceResult(calldatas));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(SUPPORTED_WORMHOLE_LANE_KEYS.length);
    expect(result.destinationJobResults).toHaveLength(SUPPORTED_WORMHOLE_LANE_KEYS.length);

    for (const laneKey of SUPPORTED_WORMHOLE_LANE_KEYS) {
      const lane = getWormholeLaneByKey(laneKey);
      const jobResult = result.destinationJobResults.find(
        (job) => job.chainId === lane.destinationChainId,
      );
      expect(jobResult?.bridgeType).toBe('WormholeL1L2');
      expect(jobResult?.status).toBe('success');
    }
  });

  test('does not leak committed state across different destination chains', async () => {
    const bnbTarget = getAddress('0x0000000000000000000000000000000000000B56');
    const celoTarget = getAddress('0x0000000000000000000000000000000000000CE0');

    const bnbCalldata = makeWormholeCalldata([{ target: bnbTarget, data: '0x11111111' }], 4);
    const celoCalldata = makeWormholeCalldata([{ target: celoTarget, data: '0x22222222' }], 14);

    enqueueSimulation(
      makeSimulation({
        id: 'bnb-step-1',
        chainId: 56,
        stateDiff: [{ address: bnbTarget, key: '0x01', dirty: '0xaa' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'celo-step-1',
        chainId: CELO_CHAIN_ID,
        stateDiff: [{ address: celoTarget, key: '0x02', dirty: '0xbb' }],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([bnbCalldata, celoCalldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[0]?.network_id).toBe('56');
    expect(transportCalls[1]?.network_id).toBe(String(CELO_CHAIN_ID));

    const secondPayload = transportCalls[1] as any;
    expect(secondPayload?.state_objects?.[bnbTarget]).toBeUndefined();
    expect(result.destinationStateByChain[56]?.[bnbTarget]?.storage?.['0x01']).toBe('0xaa');
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[celoTarget]?.storage?.['0x02']).toBe(
      '0xbb',
    );
  });

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

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

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

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

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

  test('uses wormhole receiver mode for tempo and stubs the Wormhole core contract', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoReceiver = getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b');
    const tempoWormholeCore = getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-receiver-step',
        chainId: tempo.id,
        stateDiff: [
          {
            address: tempoReceiver,
            key: '0x0000000000000000000000000000000000000000000000000000000000000000',
            dirty: '0x01',
          },
        ],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(mockedGetClientForChain).toHaveBeenCalledWith(tempo.id);
    expect(mockedReceiverReadContract).toHaveBeenCalledTimes(2);
    expect(transportCalls[0]).toMatchObject({
      network_id: `${tempo.id}`,
      from: '0x0000000000000000000000000000000000001234',
      to: tempoReceiver,
      value: '0',
    });
    expect(String(transportCalls[0]?.input ?? '')).toMatch(/^0xf953cec7/);
    expect(transportCalls[0]?.state_objects).toMatchObject({
      [tempoWormholeCore]: {
        code: expect.stringMatching(/^0x/),
      },
    });
    const decodedTransportInput = decodeFunctionData({
      abi: parseAbi(['function receiveMessage(bytes whMessage)']),
      data: transportCalls[0]?.input as `0x${string}`,
    });
    const [whMessage] = decodedTransportInput.args;
    const [timestamp, sequence, payload] = decodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
      whMessage,
    );
    const [payloadVersion, targets, values, datas, receiverAddress, wormholeChainId] =
      decodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address[]' },
          { type: 'uint256[]' },
          { type: 'bytes[]' },
          { type: 'address' },
          { type: 'uint16' },
        ],
        payload,
      );
    expect(timestamp).toBe(1_600_000_321);
    expect(sequence).toBe(7n);
    expect(payloadVersion).toBe(
      '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b',
    );
    expect(targets).toEqual([tempoTarget]);
    expect(values).toEqual([0n]);
    expect(datas).toEqual(['0x8da5cb5b']);
    expect(receiverAddress).toBe(tempoReceiver);
    expect(wormholeChainId).toBe(68);

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('success');
    expect(jobResult?.stepResults).toHaveLength(1);
    expect(jobResult?.stepResults[0]?.sim?.simulation.id).toBe('tempo-receiver-step');
    expect(result.crossChainFailure).toBe(false);
    expect(
      result.destinationStateByChain[tempo.id]?.[tempoReceiver]?.storage?.[
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ],
    ).toBe('0x01');
    expect(result.destinationStateByChain[tempo.id]?.[tempoWormholeCore]).toBeUndefined();
  });

  test('contains receiver metadata read failures to the tempo job', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const celoTarget = getAddress('0x00000000000000000000000000000000000000F1');
    const tempoCalldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);
    const celoCalldata = makeWormholeCalldata([{ target: celoTarget, data: '0x99999999' }]);

    mockedReceiverReadContract.mockImplementation(async () => {
      throw new Error('receiver metadata unavailable');
    });

    enqueueSimulation(
      makeSimulation({
        id: 'celo-after-tempo-setup-failure',
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([tempoCalldata, celoCalldata]),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(transportCalls[0]).toMatchObject({
      network_id: `${CELO_CHAIN_ID}`,
      to: celoTarget,
    });
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults).toHaveLength(2);
    expect(result.destinationJobResults[0]?.status).toBe('failure');
    expect(result.destinationJobResults[0]?.error).toContain('receiver metadata unavailable');
    expect(result.destinationJobResults[0]?.stepResults).toHaveLength(0);
    expect(result.destinationJobResults[1]?.status).toBe('success');
  });

  test('retries a transient tempo historical block read before succeeding', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoReceiver = getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    mockedGetBlock.mockImplementationOnce(async () => {
      throw new Error('tempo historical block unavailable');
    });

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-retry-success',
        chainId: tempo.id,
        stateDiff: [
          {
            address: tempoReceiver,
            key: '0x0000000000000000000000000000000000000000000000000000000000000000',
            dirty: '0x01',
          },
        ],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedGetBlock).toHaveBeenCalledTimes(2);
    expect(result.crossChainFailure).toBe(false);
    expect(result.destinationJobResults[0]?.status).toBe('success');
    expect(result.destinationJobResults[0]?.stepResults).toHaveLength(1);
  });

  test('preserves non-code Wormhole core overrides after receiver-mode cleanup', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoWormholeCore = getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-core-override-preserved',
        chainId: tempo.id,
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]), {
      initialStateByChain: {
        [tempo.id]: {
          [tempoWormholeCore]: {
            balance: '0x2a',
            storage: {
              '0x99': '0x77',
            },
          },
        },
      },
    });

    expect(result.destinationJobResults[0]?.status).toBe('success');
    expect(result.destinationStateByChain[tempo.id]?.[tempoWormholeCore]).toEqual({
      balance: '0x2a',
      storage: {
        '0x99': '0x77',
      },
    });
  });

  test('pins initial receiver metadata reads to the simulation timestamp block', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-historical-read-block',
        chainId: tempo.id,
      }),
    );

    await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_050n }),
    );

    expect(mockedGetBlockNumber).toHaveBeenCalledTimes(1);
    expect(mockedReceiverReadContract).toHaveBeenCalledTimes(2);
    expect(mockedReceiverReadContract.mock.calls[0]?.[0]).toMatchObject({
      functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
      blockNumber: 50n,
    });
    expect(mockedReceiverReadContract.mock.calls[1]?.[0]).toMatchObject({
      functionName: 'nextMinimumSequence',
      blockNumber: 50n,
    });
  });

  test('uses receiver state overrides for later tempo jobs on the same chain', async () => {
    const tempoFirstTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoSecondTarget = getAddress('0x33620f62C5b9B2086dD6b62F4A297A9f30347029');
    const firstCalldata = makeWormholeCalldata(
      [{ target: tempoFirstTarget, data: '0x8da5cb5b' }],
      68,
    );
    const secondCalldata = makeWormholeCalldata(
      [{ target: tempoSecondTarget, data: '0x8da5cb5b' }],
      68,
    );

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-first',
        chainId: tempo.id,
        stateDiff: [
          {
            address: getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b'),
            key: '0x0000000000000000000000000000000000000000000000000000000000000000',
            dirty: '0x09',
          },
        ],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'tempo-second',
        chainId: tempo.id,
      }),
    );

    await handleCrossChainSimulations(makeSourceResult([firstCalldata, secondCalldata]));

    expect(mockedReceiverReadContract).toHaveBeenCalledTimes(2);
    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);

    const decodeSequence = (input: unknown) => {
      const decodedTransportInput = decodeFunctionData({
        abi: parseAbi(['function receiveMessage(bytes whMessage)']),
        data: input as `0x${string}`,
      });
      const [whMessage] = decodedTransportInput.args;
      const [, sequence] = decodeAbiParameters(
        [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
        whMessage,
      );
      return sequence;
    };

    expect(decodeSequence(transportCalls[0]?.input)).toBe(7n);
    expect(decodeSequence(transportCalls[1]?.input)).toBe(9n);
  });

  test('carries receiver runtime state across chained tempo simulations', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoReceiver = getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b');
    const firstCalldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);
    const secondCalldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-seeded-first-run',
        chainId: tempo.id,
        stateDiff: [
          {
            address: tempoReceiver,
            key: '0x0000000000000000000000000000000000000000000000000000000000000000',
            dirty: '0x09',
          },
        ],
      }),
    );

    const firstResult = await handleCrossChainSimulations(makeSourceResult([firstCalldata]));

    expect(firstResult.destinationJobResults[0]?.status).toBe('success');
    expect(
      firstResult.destinationStateByChain[tempo.id]?.[tempoReceiver]?.storage?.[
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ],
    ).toBe('0x09');

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-followup-run',
        chainId: tempo.id,
      }),
    );

    const secondResult = await handleCrossChainSimulations(makeSourceResult([secondCalldata]), {
      initialStateByChain: {
        [tempo.id]: firstResult.destinationStateByChain[tempo.id] ?? {},
      },
    });

    const decodedTransportInput = decodeFunctionData({
      abi: parseAbi(['function receiveMessage(bytes whMessage)']),
      data: transportCalls[1]?.input as `0x${string}`,
    });
    const [whMessage] = decodedTransportInput.args;
    const [, sequence] = decodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
      whMessage,
    );

    expect(secondResult.destinationJobResults[0]?.status).toBe('success');
    expect(sequence).toBe(9n);
  });
});
