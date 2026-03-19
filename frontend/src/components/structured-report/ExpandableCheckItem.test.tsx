import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpandableCheckItem } from './ExpandableCheckItem';

describe('ExpandableCheckItem secondary line formatting', () => {
  it('hides collapsed verification subtext while keeping the inferred badge', () => {
    const address = '0x1000000000000000000000000000000000009450';
    const secondAddress = '0x1000000000000000000000000000000000009451';
    const html = renderToStaticMarkup(
      createElement(ExpandableCheckItem, {
        check: {
          checkId: 'checkTargetsVerifiedOnBlockExplorer',
          title: 'Check all targets are verified on Sourcify or block explorer',
          status: 'passed',
          details: [
            `[\`${address}\`](https://celoscan.io/address/${address}): EOA (may have code later, verification not applicable)`,
            `[\`${secondAddress}\`](https://celoscan.io/address/${secondAddress}): EOA (verification not applicable)`,
          ].join('\n'),
        },
        coverage: {
          checkId: 'checkTargetsVerifiedOnBlockExplorer',
          checkName: 'Check all targets are verified on Sourcify or block explorer',
          status: 'skipped',
          skipReason: `[\`${address}\`](https://celoscan.io/address/${address}): EOA (may have code later, verification not applicable)`,
          wasInferred: true,
          chainId: 42220,
        },
      }),
    );

    expect(html).toContain('Inferred');
    expect(html).not.toContain('2 EOA / other addresses');
    expect(html).not.toContain(`[\`${address}\`](https://celoscan.io/address/${address})`);
    expect(html).not.toContain(
      `${address}: EOA (may have code later, verification not applicable)`,
    );
  });
});
