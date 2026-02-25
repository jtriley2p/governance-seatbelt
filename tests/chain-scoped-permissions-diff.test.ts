import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AllCheckResults,
  PermissionsDiffItem,
  ProposalEvent,
  SimulationBlock,
} from '../types';

const governorAddress = '0x3333333333333333333333333333333333333333';

function makeMockProposal(): ProposalEvent {
  return {
    id: 194n,
    proposalId: 194n,
    proposer: '0x1111111111111111111111111111111111111111',
    startBlock: 999n,
    endBlock: 1001n,
    description: '# Cross-chain permissions regression',
    targets: ['0x2222222222222222222222222222222222222222'],
    values: [0n],
    signatures: ['test()'],
    calldatas: ['0x'],
  };
}

function makeMockBlocks(): { current: SimulationBlock; start: null; end: null } {
  return {
    current: { number: 1000n, timestamp: 1234567890n },
    start: null,
    end: null,
  };
}

describe('chain-scoped permissions diff in structured report', () => {
  test('keeps main-chain permissions empty while preserving L2 permission warnings + diff items', async () => {
    process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
    process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
    process.env.ETHERSCAN_API_KEY ??= 'test';
    process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
    process.env.TENDERLY_USER ??= 'test';
    process.env.TENDERLY_PROJECT_SLUG ??= 'test';

    const { writeSimulationResultsJson } = await import('../presentation/report');

    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-chain-permissions-'));
    const outputPath = join(outputDir, 'simulation-results.json');

    const mainChecks: AllCheckResults = {
      checkPermissionDiff: {
        name: 'Permission Changes',
        result: {
          errors: [],
          warnings: [],
          info: ['No permission changes'],
          permissionsDiff: [],
        },
      },
    };

    const l2DiffItem: PermissionsDiffItem = {
      kind: 'ownership_transferred',
      contractAddress: '0x4444444444444444444444444444444444444444',
      previous: '0x5555555555555555555555555555555555555555',
      next: '0x6666666666666666666666666666666666666666',
      via: 'event',
    };

    const destinationChecks: Record<number, AllCheckResults> = {
      1868: {
        checkPermissionDiff: {
          name: 'Permission Changes',
          result: {
            errors: [],
            warnings: ['Ownership transfer detected'],
            info: [],
            permissionsDiff: [l2DiffItem],
          },
        },
      },
    };

    try {
      writeSimulationResultsJson({
        governorType: 'oz',
        blocks: makeMockBlocks(),
        proposal: makeMockProposal(),
        checks: mainChecks,
        markdownReport: '# Test Report',
        governorAddress,
        outputPath,
        destinationChecks,
      });

      const parsed: {
        report: {
          structuredReport: {
            permissionsDiff?: PermissionsDiffItem[];
            chainReports?: Array<{
              chainId: number;
              checks: Array<{ checkId?: string; status?: string }>;
              permissionsDiff?: PermissionsDiffItem[];
            }>;
          };
        };
      } = JSON.parse(readFileSync(outputPath, 'utf8'));

      const structuredReport = parsed.report.structuredReport;
      const chainReports = structuredReport.chainReports ?? [];
      const mainChain = chainReports.find((report) => report.chainId === 1);
      const l2Chain = chainReports.find((report) => report.chainId === 1868);

      expect(structuredReport.permissionsDiff).toEqual([]);
      expect(mainChain?.permissionsDiff).toEqual([]);
      expect(l2Chain?.permissionsDiff).toEqual([l2DiffItem]);

      const l2PermissionCheck = l2Chain?.checks.find(
        (check) => check.checkId === 'checkPermissionDiff',
      );
      expect(l2PermissionCheck?.status).toBe('warning');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
