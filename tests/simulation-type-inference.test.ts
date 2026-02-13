import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateAndSaveReports } from '../presentation/report';
import type { TenderlySimulation } from '../types';

// Minimal mock simulation for report generation
const mockSimulation: TenderlySimulation = {
  simulation: {
    id: 'test-sim-163',
    project_id: 'test-project',
    owner_id: 'test-owner',
    network_id: '1',
    block_number: 20000000,
    transaction_index: 0,
    from: '0x0000000000000000000000000000000000001234',
    to: '0x0000000000000000000000000000000000005678',
    input: '0x',
    gas: 21000,
    gas_price: '1000000000',
    value: '0',
    method: 'test',
    status: true,
    access_list: null,
    queue_origin: '',
    created_at: new Date('2026-01-01T00:00:00Z'),
  },
  transaction: {
    hash: '0xtest163',
    block_hash: '0xblock',
    block_number: 20000000,
    from: '0x0000000000000000000000000000000000001234',
    gas: 21000,
    gas_price: 1000000000,
    gas_fee_cap: 1000000000,
    gas_tip_cap: 1000000000,
    cumulative_gas_used: 21000,
    gas_used: 21000,
    effective_gas_price: 1000000000,
    input: '0x',
    nonce: 0,
    to: '0x0000000000000000000000000000000000005678',
    index: 0,
    value: '0',
    access_list: null,
    status: true,
    addresses: [],
    contract_ids: [],
    network_id: '1',
    function_selector: '0x',
    transaction_info: {
      contract_id: 'test',
      block_number: 20000000,
      transaction_id: '0xtest163',
      contract_address: '0x0000000000000000000000000000000000005678',
      method: 'test',
      parameters: null,
      intrinsic_gas: 21000,
      refund_gas: 0,
      call_trace: {
        from: '0x0000000000000000000000000000000000001234',
        to: '0x0000000000000000000000000000000000005678',
        input: '0x',
      },
      stack_trace: null,
      logs: null,
      state_diff: [],
      raw_state_diff: null,
      console_logs: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      asset_changes: null,
      balance_changes: null,
    },
    timestamp: new Date('2026-01-01T00:00:00Z'),
    method: 'test',
    decoded_input: null,
  },
  contracts: [],
  generated_access_list: [],
};

const mockBlocks = {
  current: { number: 20000000n, timestamp: 1735689600n },
  start: null,
  end: null,
};

const mockProposal = {
  id: 163n,
  proposalId: 163n,
  proposer: '0x0000000000000000000000000000000000001234',
  targets: ['0x0000000000000000000000000000000000005678'],
  values: [0n],
  signatures: [''],
  calldatas: ['0x'],
  startBlock: 20000000n,
  endBlock: 20000001n,
  description: 'Test proposal for Issue #163 simulationType inference',
};

const mockChecks = {
  'Test Check': {
    name: 'Test Check',
    result: {
      info: [],
      warnings: [],
      errors: [],
    },
  },
};

const TEST_DIR = join(__dirname, 'test-reports-issue-163');

function readStructuredReport(dir: string): Record<string, unknown> {
  const simResultsPath = join(dir, '163-simulation-results.json');
  if (!existsSync(simResultsPath)) {
    throw new Error(`simulation-results.json not found at ${simResultsPath}`);
  }
  const raw = JSON.parse(readFileSync(simResultsPath, 'utf-8'));
  const results = Array.isArray(raw) ? raw : [raw];
  return results[0]?.report?.structuredReport ?? {};
}

describe('Issue #163: simulationType inference from proposal state', () => {
  beforeAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('explicit simulationType is preserved when provided', async () => {
    const outputDir = join(TEST_DIR, 'explicit');
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      executor: '0x0000000000000000000000000000000000009999',
      proposalCreatedBlock: { number: 19999000n, timestamp: 1735680000n },
      proposalExecutedBlock: { number: 20000500n, timestamp: 1735700000n },
      chainId: 1,
      simulationType: 'proposed', // Explicit — should NOT be overridden by inference
      simulation: mockSimulation,
      daoName: 'TestDAO',
      contracts: [],
    });

    const report = readStructuredReport(outputDir);
    const metadata = report.metadata as Record<string, unknown>;
    expect(metadata.simulationType).toBe('proposed');
  });

  test('infers "executed" when proposalExecutedBlock is present and simulationType is undefined', async () => {
    const outputDir = join(TEST_DIR, 'infer-executed');
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      executor: '0x0000000000000000000000000000000000009999',
      proposalCreatedBlock: { number: 19999000n, timestamp: 1735680000n },
      proposalExecutedBlock: { number: 20000500n, timestamp: 1735700000n },
      chainId: 1,
      simulationType: undefined, // Not provided — should infer from blocks
      simulation: mockSimulation,
      daoName: 'TestDAO',
      contracts: [],
    });

    const report = readStructuredReport(outputDir);
    const metadata = report.metadata as Record<string, unknown>;
    expect(metadata.simulationType).toBe('executed');
  });

  test('infers "proposed" when only proposalCreatedBlock is present', async () => {
    const outputDir = join(TEST_DIR, 'infer-proposed');
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      executor: '0x0000000000000000000000000000000000009999',
      proposalCreatedBlock: { number: 19999000n, timestamp: 1735680000n },
      proposalExecutedBlock: undefined, // No executed block
      chainId: 1,
      simulationType: undefined,
      simulation: mockSimulation,
      daoName: 'TestDAO',
      contracts: [],
    });

    const report = readStructuredReport(outputDir);
    const metadata = report.metadata as Record<string, unknown>;
    expect(metadata.simulationType).toBe('proposed');
  });

  test('infers "new" when neither created nor executed block is present', async () => {
    const outputDir = join(TEST_DIR, 'infer-new');
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      executor: '0x0000000000000000000000000000000000009999',
      proposalCreatedBlock: undefined,
      proposalExecutedBlock: undefined,
      chainId: 1,
      simulationType: undefined,
      simulation: mockSimulation,
      daoName: 'TestDAO',
      contracts: [],
    });

    const report = readStructuredReport(outputDir);
    const metadata = report.metadata as Record<string, unknown>;
    expect(metadata.simulationType).toBe('new');
  });
});
