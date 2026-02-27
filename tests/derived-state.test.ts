import { describe, expect, test } from 'bun:test';
import type { AllCheckResults, TenderlySimulation } from '../types.d';
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
      network_id: '1',
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
      network_id: '1',
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
    contracts: [],
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

describe('derived-state execution helpers', () => {
  test('builds cross-chain derived state and provenance for happy path', () => {
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

    const predecessorResult: {
      sim: TenderlySimulation;
      destinationSimulations: Array<{
        chainId: number;
        bridgeType: string;
        status: 'success';
        sim: TenderlySimulation;
      }>;
      crossChainFailure: boolean;
    } = {
      sim: source,
      destinationSimulations: [
        {
          chainId: 42_161,
          bridgeType: 'ArbitrumL1L2',
          status: 'success',
          sim: destination,
        },
      ],
      crossChainFailure: false,
    };

    const outcome = evaluateDependencyOutcome(predecessorResult, passingChecks, {});
    expect(outcome.status).toBe('passed');

    const derivedState = buildDerivedStateByChain(predecessorResult);
    expect(derivedState[1]?.['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']?.storage?.['0x01']).toBe(
      '0x05',
    );
    expect(
      derivedState[42_161]?.['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']?.storage?.['0x02'],
    ).toBe('0x09');

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
    expect(provenance.baselineChains.some((baseline) => baseline.chainId === 1)).toBe(true);
    expect(provenance.baselineChains.some((baseline) => baseline.chainId === 42_161)).toBe(true);
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

  test('keeps base simulation overrides authoritative when merging derived state', () => {
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

    expect(merged?.['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']?.storage?.['0x01']).toBe(
      '0xbase',
    );
    expect(merged?.['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']?.storage?.['0x02']).toBe(
      '0xfrom-derived',
    );
    expect(merged?.['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']?.storage?.['0x03']).toBe(
      '0xfrom-base',
    );
  });
});
