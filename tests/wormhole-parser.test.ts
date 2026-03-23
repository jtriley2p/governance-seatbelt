import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, getAddress } from 'viem';
import { avalanche, bsc, celo, monad, polygon, tempo } from 'viem/chains';
import {
  WORMHOLE_SEND_MESSAGE_ABI,
  extractWormholeExecutionJobsFromProposal,
} from '../utils/bridges/wormhole';

describe('wormhole proposal parser', () => {
  const supportedLanes = [
    {
      chainName: 'BNB',
      wormholeChainId: 4,
      destinationChainId: bsc.id,
      expectedSender: getAddress('0x341c1511141022cf8eE20824Ae0fFA3491F1302b'),
      target: getAddress('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7'),
    },
    {
      chainName: 'Polygon',
      wormholeChainId: 5,
      destinationChainId: polygon.id,
      expectedSender: getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374'),
      target: getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'),
    },
    {
      chainName: 'Avalanche',
      wormholeChainId: 6,
      destinationChainId: avalanche.id,
      expectedSender: getAddress('0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc'),
      target: getAddress('0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD'),
    },
    {
      chainName: 'Celo',
      wormholeChainId: 14,
      destinationChainId: celo.id,
      expectedSender: getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071'),
      target: getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc'),
    },
    {
      chainName: 'Monad',
      wormholeChainId: 48,
      destinationChainId: monad.id,
      expectedSender: getAddress('0xe783de89a7f0408687f051e3e6d0beb62719ebad'),
      target: getAddress('0x204faca1764b154221e35c0d20abb3c525710498'),
    },
    {
      chainName: 'Tempo',
      wormholeChainId: 68,
      destinationChainId: tempo.id,
      expectedSender: getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b'),
      target: getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6'),
    },
  ];

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
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        celoTargets,
        [0n, 0n, 0n],
        [...celoCalldatas],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const jobs = extractWormholeExecutionJobsFromProposal(
      [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
      [calldata],
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.destinationChainId).toBe(celo.id);
    expect(jobs[0]?.bridgeType).toBe('WormholeL1L2');
    expect(jobs[0]?.wormholeChainId).toBe(14);
    expect(jobs[0]?.l2FromAddress).toBe(getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071'));
    expect(jobs[0]?.sourceOrder).toBe(0);
    expect(jobs[0]?.calls.map((call) => call.l2TargetAddress)).toEqual(celoTargets);
    expect(jobs[0]?.calls.map((call) => call.l2InputData)).toEqual([...celoCalldatas]);
    expect(jobs[0]?.calls.map((call) => call.l2Value)).toEqual(['0', '0', '0']);
  });

  test.each(supportedLanes)(
    'maps $chainName wormhole chain id to the expected destination authority',
    ({ wormholeChainId, destinationChainId, expectedSender, target }) => {
      const calldata = encodeFunctionData({
        abi: WORMHOLE_SEND_MESSAGE_ABI,
        functionName: 'sendMessage',
        args: [
          [target],
          [0n],
          ['0x13af40350000000000000000000000001111111111111111111111111111111111111111'],
          getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
          wormholeChainId,
        ],
      });

      const jobs = extractWormholeExecutionJobsFromProposal(
        [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
        [calldata],
      );

      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.destinationChainId).toBe(destinationChainId);
      expect(jobs[0]?.wormholeChainId).toBe(wormholeChainId);
      expect(jobs[0]?.l2FromAddress).toBe(expectedSender);
      expect(jobs[0]?.calls).toHaveLength(1);
    },
  );

  test('does not parse wormhole messages when proposal target is not known wormhole sender', () => {
    const calldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        [getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc')],
        [0n],
        ['0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7'],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const jobs = extractWormholeExecutionJobsFromProposal(
      [getAddress('0x1111111111111111111111111111111111111111')],
      [calldata],
    );

    expect(jobs).toHaveLength(0);
  });
});
