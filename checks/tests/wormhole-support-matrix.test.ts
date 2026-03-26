import { describe, expect, test } from 'bun:test';
import { REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS } from '../../tests/fixtures/test-only-wormhole-lane-configs';
import {
  TEST_ONLY_WORMHOLE_LANES,
  TEST_ONLY_WORMHOLE_LANE_ARTIFACTS,
} from '../../tests/fixtures/test-only-wormhole-lane-state';
import {
  SUPPORTED_WORMHOLE_LANE_KEYS,
  WORMHOLE_LANE_SUPPORT_MATRIX,
  getWormholeSupportMatrixIssues,
} from '../../utils/bridges/wormhole-support';

describe('Wormhole support matrix', () => {
  test('has no internal consistency issues', () => {
    expect(getWormholeSupportMatrixIssues()).toEqual([]);
  });

  test('representative rollout lanes remain a supported subset and exclude historical-only Celo', () => {
    expect(REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS).not.toContain('celo');

    for (const laneKey of REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS) {
      expect(SUPPORTED_WORMHOLE_LANE_KEYS).toContain(laneKey);
    }
  });

  test('every supported lane has validation targets and sender coverage', () => {
    for (const laneKey of SUPPORTED_WORMHOLE_LANE_KEYS) {
      const lane = WORMHOLE_LANE_SUPPORT_MATRIX[laneKey];
      expect(lane.senderTargets.length).toBeGreaterThan(0);
      expect(lane.validationTargets.v2Factory).toMatch(/^0x[a-fA-F0-9]{40}$/);
      if (lane.executionMode !== 'direct') {
        expect(lane.wormholeReceiverCoreAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
      if (lane.executionMode === 'receiver-legacy') {
        expect(lane.legacyPayloadVersion).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(lane.legacyNextSequenceStorageSlot).toMatch(/^0x[0-9a-fA-F]{64}$/);
      }
    }
  });

  test('test-only fixtures remain aligned with every supported lane', () => {
    for (const laneKey of SUPPORTED_WORMHOLE_LANE_KEYS) {
      expect(TEST_ONLY_WORMHOLE_LANES[laneKey]).toBeDefined();
      expect(TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey]).toBeDefined();
    }
  });

  test('flags duplicate Wormhole chain ids in the support matrix', () => {
    const brokenMatrix = {
      ...WORMHOLE_LANE_SUPPORT_MATRIX,
      polygon: {
        ...WORMHOLE_LANE_SUPPORT_MATRIX.polygon,
        wormholeChainId: WORMHOLE_LANE_SUPPORT_MATRIX.bnb.wormholeChainId,
      },
    };

    expect(getWormholeSupportMatrixIssues(brokenMatrix)).toContain(
      `Duplicate Wormhole chain id ${WORMHOLE_LANE_SUPPORT_MATRIX.bnb.wormholeChainId} for lane polygon`,
    );
  });

  test('flags lanes with no recognized sender targets', () => {
    const brokenMatrix = {
      ...WORMHOLE_LANE_SUPPORT_MATRIX,
      bnb: {
        ...WORMHOLE_LANE_SUPPORT_MATRIX.bnb,
        senderTargets: [],
      },
    };

    expect(getWormholeSupportMatrixIssues(brokenMatrix)).toContain(
      'Lane bnb has no recognized Wormhole sender targets',
    );
  });

  test('flags receiver-mode lanes missing the receiver core address', () => {
    const brokenMatrix = {
      ...WORMHOLE_LANE_SUPPORT_MATRIX,
      tempo: {
        ...WORMHOLE_LANE_SUPPORT_MATRIX.tempo,
        wormholeReceiverCoreAddress: undefined,
      },
    };

    expect(getWormholeSupportMatrixIssues(brokenMatrix)).toContain(
      'Lane tempo uses modern receiver mode but is missing wormhole receiver core',
    );
  });
});
