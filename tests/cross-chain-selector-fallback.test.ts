import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Address, type Hex, parseAbi, zeroAddress, zeroHash } from 'viem';
import { createMockSimulation } from '../checks/tests/test-utils';
import type { AllCheckResults, ProposalEvent, SimulationBlock, SimulationResult } from '../types';
import { clearFunctionSignatureRegistryCache } from '../utils/clients/function-signature-registry';

describe('cross-chain selector fallback decode', () => {
  function makeTenderlyContract(
    address: string,
    contractName: string,
  ): ReturnType<typeof createMockSimulation>['contracts'][number] {
    return {
      id: `${address}-id`,
      contract_id: `${address}-contract-id`,
      balance: '0',
      network_id: '1',
      public: true,
      verified_by: 'test',
      verification_date: null,
      address,
      contract_name: contractName,
      ens_domain: null,
      type: 'contract',
      evm_version: 'paris',
      compiler_version: '0.8.24',
      optimizations_used: false,
      optimization_runs: 0,
      libraries: null,
      data: {
        main_contract: 0,
        contract_info: [],
        abi: [],
        raw_abi: null,
      },
      creation_block: 0,
      creation_tx: zeroHash,
      creator_address: zeroAddress,
      created_at: new Date('2023-01-01T00:00:00Z'),
      number_of_watches: null,
      language: 'solidity',
      in_project: false,
      number_of_files: 1,
    };
  }

  function buildFixture(targetAddress: Address = '0x00000000000000000000000000000000000000ab') {
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

    const l2TargetAddress: Address = targetAddress;
    const l2FromAddress: Address = '0x0000000000000000000000000000000000000001';
    const l2InputData: Hex =
      '0x13af40350000000000000000000000001111111111111111111111111111111111111111';
    const stepSim = createMockSimulation([]);
    stepSim.contracts = [makeTenderlyContract(l2TargetAddress, 'MockTarget')];
    stepSim.transaction.transaction_info.logs = [];

    const accumulatedSim = createMockSimulation([]);
    accumulatedSim.contracts = [makeTenderlyContract(l2TargetAddress, 'MockTarget')];
    accumulatedSim.transaction.transaction_info.logs = [];

    const destinationSimulation: NonNullable<SimulationResult['destinationJobResults']>[number] = {
      chainId: 196,
      bridgeType: 'OptimismL1L2',
      status: 'success' as const,
      job: {
        bridgeType: 'OptimismL1L2' as const,
        l2FromAddress,
        destinationChainId: 196,
        sourceOrder: 0,
        calls: [
          {
            l2TargetAddress,
            l2InputData,
            l2Value: '0',
          },
        ],
      },
      stepResults: [
        {
          stepIndex: 0,
          call: {
            l2TargetAddress,
            l2InputData,
            l2Value: '0',
          },
          status: 'success' as const,
          sim: stepSim,
        },
      ],
      accumulatedSim,
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
        destinationJobResults: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const markdownPath = join(outputDir, '181.md');

      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          jobs?: Array<{ steps?: Array<{ call?: { signature?: string } }> }>;
        };
      };
      const markdown = readFileSync(markdownPath, 'utf8');

      const signature = structuredReport.crossChain?.jobs?.[0]?.steps?.[0]?.call?.signature;
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
        destinationJobResults: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const markdownPath = join(outputDir, '181.md');

      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          jobs?: Array<{ steps?: Array<{ call?: { signature?: string } }> }>;
        };
      };
      const markdown = readFileSync(markdownPath, 'utf8');

      expect(structuredReport.crossChain?.jobs?.[0]?.steps?.[0]?.call?.signature).toBe(
        'setOwner(address)',
      );
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
