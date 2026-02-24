import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAbi } from 'viem';
import type {
  AllCheckResults,
  ProposalEvent,
  SimulationBlock,
  SimulationResult,
  TenderlySimulation,
} from '../types';
import { clearFunctionSignatureRegistryCache } from '../utils/clients/function-signature-registry';

describe('cross-chain selector fallback decode', () => {
  function buildFixture(targetAddress = '0x00000000000000000000000000000000000000ab') {
    const proposal: ProposalEvent = {
      id: 181n,
      proposalId: 181n,
      proposer: '0x1234567890abcdef1234567890abcdef12345678',
      startBlock: 19000000n,
      endBlock: 19100000n,
      description: '# Selector Fallback Regression Test',
      targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
      values: [0n],
      signatures: [''],
      calldatas: ['0x'],
    };

    const blocks = {
      current: { number: 19200000n, timestamp: 1700000000n } as SimulationBlock,
      start: { number: 19000000n, timestamp: 1699000000n } as SimulationBlock,
      end: { number: 19100000n, timestamp: 1699500000n } as SimulationBlock,
    };

    const checks: AllCheckResults = {
      'test-check': {
        name: 'Test Check',
        result: {
          errors: [],
          warnings: [],
          info: ['ok'],
        },
      },
    };

    const l2TargetAddress = targetAddress;
    const destinationSimulation: NonNullable<SimulationResult['destinationSimulations']>[number] = {
      chainId: 196,
      bridgeType: 'OptimismL1L2',
      status: 'success' as const,
      sim: {
        contracts: [
          {
            address: l2TargetAddress,
            contract_name: 'MockTarget',
          },
        ],
        transaction: {
          transaction_info: {
            logs: [],
          },
        },
      } as unknown as TenderlySimulation,
      l2Params: {
        bridgeType: 'OptimismL1L2' as const,
        destinationChainId: '196',
        l2TargetAddress: l2TargetAddress as `0x${string}`,
        l2InputData:
          '0x13af40350000000000000000000000001111111111111111111111111111111111111111' as `0x${string}`,
        l2Value: '0',
        l2FromAddress: '0x0000000000000000000000000000000000000001' as `0x${string}`,
      },
    };

    return { proposal, blocks, checks, destinationSimulation };
  }

  it('uses 4byte fallback when explorer ABI lookup fails', async () => {
    process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
    process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
    process.env.ETHERSCAN_API_KEY ??= 'test';
    process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
    process.env.TENDERLY_USER ??= 'test';
    process.env.TENDERLY_PROJECT_SLUG ??= 'test';

    const { generateAndSaveReports } = await import('../presentation/report');
    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');

    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-cross-chain-selector-'));
    const originalFetch = globalThis.fetch;
    const originalFetchContractAbi = BlockExplorerFactory.fetchContractAbi;

    clearFunctionSignatureRegistryCache();

    BlockExplorerFactory.fetchContractAbi = async () => null;

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const urlString =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (!urlString.includes('4byte.directory')) {
        throw new Error(`Unexpected fetch URL in test: ${urlString}`);
      }

      return new Response(
        JSON.stringify({
          count: 1,
          results: [
            {
              text_signature: 'setOwner(address)',
              hex_signature: '0x13af4035',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const { proposal, blocks, checks, destinationSimulation } = buildFixture();

    try {
      await generateAndSaveReports({
        governorType: 'bravo',
        blocks,
        proposal,
        checks,
        outputDir,
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        destinationSimulations: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const markdownPath = join(outputDir, '181.md');

      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          messages?: Array<{ call?: { signature?: string } }>;
        };
      };
      const markdown = readFileSync(markdownPath, 'utf8');

      const signature = structuredReport.crossChain?.messages?.[0]?.call?.signature;
      expect(signature).toBe('setOwner(address)');
      expect(markdown).toContain('Call: `setOwner(address)`');
      expect(markdown).not.toContain('Call: `0x13af4035`');
    } finally {
      globalThis.fetch = originalFetch;
      BlockExplorerFactory.fetchContractAbi = originalFetchContractAbi;
      clearFunctionSignatureRegistryCache();
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('prefers ABI decode over 4byte fallback when both are available', async () => {
    process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
    process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
    process.env.ETHERSCAN_API_KEY ??= 'test';
    process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
    process.env.TENDERLY_USER ??= 'test';
    process.env.TENDERLY_PROJECT_SLUG ??= 'test';

    const { generateAndSaveReports } = await import('../presentation/report');
    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');

    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-cross-chain-abi-priority-'));
    const originalFetch = globalThis.fetch;
    const originalFetchContractAbi = BlockExplorerFactory.fetchContractAbi;
    const { proposal, blocks, checks, destinationSimulation } = buildFixture(
      '0x00000000000000000000000000000000000000ac',
    );
    let fourByteFetchCalls = 0;

    clearFunctionSignatureRegistryCache();

    const abi = parseAbi(['function setOwner(address _owner)']);
    BlockExplorerFactory.fetchContractAbi = async () =>
      abi as Awaited<ReturnType<typeof BlockExplorerFactory.fetchContractAbi>>;

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const urlString =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlString.includes('4byte.directory')) fourByteFetchCalls += 1;
      throw new Error(`Unexpected fetch URL in test: ${urlString}`);
    }) as typeof fetch;

    try {
      await generateAndSaveReports({
        governorType: 'bravo',
        blocks,
        proposal,
        checks,
        outputDir,
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        destinationSimulations: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const markdownPath = join(outputDir, '181.md');

      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          messages?: Array<{ call?: { signature?: string } }>;
        };
      };
      const markdown = readFileSync(markdownPath, 'utf8');

      expect(structuredReport.crossChain?.messages?.[0]?.call?.signature).toBe('setOwner(address)');
      expect(markdown).toContain('Call: `setOwner(address)`');
      expect(fourByteFetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      BlockExplorerFactory.fetchContractAbi = originalFetchContractAbi;
      clearFunctionSignatureRegistryCache();
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);
});
