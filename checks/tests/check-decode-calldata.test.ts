import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, parseAbiItem } from 'viem';
import type { ProposalData, ProposalEvent } from '../../types';
import { BlockExplorerFactory } from '../../utils/clients/block-explorers/factory';
import { checkDecodeCalldata } from '../check-decode-calldata';
import { createMockSimulation } from './test-utils';

const TIMELOCK = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';

function buildDeps(chainId = 1): ProposalData {
  return {
    chainConfig: { chainId },
    timelock: { address: TIMELOCK },
  } as ProposalData;
}

describe('checkDecodeCalldata', () => {
  test('uses fallback matcher (target+calldata/selector) before warning', async () => {
    const sendMessageCall = encodeFunctionData({
      abi: [parseAbiItem('function sendMessage(address target, bytes message, uint32 gasLimit)')],
      functionName: 'sendMessage',
      args: [OTHER, '0x1234', 200000],
    });

    const proposal = {
      signatures: [''],
      calldatas: [sendMessageCall],
      targets: [TARGET],
      values: [0n],
    } as unknown as ProposalEvent;

    const sim = createMockSimulation([
      {
        from: OTHER, // not timelock, strict match should fail
        to: TARGET,
        input: sendMessageCall,
        value: '0',
      },
    ]);

    const originalDecode = BlockExplorerFactory.decodeFunctionWithAbi;
    BlockExplorerFactory.decodeFunctionWithAbi = async () => null;

    try {
      const result = await checkDecodeCalldata.checkProposal(proposal, sim, buildDeps(), []);

      expect(result.warnings).toHaveLength(0);
      expect(result.info.join('\n')).toContain('matched target');
      expect(result.info.join('\n')).toContain('sendMessage(');
    } finally {
      BlockExplorerFactory.decodeFunctionWithAbi = originalDecode;
    }
  });

  test('downgrades trace-match-miss to advisory when signature fallback decodes', async () => {
    const createRetryableTicketCall = encodeFunctionData({
      abi: [
        parseAbiItem(
          'function createRetryableTicket(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, bytes data)',
        ),
      ],
      functionName: 'createRetryableTicket',
      args: [
        TARGET,
        0n,
        1n,
        TIMELOCK,
        TIMELOCK,
        200000n,
        1n,
        '0x13af40350000000000000000000000003333333333333333333333333333333333333333',
      ],
    });

    const proposal = {
      signatures: [''],
      calldatas: [createRetryableTicketCall],
      targets: ['0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f'],
      values: [0n],
    } as unknown as ProposalEvent;

    const sim = createMockSimulation([]);

    const originalDecode = BlockExplorerFactory.decodeFunctionWithAbi;
    BlockExplorerFactory.decodeFunctionWithAbi = async () => null;

    try {
      const result = await checkDecodeCalldata.checkProposal(proposal, sim, buildDeps(), []);

      expect(result.warnings.join('\n')).not.toContain('Could not find matching call');
      expect(result.warnings.join('\n')).not.toContain('0x679b6ded');
      expect(result.info.join('\n')).toContain('no exact trace match');
      expect(result.info.join('\n')).toContain('createRetryableTicket(');
    } finally {
      BlockExplorerFactory.decodeFunctionWithAbi = originalDecode;
    }
  });
});
