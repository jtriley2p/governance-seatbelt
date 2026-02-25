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
    description: 'placeholder suppression test',
    targets,
    values: targets.map(() => 0n),
    signatures: targets.map(() => '0x'),
    calldatas: targets.map(() => '0x'),
  };
}

function makeSimulation(): TenderlySimulation {
  return createMockSimulation([]);
}

describe('Selfdestruct checks - placeholder warning suppression', () => {
  test('suppresses warnings when only placeholder yields a warning', async () => {
    const placeholder = DEFAULT_SIMULATION_ADDRESS;
    const realEoa = getAddress('0x1234567890abcdef1234567890abcdef12345678');

    const deps = makeDeps({
      getCode: async ({ address }) => {
        const resolvedAddress = getAddress(address);
        if (resolvedAddress === getAddress(placeholder)) return '0x';
        if (resolvedAddress === realEoa) return '0x';
        return '0x';
      },
      getTransactionCount: async ({ address }) => {
        const resolvedAddress = getAddress(address);
        if (resolvedAddress === getAddress(placeholder)) return 0;
        if (resolvedAddress === realEoa) return 1;
        return 0;
      },
    });

    const proposal = makeProposal([placeholder, realEoa]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, makeSimulation(), deps);

    expect(res.warnings.length).toBe(0);
    expect(res.info.join('\n')).toContain('0x1234567890abCdEf1234567890AbCDEF12345678');
  });

  test('does not suppress when there are non-placeholder warnings', async () => {
    const placeholder = DEFAULT_SIMULATION_ADDRESS;
    const otherEmpty = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

    const deps = makeDeps({
      getCode: async () => '0x',
      getTransactionCount: async () => 0,
    });

    const proposal = makeProposal([placeholder, otherEmpty]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, makeSimulation(), deps);

    expect(res.warnings.length).toBeGreaterThanOrEqual(1);
    expect(res.warnings.join('\n')).toContain('(simulation placeholder)');
  });
});
