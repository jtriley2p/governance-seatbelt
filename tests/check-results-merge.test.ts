import { describe, expect, test } from 'bun:test';
import type { AllCheckResults } from '../types.d';
import { mergeAllCheckResults } from '../utils/check-results';

describe('check result merge invariants', () => {
  test('merges repeated destination check runs for the same chain instead of overwriting', () => {
    const firstRun: AllCheckResults = {
      checkPermissionDiff: {
        name: 'Permission diff',
        result: {
          info: ['first-run'],
          warnings: [],
          errors: [],
          data: {
            before: '0x01',
          },
        },
      },
    };

    const secondRun: AllCheckResults = {
      checkPermissionDiff: {
        name: 'Permission diff',
        result: {
          info: ['second-run'],
          warnings: [],
          errors: [],
          data: {
            after: '0x02',
          },
        },
      },
    };

    const destinationChecks: Record<number, AllCheckResults> = {};
    destinationChecks[42_161] = firstRun;
    destinationChecks[42_161] = mergeAllCheckResults(destinationChecks[42_161], secondRun);

    expect(destinationChecks[42_161]?.checkPermissionDiff?.result.info).toEqual([
      'first-run',
      'second-run',
    ]);
    expect(destinationChecks[42_161]?.checkPermissionDiff?.result.data).toEqual({
      before: '0x01',
      after: '0x02',
    });
  });
});
