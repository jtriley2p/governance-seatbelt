import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, getAddress, parseAbi } from 'viem';
import { celo } from 'viem/chains';
import { parseWormholeMessagesFromProposal } from '../utils/bridges/wormhole';

const WORMHOLE_SENDER_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);

describe('wormhole proposal parser', () => {
  test('extracts celo destination calls from wormhole sendMessage calldata', () => {
    const celoTargets = [
      getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc'),
      getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f'),
      getAddress('0x288dc841A52FCA2707c6947B3A777c5E56cd87BC'),
    ];

    const celoCalldatas = [
      '0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
      '0xa2e74af6000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
      '0xf2fde38b000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
    ] as const;

    const calldata = encodeFunctionData({
      abi: WORMHOLE_SENDER_ABI,
      functionName: 'sendMessage',
      args: [
        celoTargets,
        [0n, 0n, 0n],
        [...celoCalldatas],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const messages = parseWormholeMessagesFromProposal(
      [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
      [calldata],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].destinationChainId).toBe(celo.id);
    expect(messages[0].bridgeType).toBe('WormholeL1L2');
    expect(messages[0].l2FromAddress).toBe(
      getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071'),
    );
    expect(messages[0].sourceOrder).toBe(0);
    expect(messages[0].calls.map((call) => call.l2TargetAddress)).toEqual(celoTargets);
    expect(messages[0].calls.map((call) => call.l2InputData)).toEqual([...celoCalldatas]);
    expect(messages[0].calls.map((call) => call.l2Value)).toEqual(['0', '0', '0']);
  });

  test('does not parse wormhole messages when proposal target is not known wormhole sender', () => {
    const calldata = encodeFunctionData({
      abi: WORMHOLE_SENDER_ABI,
      functionName: 'sendMessage',
      args: [
        [getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc')],
        [0n],
        ['0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7'],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const messages = parseWormholeMessagesFromProposal(
      [getAddress('0x1111111111111111111111111111111111111111')],
      [calldata],
    );

    expect(messages).toHaveLength(0);
  });
});
