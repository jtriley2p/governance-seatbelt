import { describe, expect, it } from 'bun:test';
import type { CrossChainJobPreview } from '@/hooks/use-simulation-results';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CrossChainChecksSummary } from './CrossChainChecksSummary';

function makeJob(overrides: Partial<CrossChainJobPreview> = {}): CrossChainJobPreview {
  return {
    chainId: 42161,
    chainName: 'Arbitrum',
    blockExplorerBaseUrl: 'https://arbiscan.io',
    bridgeType: 'ArbitrumL1L2',
    status: 'failure',
    error: 'bridge reverted',
    l2FromAddress: '0x1111111111111111111111111111111111111111',
    sourceOrder: 0,
    steps: [
      {
        stepIndex: 0,
        status: 'failure',
        error: 'bridge reverted',
        l2TargetAddress: '0x2222222222222222222222222222222222222222',
        l2Value: '0',
        l2InputData: '0x12345678',
        targetLabel: 'Arbitrum target',
        call: {
          selector: '0x12345678',
          signature: 'bridgeAction()',
        },
      },
    ],
    ...overrides,
  };
}

describe('CrossChainChecksSummary', () => {
  it('lists failed jobs without action or execution ordinals', () => {
    const html = renderToStaticMarkup(
      createElement(CrossChainChecksSummary, {
        jobs: [makeJob(), makeJob({ sourceOrder: 1 })],
      }),
    );

    expect(html).toContain('Cross-chain results');
    expect(html).toContain('failed:');
    expect(html).not.toContain('Action 1');
    expect(html).not.toContain('Action 2');
    expect(html).not.toContain('Execution 1');
    expect(html).not.toContain('Execution 2');
  });
});
