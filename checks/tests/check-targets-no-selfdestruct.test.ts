import { describe, expect, test } from 'bun:test';
import { zeroAddress, zeroHash } from 'viem';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { BlockExplorerSource } from '../../utils/clients/client';
import {
  checkTargetsNoSelfdestruct,
  checkTouchedContractsNoSelfdestruct,
} from '../check-targets-no-selfdestruct';
import { createMockSimulation } from './test-utils';

const GOVERNOR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TIMELOCK = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TRUSTED_PROXY = '0x1111111111111111111111111111111111111111';
const UNKNOWN_SURFACE = '0x2222222222222222222222222222222222222222';
const EMPTY_TARGET = '0x3333333333333333333333333333333333333333';
const TOUCHED_EMPTY = '0x4444444444444444444444444444444444444444';
const TOUCHED_DELEGATECALL = '0x5555555555555555555555555555555555555555';

type MockPublicClient = {
  getCode: (args: { address: `0x${string}` }) => Promise<`0x${string}`>;
  getTransactionCount: (args: { address: `0x${string}` }) => Promise<number>;
};

function makeDeps(publicClient: MockPublicClient): ProposalData {
  return {
    governor: { address: GOVERNOR },
    timelock: { address: TIMELOCK },
    chainConfig: {
      chainId: 1,
      blockExplorer: {
        baseUrl: 'https://etherscan.io',
        apiUrl: 'https://api.etherscan.io/v2/api',
        source: BlockExplorerSource.Etherscan,
      },
      rpcUrl: 'https://example-rpc.invalid',
    },
    publicClient,
    targets: [],
    touchedContracts: [],
  };
}

function makeProposal(targets: string[]): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: GOVERNOR,
    startBlock: 0n,
    endBlock: 1n,
    description: 'selfdestruct test',
    targets,
    values: targets.map(() => 0n),
    signatures: targets.map(() => '0x'),
    calldatas: targets.map(() => '0x'),
  };
}

function makeTenderlyContract(
  address: string,
  contractName: string,
): TenderlySimulation['contracts'][number] {
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

function makeSimulation({
  addresses = [],
  namedContracts = [],
}: {
  addresses?: string[];
  namedContracts?: Array<{ address: string; contractName: string }>;
} = {}): TenderlySimulation {
  const simulation = createMockSimulation([]);
  simulation.transaction.addresses = addresses;
  simulation.contracts = namedContracts.map(({ address, contractName }) =>
    makeTenderlyContract(address, contractName),
  );
  return simulation;
}

describe('checkTargetsNoSelfdestruct', () => {
  test('reclassifies trusted bridge/proxy delegatecall surfaces as advisory info', async () => {
    const delegatecallBytecode = '0x5b6000f4';

    const deps = makeDeps({
      getCode: async ({ address }) => {
        if (address.toLowerCase() === TRUSTED_PROXY.toLowerCase()) return delegatecallBytecode;
        if (address.toLowerCase() === UNKNOWN_SURFACE.toLowerCase()) return delegatecallBytecode;
        return '0x';
      },
      getTransactionCount: async () => 1,
    });

    const proposal = makeProposal([TRUSTED_PROXY, UNKNOWN_SURFACE]);
    const sim = makeSimulation({
      namedContracts: [
        { address: TRUSTED_PROXY, contractName: 'L1CrossDomainMessenger' },
        { address: UNKNOWN_SURFACE, contractName: 'CustomBridgeExecutor' },
      ],
    });

    const result = await checkTargetsNoSelfdestruct.checkProposal(proposal, sim, deps);

    expect(result.info.join('\n')).toContain('advisory for trusted bridge/proxy surface');
    expect(result.info.join('\n')).toContain(TRUSTED_PROXY);

    expect(result.warnings.join('\n')).toContain('Contract (with DELEGATECALL)');
    expect(result.warnings.join('\n')).toContain(UNKNOWN_SURFACE);
  });

  test('uses empty-account wording and keeps warnings for proposal targets', async () => {
    const deps = makeDeps({
      getCode: async () => '0x',
      getTransactionCount: async () => 0,
    });

    const proposal = makeProposal([EMPTY_TARGET]);
    const sim = makeSimulation();

    const result = await checkTargetsNoSelfdestruct.checkProposal(proposal, sim, deps);

    expect(result.warnings.join('\n')).toContain('Empty account (could deploy code later)');
    expect(result.warnings.join('\n')).toContain(EMPTY_TARGET);
    expect(result.info.join('\n')).not.toContain('Empty account (could deploy code later)');
  });
});

describe('checkTouchedContractsNoSelfdestruct', () => {
  test('classifies empty touched accounts as info while preserving delegatecall warnings', async () => {
    const delegatecallBytecode = '0x5b6000f4';

    const deps = makeDeps({
      getCode: async ({ address }) => {
        if (address.toLowerCase() === TOUCHED_DELEGATECALL.toLowerCase())
          return delegatecallBytecode;
        return '0x';
      },
      getTransactionCount: async ({ address }) => {
        if (address.toLowerCase() === TOUCHED_DELEGATECALL.toLowerCase()) return 1;
        return 0;
      },
    });

    const sim = makeSimulation({ addresses: [TOUCHED_EMPTY, TOUCHED_DELEGATECALL] });

    const result = await checkTouchedContractsNoSelfdestruct.checkProposal(
      makeProposal([]),
      sim,
      deps,
    );

    expect(result.info.join('\n')).toContain('Empty account (could deploy code later)');
    expect(result.info.join('\n')).toContain(TOUCHED_EMPTY);
    expect(result.warnings.join('\n')).toContain('Contract (with DELEGATECALL)');
    expect(result.warnings.join('\n')).toContain(TOUCHED_DELEGATECALL);
    expect(result.warnings.join('\n')).not.toContain('Empty account (could deploy code later)');
  });
});
