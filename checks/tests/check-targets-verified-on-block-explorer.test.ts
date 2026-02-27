import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import type { ProposalData, ProposalEvent } from '../../types';
import type { ChainConfig } from '../../utils/clients/client';
import { createMockSimulation } from './test-utils';

function seedRpcEnv(): void {
  process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
  process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
  process.env.ETHERSCAN_API_KEY ??= 'test-key';
  process.env.TENDERLY_ACCESS_TOKEN ??= 'test-token';
  process.env.TENDERLY_USER ??= 'test-user';
  process.env.TENDERLY_PROJECT_SLUG ??= 'test-project';
}

function makeProposal(): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: getAddress('0x9999999999999999999999999999999999999999'),
    startBlock: 0n,
    endBlock: 1n,
    description: 'L2 touched verification test',
    targets: [],
    values: [],
    signatures: [],
    calldatas: [],
  };
}

function makeDeps(chainConfig: ChainConfig): ProposalData {
  return {
    governor: { address: getAddress('0x1111111111111111111111111111111111111111') },
    timelock: { address: getAddress('0x2222222222222222222222222222222222222222') },
    publicClient: {
      getCode: async (_: { address: string }) => '0x6000',
      getTransactionCount: async (_: { address: string }) => 1,
    },
    chainConfig,
    targets: [],
    touchedContracts: [],
  };
}

describe('checkTouchedContractsVerifiedOnBlockExplorer L2 behavior', () => {
  test('uses product copy for verification check labels', async () => {
    const { checkTargetsVerifiedOnBlockExplorer, checkTouchedContractsVerifiedOnBlockExplorer } =
      await import('../check-targets-verified-on-block-explorer');

    expect(checkTargetsVerifiedOnBlockExplorer.name).toBe('Check all targets are verified');
    expect(checkTouchedContractsVerifiedOnBlockExplorer.name).toBe(
      'Check all touched contracts are verified',
    );
  });

  test('runs on L2 when touched contracts exist', async () => {
    seedRpcEnv();

    const { checkTouchedContractsVerifiedOnBlockExplorer } = await import(
      '../check-targets-verified-on-block-explorer'
    );
    const { BlockExplorerFactory } = await import('../../utils/clients/block-explorers/factory');
    const { VerificationBackend } = await import('../../utils/clients/client');

    const chainConfig: ChainConfig = {
      chainId: 10,
      blockExplorer: { baseUrl: 'https://optimistic.etherscan.io' },
      verification: {
        backend: VerificationBackend.EtherscanV2,
      },
      rpcUrl: 'https://optimism.example.invalid',
    };

    const touched = getAddress('0x1234567890abcdef1234567890abcdef12345678');
    const sim = createMockSimulation([]);
    sim.transaction.addresses = [touched];

    const original = BlockExplorerFactory.getContractVerification;
    BlockExplorerFactory.getContractVerification = async () => ({
      status: 'verified',
      source: 'block-explorer',
      verificationBackend: VerificationBackend.EtherscanV2,
    });

    try {
      const result = await checkTouchedContractsVerifiedOnBlockExplorer.checkProposal(
        makeProposal(),
        sim,
        makeDeps(chainConfig),
      );

      expect(result.skipped).toBeUndefined();
      expect(result.info.join('\n')).toContain('Contract (verified via verification backend API)');
    } finally {
      BlockExplorerFactory.getContractVerification = original;
    }
  });

  test('marks unverified contracts as warnings (not pass-only info)', async () => {
    seedRpcEnv();

    const { checkTouchedContractsVerifiedOnBlockExplorer } = await import(
      '../check-targets-verified-on-block-explorer'
    );
    const { BlockExplorerFactory } = await import('../../utils/clients/block-explorers/factory');
    const { VerificationBackend } = await import('../../utils/clients/client');

    const chainConfig: ChainConfig = {
      chainId: 1868,
      blockExplorer: { baseUrl: 'https://soneium.blockscout.com' },
      verification: {
        backend: VerificationBackend.Blockscout,
      },
      rpcUrl: 'https://soneium.example.invalid',
    };

    const touched = getAddress('0x34567890abcdef1234567890abcdef1234567890');
    const sim = createMockSimulation([]);
    sim.transaction.addresses = [touched];

    const original = BlockExplorerFactory.getContractVerification;
    BlockExplorerFactory.getContractVerification = async () => ({
      status: 'unverified',
      source: 'none',
      verificationBackend: VerificationBackend.Blockscout,
    });

    try {
      const result = await checkTouchedContractsVerifiedOnBlockExplorer.checkProposal(
        makeProposal(),
        sim,
        makeDeps(chainConfig),
      );

      expect(result.info.join('\n')).toContain('Contract (unverified; checked Sourcify +');
      expect(result.warnings.join('\n')).toContain('Unverified contract:');
    } finally {
      BlockExplorerFactory.getContractVerification = original;
    }
  });

  test('routes World Chain Sourcify verification links to Sourcify artifacts', async () => {
    seedRpcEnv();

    const { checkTouchedContractsVerifiedOnBlockExplorer } = await import(
      '../check-targets-verified-on-block-explorer'
    );
    const { BlockExplorerFactory } = await import('../../utils/clients/block-explorers/factory');
    const { VerificationBackend } = await import('../../utils/clients/client');

    const chainConfig: ChainConfig = {
      chainId: 480,
      blockExplorer: { baseUrl: 'https://worldscan.org' },
      verification: {
        backend: VerificationBackend.SourcifyOnly,
      },
      rpcUrl: 'https://worldchain.example.invalid',
    };

    const touched = getAddress('0x1234567890abcdef1234567890abcdef12345678');
    const sim = createMockSimulation([]);
    sim.transaction.addresses = [touched];

    const original = BlockExplorerFactory.getContractVerification;
    BlockExplorerFactory.getContractVerification = async () => ({
      status: 'verified',
      source: 'sourcify',
      sourcifyMatch: 'exact_match',
      verificationBackend: VerificationBackend.SourcifyOnly,
    });

    try {
      const result = await checkTouchedContractsVerifiedOnBlockExplorer.checkProposal(
        makeProposal(),
        sim,
        makeDeps(chainConfig),
      );

      const output = result.info.join('\n');
      expect(output).toContain(
        `[${touched}](https://repo.sourcify.dev/contracts/full_match/480/${touched}/)`,
      );
      expect(output).not.toContain(`[${touched}](https://worldscan.org/address/${touched})`);
    } finally {
      BlockExplorerFactory.getContractVerification = original;
    }
  });

  test('routes Soneium explorer-verified links to Soneium explorer', async () => {
    seedRpcEnv();

    const { checkTouchedContractsVerifiedOnBlockExplorer } = await import(
      '../check-targets-verified-on-block-explorer'
    );
    const { BlockExplorerFactory } = await import('../../utils/clients/block-explorers/factory');
    const { VerificationBackend } = await import('../../utils/clients/client');

    const chainConfig: ChainConfig = {
      chainId: 1868,
      blockExplorer: { baseUrl: 'https://soneium.blockscout.com' },
      verification: {
        backend: VerificationBackend.Blockscout,
      },
      rpcUrl: 'https://soneium.example.invalid',
    };

    const touched = getAddress('0x234567890abcdef1234567890abcdef123456789');
    const sim = createMockSimulation([]);
    sim.transaction.addresses = [touched];

    const original = BlockExplorerFactory.getContractVerification;
    BlockExplorerFactory.getContractVerification = async () => ({
      status: 'verified',
      source: 'block-explorer',
      verificationBackend: VerificationBackend.Blockscout,
    });

    try {
      const result = await checkTouchedContractsVerifiedOnBlockExplorer.checkProposal(
        makeProposal(),
        sim,
        makeDeps(chainConfig),
      );

      const output = result.info.join('\n');
      expect(output).toContain(`[${touched}](https://soneium.blockscout.com/address/${touched})`);
      expect(output).not.toContain(`[${touched}](https://etherscan.io/address/${touched})`);
    } finally {
      BlockExplorerFactory.getContractVerification = original;
    }
  });

  test('skips on L2 when destination simulation has no touched contracts', async () => {
    seedRpcEnv();

    const { checkTouchedContractsVerifiedOnBlockExplorer } = await import(
      '../check-targets-verified-on-block-explorer'
    );
    const { VerificationBackend } = await import('../../utils/clients/client');

    const chainConfig: ChainConfig = {
      chainId: 10,
      blockExplorer: { baseUrl: 'https://optimistic.etherscan.io' },
      verification: {
        backend: VerificationBackend.EtherscanV2,
      },
      rpcUrl: 'https://optimism.example.invalid',
    };

    const sim = createMockSimulation([]);
    sim.transaction.addresses = [];

    const result = await checkTouchedContractsVerifiedOnBlockExplorer.checkProposal(
      makeProposal(),
      sim,
      makeDeps(chainConfig),
    );

    expect(result.skipped?.reason).toBe('No touched contracts found in destination simulation');
  });
});
