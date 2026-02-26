import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../types';

function seedEnv(): void {
  process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
  process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
  process.env.ETHERSCAN_API_KEY ??= 'test-key';
  process.env.TENDERLY_ACCESS_TOKEN ??= 'test-token';
  process.env.TENDERLY_USER ??= 'test-user';
  process.env.TENDERLY_PROJECT_SLUG ??= 'test-project';
}

function makeDeps(overrides?: Partial<ProposalData>): ProposalData {
  return {
    governor: { address: getAddress('0x1111111111111111111111111111111111111111') },
    timelock: { address: getAddress('0x2222222222222222222222222222222222222222') },
    publicClient: overrides?.publicClient ?? {
      getCode: async (_: { address: string }) => '0x60', // non-empty => contract path
      getTransactionCount: async (_: { address: string }) => 1,
    },
    chainConfig: {
      chainId: 1,
      blockExplorer: { baseUrl: 'https://etherscan.io' },
    },
    targets: [],
    touchedContracts: [],
    ...overrides,
  } as unknown as ProposalData;
}

function makeProposal(targets: string[]): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: getAddress('0x9999999999999999999999999999999999999999'),
    startBlock: 0n,
    endBlock: 1n,
    description: 'verification label test',
    targets,
    values: [0n],
    signatures: ['0x'],
    calldatas: ['0x'],
  };
}

describe('Verification checks - placeholder labeling', () => {
  test('labels placeholder and shows verified/unverified as expected', async () => {
    seedEnv();

    const { checkTargetsVerifiedOnBlockExplorer } = await import(
      '../checks/check-targets-verified-etherscan'
    );
    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { DEFAULT_SIMULATION_ADDRESS } = await import('../utils/clients/tenderly');

    const placeholder = DEFAULT_SIMULATION_ADDRESS;
    const realContract = getAddress('0x1234567890abcdef1234567890abcdef12345678');

    // Monkey-patch getContractVerification to avoid network requests
    const original = BlockExplorerFactory.getContractVerification;
    BlockExplorerFactory.getContractVerification = async (addr: string, _chainId: number) => {
      const normalized = getAddress(addr);
      if (normalized === realContract) {
        return { status: 'unverified', source: 'none' as const };
      }
      return { status: 'verified', source: 'block-explorer' as const };
    };

    try {
      const deps = makeDeps();
      const proposal = makeProposal([placeholder, realContract]);
      const res = await checkTargetsVerifiedOnBlockExplorer.checkProposal(
        proposal,
        {} as unknown as TenderlySimulation,
        deps,
      );

      const output = res.info.join('\n');
      expect(output).toContain('(simulation placeholder)');
      expect(output).toMatch(/Contract \(verified via/); // placeholder
      expect(output).toMatch(/Contract \(unverified; checked Sourcify \+/); // realContract
    } finally {
      BlockExplorerFactory.getContractVerification = original;
    }
  });
});
