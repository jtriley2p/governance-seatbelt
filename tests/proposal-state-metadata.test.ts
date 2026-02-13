import { describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerateReportsParams } from '../types';

// Mock minimal data for testing
const mockProposal = {
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

const mockBlocks = {
  current: { number: 1500n, timestamp: 1700000000n },
  start: { number: 1000n, timestamp: 1699000000n },
  end: null,
};

const mockChecks = {
  'test-check': {
    name: 'Test Check',
    result: {
      info: ['Test info'],
      warnings: [],
      errors: [],
    },
  },
};

describe('proposalState metadata', () => {
  const testOutputDir = join(__dirname, 'test-output-proposal-state');

  // Clean up before and after tests
  const cleanup = () => {
    try {
      rmSync(testOutputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  it('should include proposalState in metadata when provided', async () => {
    cleanup();
    mkdirSync(testOutputDir, { recursive: true });

    // Import dynamically to avoid issues with module resolution
    const { generateAndSaveReports } = await import('../presentation/report');

    const params: GenerateReportsParams = {
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      simulationType: 'proposed',
      proposalState: 'Queued',
    };

    await generateAndSaveReports(params);

    // Read the generated JSON report
    const jsonPath = join(testOutputDir, '1.json');
    const jsonContent = JSON.parse(readFileSync(jsonPath, 'utf-8'));

    expect(jsonContent.metadata).toBeDefined();
    expect(jsonContent.metadata.proposalState).toBe('Queued');

    cleanup();
  });

  it('should not include proposalState in metadata when not provided', async () => {
    cleanup();
    mkdirSync(testOutputDir, { recursive: true });

    const { generateAndSaveReports } = await import('../presentation/report');

    const params: GenerateReportsParams = {
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      simulationType: 'proposed',
      // proposalState intentionally omitted
    };

    await generateAndSaveReports(params);

    // Read the generated JSON report
    const jsonPath = join(testOutputDir, '1.json');
    const jsonContent = JSON.parse(readFileSync(jsonPath, 'utf-8'));

    expect(jsonContent.metadata).toBeDefined();
    expect(jsonContent.metadata.proposalState).toBeUndefined();

    cleanup();
  });

  it('should include proposalState in simulation-results.json when provided', async () => {
    cleanup();
    mkdirSync(testOutputDir, { recursive: true });

    const { writeSimulationResultsJson } = await import('../presentation/report');

    const outputPath = join(testOutputDir, 'simulation-results.json');

    writeSimulationResultsJson({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      markdownReport: '# Test Report',
      governorAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      outputPath,
      simulationType: 'proposed',
      proposalState: 'Active',
    });

    const jsonContent = JSON.parse(readFileSync(outputPath, 'utf-8'));

    expect(jsonContent.report).toBeDefined();
    expect(jsonContent.report.structuredReport).toBeDefined();
    expect(jsonContent.report.structuredReport.metadata).toBeDefined();
    expect(jsonContent.report.structuredReport.metadata.proposalState).toBe('Active');

    cleanup();
  });

  it('should handle all valid proposal states', async () => {
    const validStates = [
      'Pending',
      'Active',
      'Canceled',
      'Defeated',
      'Succeeded',
      'Queued',
      'Expired',
      'Executed',
    ];

    for (const state of validStates) {
      cleanup();
      mkdirSync(testOutputDir, { recursive: true });

      const { writeSimulationResultsJson } = await import('../presentation/report');

      const outputPath = join(testOutputDir, 'simulation-results.json');

      writeSimulationResultsJson({
        governorType: 'bravo',
        blocks: mockBlocks,
        proposal: mockProposal,
        checks: mockChecks,
        markdownReport: '# Test Report',
        governorAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        outputPath,
        simulationType: 'proposed',
        proposalState: state,
      });

      const jsonContent = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(jsonContent.report.structuredReport.metadata.proposalState).toBe(state);
    }

    cleanup();
  });
});
