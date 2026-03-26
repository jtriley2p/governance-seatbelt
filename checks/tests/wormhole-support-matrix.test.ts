import { describe, expect, test } from 'bun:test';
import {
  SUPPORTED_WORMHOLE_LANE_KEYS,
  WORMHOLE_LANE_SUPPORT_MATRIX,
  getWormholeSupportMatrixIssues,
} from '../../utils/bridges/wormhole-support';
import { REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS } from '../../tests/fixtures/test-only-wormhole-lane-configs';

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
      if (lane.executionMode === 'receiver') {
        expect(lane.wormholeReceiverCoreAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    }
  });
});
