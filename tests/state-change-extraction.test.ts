import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateReportsParams } from '../types';

const proposal = {
  id: 1n,
  proposalId: 1n,
  proposer: '0x1234567890123456789012345678901234567890',
  startBlock: 1000n,
  endBlock: 2000n,
  description: '# Test Proposal\n\nThis is a test proposal.',
  targets: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  values: [0n],
  signatures: ['test()'],
  calldatas: ['0x'],
};

const blocks = {
  current: { number: 1500n, timestamp: 1700000000n },
  start: { number: 1000n, timestamp: 1699000000n },
  end: null,
};

async function generateStateChangeReport(outputDir: string, info: string[]) {
  const { generateAndSaveReports } = await import('../presentation/report');

  await generateAndSaveReports({
    governorType: 'bravo',
    blocks,
    proposal,
    checks: {
      checkStateChanges: {
        name: 'Reports all state changes from the proposal',
        result: { info, warnings: [], errors: [] },
      },
    },
    outputDir,
    governorAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    simulationType: 'proposed',
  } satisfies GenerateReportsParams);

  return JSON.parse(readFileSync(join(outputDir, '1.json'), 'utf-8'));
}

describe('structured state change extraction', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-state-changes-'));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('keeps raw slot changes in structured state changes', async () => {
    const slot = '0xc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b';

    const report = await generateStateChangeReport(outputDir, [
      'Franchiser at `0x3d4ACFD2C8b0641fb8db762179eE5A8dB385E573`',
      `    Slot \`${slot}\` changed from \`0x01\` to \`0x00\``,
    ]);

    expect(report.stateChanges).toContainEqual({
      contract: 'Franchiser',
      contractAddress: '0x3d4ACFD2C8b0641fb8db762179eE5A8dB385E573',
      key: slot,
      oldValue: '0x01',
      newValue: '0x00',
    });
  });

  it('preserves raw mapping keys and adds display labels', async () => {
    const holder = '0x2222222222222222222222222222222222222222';

    const report = await generateStateChangeReport(outputDir, [
      'GovernanceToken at `0x1111111111111111111111111111111111111111`',
      `    \`balances\` key \`${holder}\` changed from \`\` to \`7\``,
    ]);

    expect(report.stateChanges).toContainEqual({
      contract: 'GovernanceToken',
      contractAddress: '0x1111111111111111111111111111111111111111',
      key: holder,
      label: `balances[${holder}]`,
      oldValue: '',
      newValue: '7',
    });
  });
});
