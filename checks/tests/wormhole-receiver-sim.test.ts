import { describe, expect, test } from 'bun:test';
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi } from 'viem';
import type { CrossChainExecutionJob } from '../../types.d';
import {
  buildWormholeReceiverSimulationCall,
  getWormholeMessageTimestamp,
  getWormholeReceiverRuntimeStateKey,
} from '../../utils/cross-chain/wormhole-receiver-sim';

describe('wormhole receiver simulation helpers', () => {
  test('builds receiver-mode calldata with the expected envelope fields', () => {
    const receiver = getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b');
    const target = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const job: CrossChainExecutionJob = {
      bridgeType: 'WormholeL1L2',
      destinationChainId: 4217,
      l2FromAddress: receiver,
      wormholeChainId: 68,
      sourceOrder: 0,
      calls: [
        {
          l2TargetAddress: target,
          l2InputData: '0x8da5cb5b',
          l2Value: '0',
        },
      ],
    };

    const call = buildWormholeReceiverSimulationCall(
      job,
      {
        expectedPayloadVersion:
          '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b',
        nextSequence: 7n,
      },
      1_600_000_000n,
    );

    expect(call.l2TargetAddress).toBe(receiver);
    expect(call.l2Value).toBe('0');

    const decodedCall = decodeFunctionData({
      abi: parseAbi(['function receiveMessage(bytes whMessage)']),
      data: call.l2InputData,
    });
    const [whMessage] = decodedCall.args;
    const [timestamp, sequence, payload] = decodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
      whMessage,
    );
    const [payloadVersion, targets, values, datas, receiverAddress, wormholeChainId] =
      decodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address[]' },
          { type: 'uint256[]' },
          { type: 'bytes[]' },
          { type: 'address' },
          { type: 'uint16' },
        ],
        payload,
      );

    expect(timestamp).toBe(1_600_000_000);
    expect(sequence).toBe(7n);
    expect(payloadVersion).toBe(
      '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b',
    );
    expect(targets).toEqual([target]);
    expect(values).toEqual([0n]);
    expect(datas).toEqual(['0x8da5cb5b']);
    expect(receiverAddress).toBe(receiver);
    expect(wormholeChainId).toBe(68);
  });

  test('builds cache keys by chain and normalized receiver address', () => {
    expect(
      getWormholeReceiverRuntimeStateKey(
        4217,
        getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b'),
      ),
    ).toBe('4217:0xcfb43dc56b55be9611ded8384201cecf06a9811b');
  });

  test('rejects timestamps that do not fit the Wormhole uint32 envelope', () => {
    expect(() => getWormholeMessageTimestamp(0x1_0000_0000n)).toThrow(
      'Invalid Wormhole message timestamp',
    );
  });
});
