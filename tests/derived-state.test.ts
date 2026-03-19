import { describe, expect, test } from 'bun:test';
import { arbitrum, mainnet } from 'viem/chains';
import type {
  AllCheckResults,
  CrossChainExecutionJobResult,
  SimulationResult,
  TenderlySimulation,
} from '../types.d';
import {
  buildDerivedBaselineChains,
  buildDerivedProvenance,
  buildDerivedStateByChain,
  evaluateDependencyOutcome,
  mergeStateObjects,
} from '../utils/derived-state';

function makeSimulation(params: {
  id: string;
  blockNumber: number;
  status?: boolean;
  stateDiff?: Array<{ address: string; key: string; dirty: string; original?: string }>;
  contracts?: Array<{ address: string; balance: string; deployedBytecode?: string }>;
}): TenderlySimulation {
  const stateDiff =
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

  return {
    simulation: {
      id: params.id,
      project_id: 'project',
      owner_id: 'owner',
      network_id: `${mainnet.id}`,
      block_number: params.blockNumber,
      transaction_index: 0,
      from: '0x0000000000000000000000000000000000001234',
      to: '0x0000000000000000000000000000000000005678',
      input: '0x',
      gas: 21_000,
      gas_price: '0',
      value: '0',
      method: 'execute',
      status: params.status ?? true,
      access_list: null,
      queue_origin: '',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    },
    transaction: {
      hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      block_hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      block_number: params.blockNumber,
      from: '0x0000000000000000000000000000000000001234',
      gas: 21_000,
      gas_price: 0,
      gas_fee_cap: 0,
      gas_tip_cap: 0,
      cumulative_gas_used: 21_000,
      gas_used: 21_000,
      effective_gas_price: 0,
      input: '0x',
      nonce: 0,
      to: '0x0000000000000000000000000000000000005678',
      index: 0,
      value: '0',
      access_list: null,
      status: params.status ?? true,
      addresses: [],
      contract_ids: [],
      network_id: `${mainnet.id}`,
      function_selector: '0x',
      transaction_info: {
        contract_id: 'contract',
        block_number: params.blockNumber,
        transaction_id: '0x1111111111111111111111111111111111111111111111111111111111111111',
        contract_address: '0x0000000000000000000000000000000000005678',
        method: 'execute',
        parameters: null,
        intrinsic_gas: 21_000,
        refund_gas: 0,
        call_trace: {
          from: '0x0000000000000000000000000000000000001234',
          to: '0x0000000000000000000000000000000000005678',
          input: '0x',
        },
        stack_trace: null,
        logs: null,
        state_diff: stateDiff,
        raw_state_diff: null,
        console_logs: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        asset_changes: null,
        balance_changes: null,
      },
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      method: 'execute',
      decoded_input: null,
    },
    contracts:
      params.contracts?.map((contract, index) => ({
        id: `contract-${index}`,
        contract_id: `contract-${index}`,
        balance: contract.balance,
        deployed_bytecode: contract.deployedBytecode,
        network_id: `${mainnet.id}`,
        public: true,
        verified_by: 'test',
        verification_date: null,
        address: contract.address,
        contract_name: `Contract${index}`,
        ens_domain: null,
        type: 'contract',
        evm_version: 'paris',
        compiler_version: '0.8.20',
        optimizations_used: false,
        optimization_runs: 0,
        libraries: null,
        data: {
          main_contract: 0,
          contract_info: [],
          abi: [],
          raw_abi: null,
        },
        creation_block: params.blockNumber,
        creation_tx: '0x3333333333333333333333333333333333333333333333333333333333333333',
        creator_address: '0x0000000000000000000000000000000000001234',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        number_of_watches: null,
        language: 'Solidity',
        in_project: false,
        number_of_files: 1,
      })) ?? [],
    generated_access_list: [],
  };
}

const passingChecks: AllCheckResults = {
  'check-a': {
    name: 'Check A',
    result: {
      info: [],
      warnings: [],
      errors: [],
    },
  },
};

function makeJobResult(params: {
  chainId: number;
  bridgeType: CrossChainExecutionJobResult['bridgeType'];
  status: CrossChainExecutionJobResult['status'];
  sim?: TenderlySimulation;
  error?: string;
}): CrossChainExecutionJobResult {
  return {
    chainId: params.chainId,
    bridgeType: params.bridgeType,
    job: {
      bridgeType: params.bridgeType,
      destinationChainId: params.chainId,
      l2FromAddress: '0x0000000000000000000000000000000000001234',
      sourceOrder: 0,
      calls: [
        {
          l2TargetAddress: '0x0000000000000000000000000000000000005678',
          l2InputData: '0x',
          l2Value: '0',
        },
      ],
    },
    status: params.status,
    stepResults:
      params.sim && params.status === 'success'
        ? [
            {
              stepIndex: 0,
              call: {
                l2TargetAddress: '0x0000000000000000000000000000000000005678',
                l2InputData: '0x',
                l2Value: '0',
              },
              status: 'success',
              sim: params.sim,
            },
          ]
        : [],
    accumulatedSim: params.status === 'success' ? params.sim : undefined,
    error: params.error,
  };
}

describe('derived-state execution helpers', () => {
  test('builds cross-chain derived state and provenance for happy path', () => {
    const mainnetAddress = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
    const arbitrumAddress = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB';

    const source = makeSimulation({
      id: 'sim-94',
      blockNumber: 22_000_000,
      stateDiff: [
        {
          address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          key: '0x01',
          dirty: '0x05',
        },
      ],
    });

    const destination = makeSimulation({
      id: 'sim-94-arb',
      blockNumber: 310_000_000,
      stateDiff: [
        {
          address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          key: '0x02',
          dirty: '0x09',
        },
      ],
    });

    const predecessorResult: Pick<
      SimulationResult,
      'sim' | 'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'
    > = {
      sim: source,
      destinationStateByChain: {
        [arbitrum.id]: {
          [arbitrumAddress]: {
            storage: {
              '0x02': '0x09',
            },
          },
        },
      },
      destinationJobResults: [
        makeJobResult({
          chainId: arbitrum.id,
          bridgeType: 'ArbitrumL1L2',
          status: 'success',
          sim: destination,
        }),
      ],
      crossChainFailure: false,
    };

    const outcome = evaluateDependencyOutcome(predecessorResult, passingChecks, {
      [arbitrum.id]: passingChecks,
    });
    expect(outcome.status).toBe('passed');

    const derivedState = buildDerivedStateByChain(predecessorResult);
    expect(derivedState[mainnet.id]?.[mainnetAddress]?.storage?.['0x01']).toBe('0x05');
    expect(derivedState[arbitrum.id]?.[arbitrumAddress]?.storage?.['0x02']).toBe('0x09');

    const provenance = buildDerivedProvenance({
      outcome,
      reference: {
        proposalId: '94',
        simulationId: 'sim-94',
      },
      baselineChains: buildDerivedBaselineChains(predecessorResult),
    });

    expect(provenance.mode).toBe('derived');
    expect(provenance.status).toBe('passed');
    expect(provenance.derivedFromProposalId).toBe('94');
    expect(provenance.derivedFromSimulationId).toBe('sim-94');
    expect(provenance.baselineChains.some((baseline) => baseline.chainId === mainnet.id)).toBe(
      true,
    );
    expect(provenance.baselineChains.some((baseline) => baseline.chainId === arbitrum.id)).toBe(
      true,
    );
  });

  test('fails closed when predecessor simulation fails', () => {
    const failedPredecessor = {
      sim: makeSimulation({
        id: 'sim-fail',
        blockNumber: 22_000_001,
        status: false,
      }),
      crossChainFailure: false,
    };

    const outcome = evaluateDependencyOutcome(failedPredecessor, passingChecks, {});
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('source simulation failed');
  });

  test('marks dependency as inconclusive when all predecessor checks are skipped', () => {
    const skippedChecks: AllCheckResults = {
      'check-skipped': {
        name: 'Skipped Check',
        result: {
          info: [],
          warnings: [],
          errors: [],
          skipped: { reason: 'dependency chain test' },
        },
      },
    };

    const predecessor = {
      sim: makeSimulation({
        id: 'sim-inconclusive',
        blockNumber: 22_000_002,
      }),
      crossChainFailure: false,
    };

    const outcome = evaluateDependencyOutcome(predecessor, skippedChecks, {});
    expect(outcome.status).toBe('inconclusive');
    expect(outcome.reason).toContain('inconclusive');
  });

  test('marks dependency as inconclusive when destination chain is unsupported for checks', () => {
    const predecessor: Pick<
      SimulationResult,
      'sim' | 'destinationJobResults' | 'crossChainFailure'
    > = {
      sim: makeSimulation({
        id: 'sim-unsupported-destination',
        blockNumber: 22_000_003,
      }),
      destinationJobResults: [
        makeJobResult({
          chainId: 999_999,
          bridgeType: 'OptimismL1L2',
          status: 'success',
          sim: makeSimulation({
            id: 'sim-unsupported-destination-l2',
            blockNumber: 123,
          }),
        }),
      ],
      crossChainFailure: false,
    };

    const outcome = evaluateDependencyOutcome(predecessor, passingChecks, {});
    expect(outcome.status).toBe('inconclusive');
    expect(outcome.reason).toContain('does not support L2 checks');
  });

  test('marks dependency as inconclusive when destination job is skipped', () => {
    const predecessor: Pick<
      SimulationResult,
      'sim' | 'destinationJobResults' | 'crossChainFailure'
    > = {
      sim: makeSimulation({
        id: 'sim-skipped-destination',
        blockNumber: 22_000_004,
      }),
      destinationJobResults: [
        makeJobResult({
          chainId: arbitrum.id,
          bridgeType: 'ArbitrumL1L2',
          status: 'skipped',
          error: 'Destination simulation skipped by executor',
        }),
      ],
      crossChainFailure: false,
    };

    const outcome = evaluateDependencyOutcome(predecessor, passingChecks, {
      [arbitrum.id]: passingChecks,
    });
    expect(outcome.status).toBe('inconclusive');
    expect(outcome.reason).toContain('not fully validated');
  });

  test('marks dependency as inconclusive when destination checks are missing after successful sim', () => {
    const predecessor: Pick<
      SimulationResult,
      'sim' | 'destinationJobResults' | 'crossChainFailure'
    > = {
      sim: makeSimulation({
        id: 'sim-missing-destination-checks',
        blockNumber: 22_000_005,
      }),
      destinationJobResults: [
        makeJobResult({
          chainId: arbitrum.id,
          bridgeType: 'ArbitrumL1L2',
          status: 'success',
          sim: makeSimulation({
            id: 'sim-missing-destination-checks-l2',
            blockNumber: 321,
          }),
        }),
      ],
      crossChainFailure: false,
    };

    const outcome = evaluateDependencyOutcome(predecessor, passingChecks, {});
    expect(outcome.status).toBe('inconclusive');
    expect(outcome.reason).toContain('checks missing');
  });

  test('keeps base simulation overrides authoritative when merging derived state', () => {
    const normalizedAddress = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';

    const derived = {
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': {
        storage: {
          '0x01': '0xderived',
          '0x02': '0xfrom-derived',
        },
      },
    };

    const base = {
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': {
        storage: {
          '0x01': '0xbase',
          '0x03': '0xfrom-base',
        },
      },
    };

    const merged = mergeStateObjects(derived, base);

    expect(merged?.[normalizedAddress]?.storage?.['0x01']).toBe('0xbase');
    expect(merged?.[normalizedAddress]?.storage?.['0x02']).toBe('0xfrom-derived');
    expect(merged?.[normalizedAddress]?.storage?.['0x03']).toBe('0xfrom-base');
  });

  test('normalizes mixed-case address keys before merging state objects', () => {
    const normalizedAddress = '0x408ED6354d4973f66138C91495F2f2FCbd8724C3';

    const derived = {
      '0x408ed6354d4973f66138c91495f2f2fcbd8724c3': {
        storage: {
          '0x01': '0xderived',
        },
      },
    };

    const base = {
      '0x408ED6354d4973f66138C91495F2f2FCbd8724C3': {
        storage: {
          '0x02': '0xbase',
        },
      },
    };

    const merged = mergeStateObjects(derived, base);
    const mergedKeys = Object.keys(merged ?? {});

    expect(mergedKeys).toEqual([normalizedAddress]);
    expect(merged?.[normalizedAddress]?.storage).toEqual({
      '0x01': '0xderived',
      '0x02': '0xbase',
    });
  });

  test('extracts contract balances alongside storage overrides', () => {
    const sim = makeSimulation({
      id: 'sim-balance',
      blockNumber: 22_000_100,
      contracts: [
        {
          address: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
          balance: '123',
        },
      ],
      stateDiff: [
        {
          address: '0x408ed6354d4973f66138c91495f2f2fcbd8724c3',
          key: '0x01',
          dirty: '0x99',
        },
      ],
    });

    const overrides = buildDerivedStateByChain({ sim });

    expect(overrides[mainnet.id]?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.balance).toBe(
      '123',
    );
    expect(
      overrides[mainnet.id]?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.storage?.['0x01'],
    ).toBe('0x99');
  });

  test('omits empty balances from derived state overrides', () => {
    const sim = makeSimulation({
      id: 'sim-empty-balance',
      blockNumber: 22_000_101,
      contracts: [
        {
          address: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
          balance: '',
        },
      ],
      stateDiff: [
        {
          address: '0x408ed6354d4973f66138c91495f2f2fcbd8724c3',
          key: '0x01',
          dirty: '0x99',
        },
      ],
    });

    const overrides = buildDerivedStateByChain({ sim });

    expect(
      overrides[mainnet.id]?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.balance,
    ).toBeUndefined();
    expect(
      overrides[mainnet.id]?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.storage?.['0x01'],
    ).toBe('0x99');
  });

  test('extracts deployed bytecode alongside balance and storage overrides', () => {
    const sim = makeSimulation({
      id: 'sim-code',
      blockNumber: 22_000_102,
      contracts: [
        {
          address: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
          balance: '123',
          deployedBytecode: '0x6001600055',
        },
      ],
      stateDiff: [
        {
          address: '0x408ed6354d4973f66138c91495f2f2fcbd8724c3',
          key: '0x01',
          dirty: '0x99',
        },
      ],
    });

    const overrides = buildDerivedStateByChain({ sim });

    expect(overrides[mainnet.id]?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.code).toBe(
      '0x6001600055',
    );
    expect(overrides[mainnet.id]?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.balance).toBe(
      '123',
    );
    expect(
      overrides[mainnet.id]?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.storage?.['0x01'],
    ).toBe('0x99');
  });

  test('target proposal bookkeeping can override overlapping derived governance slots', () => {
    const derivedState = {
      '0x408ED6354d4973f66138C91495F2f2FCbd8724C3': {
        storage: {
          '0x01': '0xpredecessor-proposal-slot',
          '0x04': '0xkeep-governor-state',
        },
      },
      '0x1a9C8182C09F50C8318d769245beA52c32BE35BC': {
        storage: {
          '0x02': '0xpredecessor-timelock-slot',
          '0x05': '0xkeep-timelock-state',
        },
      },
    };

    const targetPayloadState = {
      '0x408ED6354d4973f66138C91495F2f2FCbd8724C3': {
        storage: {
          '0x01': '0xtarget-proposal-slot',
        },
      },
      '0x1a9C8182C09F50C8318d769245beA52c32BE35BC': {
        storage: {
          '0x02': '0xtarget-queued-slot',
        },
      },
    };

    const merged = mergeStateObjects(derivedState, targetPayloadState);

    expect(merged?.['0x408ED6354d4973f66138C91495F2f2FCbd8724C3']?.storage).toEqual({
      '0x01': '0xtarget-proposal-slot',
      '0x04': '0xkeep-governor-state',
    });
    expect(merged?.['0x1a9C8182C09F50C8318d769245beA52c32BE35BC']?.storage).toEqual({
      '0x02': '0xtarget-queued-slot',
      '0x05': '0xkeep-timelock-state',
    });
  });
});
