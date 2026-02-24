import { describe, expect, test } from 'bun:test';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { checkTargetsNoSelfdestruct } from '../check-targets-no-selfdestruct';

const GOVERNOR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TIMELOCK = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TRUSTED_PROXY = '0x1111111111111111111111111111111111111111';
const UNKNOWN_SURFACE = '0x2222222222222222222222222222222222222222';

describe('checkTargetsNoSelfdestruct', () => {
  test('reclassifies trusted bridge/proxy delegatecall surfaces as advisory info', async () => {
    const delegatecallBytecode = '0x5b6000f4';

    const publicClient = {
      getCode: async ({ address }: { address: `0x${string}` }) => {
        if (address.toLowerCase() === TRUSTED_PROXY.toLowerCase()) return delegatecallBytecode;
        if (address.toLowerCase() === UNKNOWN_SURFACE.toLowerCase()) return delegatecallBytecode;
        return '0x';
      },
      getTransactionCount: async () => 1,
    };

    const deps = {
      governor: { address: GOVERNOR },
      timelock: { address: TIMELOCK },
      chainConfig: {
        chainId: 1,
        blockExplorer: { baseUrl: 'https://etherscan.io' },
      },
      publicClient,
    } as unknown as ProposalData;

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
});
