import { describe, expect, test } from 'bun:test';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { checkStateChanges } from '../check-state-changes';

describe('checkStateChanges', () => {
  test('formats tuple fallback state diffs as informational raw slot deltas', async () => {
    const contractAddress = '0x1111111111111111111111111111111111111111';

    const sim = {
      contracts: [{ address: contractAddress, contract_name: 'ExampleConfig' }],
      transaction: {
        status: true,
        transaction_info: {
          state_diff: [
            {
              soltype: {
                name: 'config',
                type: 'tuple',
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
          ],
        },
      },
    } as unknown as TenderlySimulation;

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
});
