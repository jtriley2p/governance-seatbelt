import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { checkTargetsNoSelfdestruct } from '../checks/check-targets-no-selfdestruct';
import { createMockSimulation } from '../checks/tests/test-utils';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../types';
import { BlockExplorerSource } from '../utils/clients/client';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

type MockPublicClient = {
  getCode: (args: { address: `0x${string}` }) => Promise<`0x${string}`>;
  getTransactionCount: (args: { address: `0x${string}` }) => Promise<number>;
};

function makeDeps(publicClient: MockPublicClient): ProposalData {
  return {
    governor: { address: getAddress('0x1111111111111111111111111111111111111111') },
    timelock: { address: getAddress('0x2222222222222222222222222222222222222222') },
    publicClient,
    chainConfig: {
      chainId: 1,
      blockExplorer: {
        baseUrl: 'https://etherscan.io',
        apiUrl: 'https://api.etherscan.io/v2/api',
        source: BlockExplorerSource.Etherscan,
      },
      rpcUrl: 'https://example-rpc.invalid',
    },
    targets: [],
    touchedContracts: [],
  };
}

function makeProposal(targets: string[]): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: getAddress('0x9999999999999999999999999999999999999999'),
    startBlock: 0n,
    endBlock: 1n,
    description: 'security test',
    targets,
    values: targets.map(() => 0n),
    signatures: targets.map(() => '0x'),
    calldatas: targets.map(() => '0x'),
  };
}

function makeSimulation(): TenderlySimulation {
  return createMockSimulation([]);
}

describe('Selfdestruct checks - security against placeholder bypass', () => {
  test('prevents security bypass when malicious placeholder is used', async () => {
    const maliciousPlaceholder = getAddress('0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF');

    const deps = makeDeps({
      getCode: async ({ address }) => {
        const resolvedAddress = getAddress(address);
        if (resolvedAddress === maliciousPlaceholder) return '0x';
        return '0x';
      },
      getTransactionCount: async ({ address }) => {
        const resolvedAddress = getAddress(address);
        if (resolvedAddress === maliciousPlaceholder) return 0;
        return 0;
      },
    });

    const proposal = makeProposal([maliciousPlaceholder]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, makeSimulation(), deps);

    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.join('\n')).toContain('DeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF');
  });

  test('only suppresses warnings from the legitimate hardcoded placeholder', async () => {
    const legitimatePlaceholder = DEFAULT_SIMULATION_ADDRESS;

    const deps = makeDeps({
      getCode: async ({ address }) => {
        const resolvedAddress = getAddress(address);
        if (resolvedAddress === getAddress(legitimatePlaceholder)) return '0x';
        return '0x';
      },
      getTransactionCount: async ({ address }) => {
        const resolvedAddress = getAddress(address);
        if (resolvedAddress === getAddress(legitimatePlaceholder)) return 0;
        return 0;
      },
    });

    const proposal = makeProposal([legitimatePlaceholder]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, makeSimulation(), deps);

    expect(res.warnings.length).toBe(0);
  });
});
