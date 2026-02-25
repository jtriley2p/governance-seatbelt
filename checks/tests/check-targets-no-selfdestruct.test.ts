import { describe, expect, test } from 'bun:test';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import {
  checkTargetsNoSelfdestruct,
  checkTouchedContractsNoSelfdestruct,
} from '../check-targets-no-selfdestruct';

const GOVERNOR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TIMELOCK = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TRUSTED_PROXY = '0x1111111111111111111111111111111111111111';
const UNKNOWN_SURFACE = '0x2222222222222222222222222222222222222222';
const EMPTY_TARGET = '0x3333333333333333333333333333333333333333';
const TOUCHED_EMPTY = '0x4444444444444444444444444444444444444444';
const TOUCHED_DELEGATECALL = '0x5555555555555555555555555555555555555555';

function makeDeps(publicClient: ProposalData['publicClient']): ProposalData {
  return {
    governor: { address: GOVERNOR },
    timelock: { address: TIMELOCK },
    chainConfig: {
      chainId: 1,
      blockExplorer: { baseUrl: 'https://etherscan.io' },
    },
    publicClient,
  } as unknown as ProposalData;
}

describe('checkTargetsNoSelfdestruct', () => {
  test('reclassifies trusted bridge/proxy delegatecall surfaces as advisory info', async () => {
    const delegatecallBytecode = '0x5b6000f4';

    const deps = makeDeps({
      getCode: async ({ address }: { address: `0x${string}` }) => {
        if (address.toLowerCase() === TRUSTED_PROXY.toLowerCase()) return delegatecallBytecode;
        if (address.toLowerCase() === UNKNOWN_SURFACE.toLowerCase()) return delegatecallBytecode;
        return '0x';
      },
      getTransactionCount: async () => 1,
    } as ProposalData['publicClient']);

    const proposal = {
      targets: [TRUSTED_PROXY, UNKNOWN_SURFACE],
    } as unknown as ProposalEvent;

    const sim = {
      contracts: [
        { address: TRUSTED_PROXY, contract_name: 'L1CrossDomainMessenger' },
        { address: UNKNOWN_SURFACE, contract_name: 'CustomBridgeExecutor' },
      ],
      transaction: { addresses: [] },
    } as unknown as TenderlySimulation;

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
    } as ProposalData['publicClient']);

    const proposal = {
      targets: [EMPTY_TARGET],
    } as unknown as ProposalEvent;

    const sim = {
      contracts: [],
      transaction: { addresses: [] },
    } as unknown as TenderlySimulation;

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
      getCode: async ({ address }: { address: `0x${string}` }) => {
        if (address.toLowerCase() === TOUCHED_DELEGATECALL.toLowerCase())
          return delegatecallBytecode;
        return '0x';
      },
      getTransactionCount: async ({ address }: { address: `0x${string}` }) => {
        if (address.toLowerCase() === TOUCHED_DELEGATECALL.toLowerCase()) return 1;
        return 0;
      },
    } as ProposalData['publicClient']);

    const sim = {
      contracts: [],
      transaction: { addresses: [TOUCHED_EMPTY, TOUCHED_DELEGATECALL] },
    } as unknown as TenderlySimulation;

    const result = await checkTouchedContractsNoSelfdestruct.checkProposal(
      {} as ProposalEvent,
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
