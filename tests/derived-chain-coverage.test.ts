import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSimulationResultsJson } from '../presentation/report';
import type { AllCheckResults, CoverageData, DerivedSimulationProvenance } from '../types';

const mainChecks: AllCheckResults = {
  'check-main': {
    name: 'Main Check',
    result: { info: ['main info'], warnings: [], errors: [] },
  },
};

const destinationChecks: Record<number, AllCheckResults> = {
  10: {
    'check-op': {
      name: 'Optimism Check',
      result: { info: ['op info'], warnings: [], errors: [] },
    },
  },
  42161: {
    'check-arb': {
      name: 'Arbitrum Check',
      result: { info: ['arb info'], warnings: [], errors: [] },
    },
  },
};

function writeFixture(
  path: string,
  coverage: CoverageData,
  provenance?: DerivedSimulationProvenance,
) {
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
      description: '# Proposal 95\n\nCross-chain dependent proposal.',
      targets: ['0x0000000000000000000000000000000000005678'],
      values: [0n],
      signatures: [''],
      calldatas: ['0x'],
    },
    checks: mainChecks,
    markdownReport: '# Report',
    governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
    outputPath: path,
    chainId: 1,
    simulationType: 'proposed',
    destinationChecks,
    coverage,
    provenance,
  });
}

describe('derived report chain coverage invariants', () => {
  test('derived output preserves destination chain reports/checks and chain coverage is superset/equal', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'seatbelt-derived-coverage-'));

    const baselinePath = join(outDir, 'baseline.json');
    const derivedPath = join(outDir, 'derived.json');

    const baselineCoverage: CoverageData = {
      metadata: {
        gitCommitHash: 'baseline',
        gitBranch: 'main',
        timestamp: '2026-02-26T00:00:00.000Z',
      },
      checks: [
        { checkId: 'check-main', checkName: 'Main Check', status: 'ran', chainId: 1 },
        { checkId: 'check-op', checkName: 'Optimism Check', status: 'ran', chainId: 10 },
        { checkId: 'check-arb', checkName: 'Arbitrum Check', status: 'ran', chainId: 42161 },
      ],
      summary: { total: 3, ran: 3, skipped: 0, failed: 0, inferredSkips: 0 },
    };

    const derivedCoverage: CoverageData = {
      ...baselineCoverage,
      metadata: {
        ...baselineCoverage.metadata,
        gitCommitHash: 'derived',
      },
      checks: [
        ...baselineCoverage.checks,
        {
          checkId: 'check-base',
          checkName: 'Base Check',
          status: 'ran',
          chainId: 8453,
        },
      ],
      summary: { total: 4, ran: 4, skipped: 0, failed: 0, inferredSkips: 0 },
    };

    writeFixture(baselinePath, baselineCoverage);
    writeFixture(derivedPath, derivedCoverage, {
      mode: 'derived',
      status: 'passed',
      derivedFromProposalId: '94',
      derivedFromSimulationId: 'sim-94',
      baselineChains: [
        { chainId: 1, simulationId: 'sim-94', blockNumber: '22000000' },
        { chainId: 10, simulationId: 'sim-94-op', blockNumber: '130000000' },
        { chainId: 42161, simulationId: 'sim-94-arb', blockNumber: '310000000' },
      ],
    });

    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const derived = JSON.parse(readFileSync(derivedPath, 'utf8'));

    const baselineChainReports = baseline.report.structuredReport.chainReports as Array<{
      chainId: number;
      checks: Array<{ checkId: string }>;
    }>;

    const derivedChainReports = derived.report.structuredReport.chainReports as Array<{
      chainId: number;
      checks: Array<{ checkId: string }>;
    }>;

    const baselineChainIds = baselineChainReports.map((chain) => chain.chainId);
    const derivedChainIds = derivedChainReports.map((chain) => chain.chainId);

    for (const chainId of baselineChainIds) {
      expect(derivedChainIds).toContain(chainId);
    }

    for (const baselineChain of baselineChainReports.filter((chain) => chain.chainId !== 1)) {
      const derivedChain = derivedChainReports.find(
        (chain) => chain.chainId === baselineChain.chainId,
      );
      expect(derivedChain).toBeDefined();
      expect((derivedChain?.checks ?? []).map((check) => check.checkId)).toEqual(
        baselineChain.checks.map((check) => check.checkId),
      );
    }

    const baselineCoverageChains = new Set(
      (baseline.report.structuredReport.coverage.checks as Array<{ chainId?: number }>)
        .map((check) => check.chainId)
        .filter((chainId): chainId is number => chainId != null),
    );

    const derivedCoverageChains = new Set(
      (derived.report.structuredReport.coverage.checks as Array<{ chainId?: number }>)
        .map((check) => check.chainId)
        .filter((chainId): chainId is number => chainId != null),
    );

    for (const chainId of baselineCoverageChains) {
      expect(derivedCoverageChains.has(chainId)).toBe(true);
    }

    expect(derived.report.structuredReport.metadata.dependency.mode).toBe('derived');

    rmSync(outDir, { recursive: true, force: true });
  });
});
