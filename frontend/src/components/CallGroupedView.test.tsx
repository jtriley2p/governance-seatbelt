import { describe, expect, it } from 'bun:test';
import type {
  CrossChainJobPreview,
  Proposal,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CallGroupedView } from './CallGroupedView';

function makeJob(
  overrides: Partial<CrossChainJobPreview> = {},
  signatures: string[] = ['bridgeAction()'],
): CrossChainJobPreview {
  return {
    chainId: 42161,
    chainName: 'Arbitrum',
    blockExplorerBaseUrl: 'https://arbiscan.io',
    bridgeType: 'ArbitrumL1L2',
    status: 'success',
    l2FromAddress: '0x1111111111111111111111111111111111111111',
    sourceOrder: 0,
    steps: signatures.map((signature, index) => ({
      stepIndex: index,
      status: 'success',
      l2TargetAddress: '0x2222222222222222222222222222222222222222',
      l2Value: '0',
      l2InputData: `0x${String(index + 1).padStart(8, '0')}`,
      targetLabel: 'Arbitrum target',
      call: {
        selector: `0x${String(index + 1).padStart(8, '0')}`,
        signature,
      },
    })),
    ...overrides,
  };
}

const proposal: Proposal = {
  id: '225',
  targets: [],
  values: [],
  calldatas: [],
  signatures: [],
  description: 'Cross-chain only proposal',
};

function makeReport(jobs: CrossChainJobPreview[]): StructuredSimulationReport {
  return {
    title: 'Cross-chain report',
    proposalText: '',
    status: 'success',
    summary: 'Cross-chain summary',
    checks: [],
    stateChanges: [],
    events: [],
    crossChain: { jobs },
    metadata: {
      proposalId: '225',
      proposer: '0x9999999999999999999999999999999999999999',
      chainId: 1,
      chainName: 'Ethereum',
      blockExplorerBaseUrl: 'https://etherscan.io',
    },
  };
}

describe('CallGroupedView cross-chain summary headers', () => {
  it('removes step-count copy but keeps multi-job labels and technical step details', () => {
    const html = renderToStaticMarkup(
      createElement(CallGroupedView, {
        proposal,
        report: makeReport([
          makeJob({ sourceOrder: 0 }, ['bridgeFirst()', 'bridgeSecond()']),
          makeJob({ sourceOrder: 1 }, ['cleanup()']),
        ]),
      }),
    );

    expect(html).toContain('Execution 1');
    expect(html).toContain('Execution 2');
    expect(html).toContain('bridgeFirst');
    expect(html).toContain('bridgeSecond');
    expect(html).toContain('cleanup');
    expect(html).toContain(
      'inline-flex items-center justify-center h-5 w-5 rounded bg-muted text-[10px] font-semibold text-muted-foreground shrink-0',
    );
    expect(html).not.toContain('1 step');
    expect(html).not.toContain('2 steps');
  });
});
