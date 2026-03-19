import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormattedCheckDetails } from './FormattedCheckDetails';

function countOccurrences(source: string, token: string): number {
  return source.split(token).length - 1;
}

describe('FormattedCheckDetails target row rendering', () => {
  it('renders plain + advisory DELEGATECALL lines through the same target-row path', () => {
    const plainAddress = '0x1111111111111111111111111111111111111111';
    const advisoryAddress = '0x2222222222222222222222222222222222222222';

    const details = [
      `- [\`${plainAddress}\`](https://etherscan.io/address/${plainAddress}): Contract (with DELEGATECALL)`,
      `- [\`${advisoryAddress}\`](https://etherscan.io/address/${advisoryAddress}): Contract (with DELEGATECALL, advisory for trusted bridge/proxy surface: ResolvedDelegateProxy)`,
    ].join('\n');

    const html = renderToStaticMarkup(
      createElement(FormattedCheckDetails, {
        check: {
          title: 'Check all targets do not contain selfdestruct',
          status: 'warning',
          details,
        },
        metadata: {
          proposalId: '123',
          proposer: '0x0000000000000000000000000000000000000001',
        },
      }),
    );

    expect(html).toContain(plainAddress);
    expect(html).toContain(advisoryAddress);
    expect(
      countOccurrences(html, 'flex items-center justify-between gap-2 p-2 bg-muted/30 rounded-md'),
    ).toBe(2);
    expect(countOccurrences(html, 'Contract (with DELEGATECALL)')).toBe(2);
    expect(html).toContain('advisory for trusted bridge/proxy surface: ResolvedDelegateProxy');
    expect(html).not.toContain(
      'Contract (with DELEGATECALL, advisory for trusted bridge/proxy surface: ResolvedDelegateProxy)',
    );
  });

  it('keeps existing plain DELEGATECALL rendering unchanged', () => {
    const address = '0x3333333333333333333333333333333333333333';
    const details = `- [\`${address}\`](https://etherscan.io/address/${address}): Contract (with DELEGATECALL)`;

    const html = renderToStaticMarkup(
      createElement(FormattedCheckDetails, {
        check: {
          title: 'Check all targets do not contain selfdestruct',
          status: 'warning',
          details,
        },
        metadata: {
          proposalId: '123',
          proposer: '0x0000000000000000000000000000000000000001',
        },
      }),
    );

    expect(html).toContain(address);
    expect(countOccurrences(html, 'Contract (with DELEGATECALL)')).toBe(1);
    expect(html).not.toContain('advisory for trusted bridge/proxy surface');
  });

  it('renders backticked verification links as target rows instead of raw markdown', () => {
    const address = '0x1000000000000000000000000000000000009450';
    const details = `- [\`${address}\`](https://celoscan.io/address/${address}): EOA (may have code later, verification not applicable)`;

    const html = renderToStaticMarkup(
      createElement(FormattedCheckDetails, {
        check: {
          title: 'Check all targets are verified on Sourcify or block explorer',
          status: 'warning',
          details,
        },
        metadata: {
          proposalId: '123',
          proposer: '0x0000000000000000000000000000000000000001',
          blockExplorerBaseUrl: 'https://celoscan.io',
        },
      }),
    );

    expect(html).toContain(address);
    expect(
      countOccurrences(html, 'flex items-center justify-between gap-2 p-2 bg-muted/30 rounded-md'),
    ).toBe(1);
    expect(html).toContain('EOA (may have code later)');
    expect(html).not.toContain(`[\`${address}\`](https://celoscan.io/address/${address})`);
  });
});
