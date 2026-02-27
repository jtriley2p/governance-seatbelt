import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSimulationResultsJson } from '../presentation/report';

describe('derived provenance metadata in simulation-results.json', () => {
  test('writes dependency provenance when provided', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'seatbelt-derived-provenance-'));
    const outPath = join(outDir, 'simulation-results.json');

    writeSimulationResultsJson({
      governorType: 'bravo',
      blocks: {
        current: { number: 22_000_100n, timestamp: 1_700_000_000n },
        start: null,
        end: null,
      },
      proposal: {
        id: 95n,
        proposalId: 95n,
        proposer: '0x0000000000000000000000000000000000001234',
        startBlock: 22_000_010n,
        endBlock: 22_000_020n,
        description: '# Proposal 95\n\nDependent proposal.',
        targets: ['0x0000000000000000000000000000000000005678'],
        values: [0n],
        signatures: [''],
        calldatas: ['0x'],
      },
      checks: {
        'check-a': {
          name: 'Check A',
          result: { info: [], warnings: [], errors: [] },
        },
      },
      markdownReport: '# Report',
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      outputPath: outPath,
      simulationType: 'proposed',
      provenance: {
        mode: 'derived',
        status: 'passed',
        derivedFromProposalId: '94',
        derivedFromSimulationId: 'sim-94',
        baselineChains: [
          { chainId: 1, simulationId: 'sim-94', blockNumber: '22000000' },
          { chainId: 42161, simulationId: 'sim-94-arb', blockNumber: '310000000' },
        ],
      },
    });

    const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
    const dependency = parsed.report.structuredReport.metadata.dependency;

    expect(dependency.mode).toBe('derived');
    expect(dependency.status).toBe('passed');
    expect(dependency.derivedFromProposalId).toBe('94');
    expect(dependency.baselineChains).toHaveLength(2);

    rmSync(outDir, { recursive: true, force: true });
  });
});
