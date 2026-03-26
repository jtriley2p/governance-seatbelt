import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, getAddress } from 'viem';
import {
  WORMHOLE_SEND_MESSAGE_ABI,
  extractWormholeExecutionJobsFromProposal,
} from '../utils/bridges/wormhole';
import {
  SUPPORTED_WORMHOLE_LANE_KEYS,
  getWormholeLaneByKey,
} from '../utils/bridges/wormhole-support';

describe('wormhole proposal parser', () => {
  const supportedLanes = SUPPORTED_WORMHOLE_LANE_KEYS.map((laneKey) => {
    const lane = getWormholeLaneByKey(laneKey);
    return {
      chainName: lane.chainName,
      wormholeChainId: lane.wormholeChainId,
      destinationChainId: lane.destinationChainId,
      expectedSender: lane.l2FromAddress,
      target: lane.validationTargets.v3Factory ?? lane.validationTargets.v2Factory,
    };
  });

  test('extracts celo destination calls from wormhole sendMessage calldata', () => {
    const celoLane = getWormholeLaneByKey('celo');
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
    expect(jobs[0]?.destinationChainId).toBe(celoLane.destinationChainId);
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

  test('does not parse wormhole messages for unsupported wormhole chain ids', () => {
    const calldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        [getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc')],
        [0n],
        ['0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7'],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        999,
      ],
    });

    const jobs = extractWormholeExecutionJobsFromProposal(
      [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
      [calldata],
    );

    expect(jobs).toHaveLength(0);
  });

  test('does not parse wormhole messages when sendMessage array lengths are inconsistent', () => {
    const targetA = getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc');
    const targetB = getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f');

    const calldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        [targetA, targetB],
        [0n],
        [
          '0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
          '0xa2e74af6000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
        ],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const jobs = extractWormholeExecutionJobsFromProposal(
      [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
      [calldata],
    );

    expect(jobs).toHaveLength(0);
  });
});
