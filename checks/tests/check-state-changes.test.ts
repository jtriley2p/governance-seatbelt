import { describe, expect, test } from 'bun:test';
import { zeroAddress, zeroHash } from 'viem';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { checkStateChanges } from '../check-state-changes';
import { createMockSimulation } from './test-utils';

type StateDiffEntry = NonNullable<
  TenderlySimulation['transaction']['transaction_info']['state_diff']
>[number];
type StateDiffSoltype = NonNullable<StateDiffEntry['soltype']>;

describe('checkStateChanges', () => {
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

  test('formats tuple fallback state diffs as informational raw slot deltas', async () => {
    const contractAddress = '0x1111111111111111111111111111111111111111';

    const sim = createMockSimulation([]);
    sim.contracts = [makeTenderlyContract(contractAddress, 'ExampleConfig')];
    sim.transaction.transaction_info.state_diff = [
      {
        soltype: {
          name: 'config',
          type: 'tuple' as StateDiffSoltype['type'],
          storage_location: 'default' as StateDiffSoltype['storage_location'],
          components: null,
          offset: 0,
          index: '0',
          indexed: false,
        },
        original: { owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        dirty: { owner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        raw: [
          {
            address: contractAddress,
            key: '0x01',
            original: '0x00',
            dirty: '0x01',
          },
        ],
      },
    ];

    const deps = {
      chainConfig: { chainId: 1 },
      governor: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      timelock: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    } as unknown as ProposalData;

    const result = await checkStateChanges.checkProposal({} as ProposalEvent, sim, deps);

    expect(result.warnings).toHaveLength(0);
    expect(result.info.join('\n')).toContain('Structured diff fallback for type `tuple`');
    expect(result.info.join('\n')).toContain('• Slot `0x01`: `0x00` → `0x01`');
  });

  test('formats numeric mapping state diffs beyond uint256 as decoded key changes', async () => {
    const contractAddress = '0x1111111111111111111111111111111111111111';
    const holder = '0x2222222222222222222222222222222222222222';

    const sim = createMockSimulation([]);
    sim.contracts = [makeTenderlyContract(contractAddress, 'GovernanceToken')];
    sim.transaction.transaction_info.state_diff = [
      {
        soltype: {
          name: 'balances',
          type: 'mapping (address => uint96)',
          storage_location: 'default' as StateDiffSoltype['storage_location'],
          components: null,
          offset: 0,
          index: '0',
          indexed: false,
        },
        original: { [holder]: '1000000000000000000' },
        dirty: { [holder]: '0' },
        raw: [
          {
            address: contractAddress,
            key: '0x01',
            original: '0x0de0b6b3a7640000',
            dirty: '0x00',
          },
        ],
      },
    ];

    const deps = {
      chainConfig: { chainId: 1 },
      governor: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      timelock: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    } as unknown as ProposalData;

    const result = await checkStateChanges.checkProposal({} as ProposalEvent, sim, deps);
    const info = result.info.join('\n');

    expect(result.warnings).toHaveLength(0);
    expect(info).not.toContain('Structured diff fallback for type `mapping (address => uint96)`');
    expect(info).toContain(
      '`balances` key `0x2222222222222222222222222222222222222222` changed from `1000000000000000000` to `0`',
    );
  });

  test('matches Tenderly contract metadata case-insensitively', async () => {
    const contractAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

    const sim = createMockSimulation([]);
    sim.contracts = [makeTenderlyContract(contractAddress, 'ExampleConfig')];
    sim.transaction.transaction_info.state_diff = [
      {
        soltype: null,
        original: '0x00',
        dirty: '0x01',
        raw: [
          {
            address: contractAddress,
            key: '0x01',
            original: '0x00',
            dirty: '0x01',
          },
        ],
      },
    ];

    const deps = {
      governor: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      timelock: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    } as unknown as ProposalData;

    const result = await checkStateChanges.checkProposal({} as ProposalEvent, sim, deps);

    expect(result.info[0]).toBe('ExampleConfig at `0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD`');
  });
});
