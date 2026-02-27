import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractVerificationList } from './ContractVerificationList';

describe('ContractVerificationList link routing', () => {
  it('preserves Sourcify links for Sourcify-verified contracts', () => {
    const address = '0x1111111111111111111111111111111111111111';
    const details = `[${address}](https://repo.sourcify.dev/contracts/full_match/480/${address}/): Contract (verified via Sourcify)`;

    const html = renderToStaticMarkup(
      createElement(ContractVerificationList, {
        details,
      }),
    );

    expect(html).toContain(`href="https://repo.sourcify.dev/contracts/full_match/480/${address}/"`);
    expect(html).not.toContain(`href="https://etherscan.io/address/${address}"`);
  });

  it('uses chain explorer links from check details for non-mainnet chains', () => {
    const address = '0x2222222222222222222222222222222222222222';
    const details = `[${address}](https://soneium.blockscout.com/address/${address}): Contract (verified via verification backend API)`;

    const html = renderToStaticMarkup(
      createElement(ContractVerificationList, {
        details,
        blockExplorerBaseUrl: 'https://soneium.blockscout.com',
      }),
    );

    expect(html).toContain(`href="https://soneium.blockscout.com/address/${address}"`);
    expect(html).not.toContain('https://etherscan.io/address/');
  });
});
