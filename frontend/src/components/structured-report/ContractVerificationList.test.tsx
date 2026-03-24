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

  it('parses backticked markdown links for explorer-routed rows', () => {
    const address = '0x3333333333333333333333333333333333333333';
    const details = `[\`${address}\`](https://celoscan.io/address/${address}): EOA (may have code later, verification not applicable)`;

    const html = renderToStaticMarkup(
      createElement(ContractVerificationList, {
        details,
        blockExplorerBaseUrl: 'https://celoscan.io',
      }),
    );

    expect(html).toContain(`href="https://celoscan.io/address/${address}"`);
    expect(html).toContain('EOA');
    expect(html).not.toContain('https://etherscan.io/address/');
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

  it('prefers info rows over merged details to avoid duplicate unverified contracts', () => {
    const address = '0x4444444444444444444444444444444444444444';
    const details = [
      `**Warning**: Unverified contract: [${address}](https://explore.tempo.xyz/address/${address}): Contract (unverified; checked Sourcify + Tempo verifier API)`,
      `**Info**: [${address}](https://explore.tempo.xyz/address/${address}): Contract (unverified; checked Sourcify + Tempo verifier API)`,
    ].join('\n\n');

    const html = renderToStaticMarkup(
      createElement(ContractVerificationList, {
        details,
        info: [
          `[${address}](https://explore.tempo.xyz/address/${address}): Contract (unverified; checked Sourcify + Tempo verifier API)`,
        ],
        blockExplorerBaseUrl: 'https://explore.tempo.xyz',
      }),
    );

    expect(html).toContain('Total:</span><span class="font-semibold">1</span>');
    expect(html).not.toContain('Total:</span><span class="font-semibold">2</span>');
    expect(html).toContain(`href="https://explore.tempo.xyz/address/${address}"`);
  });

  it('lowercases Tempo fallback explorer links when a row has no explicit href', () => {
    const address = '0x24A3D4757E330890A8b8978028c9e58E04611fD6';
    const details = `${address}: Contract (verified via verification backend API)`;

    const html = renderToStaticMarkup(
      createElement(ContractVerificationList, {
        details,
        blockExplorerBaseUrl: 'https://explore.tempo.xyz/',
      }),
    );

    expect(html).toContain(
      'href="https://explore.tempo.xyz/address/0x24a3d4757e330890a8b8978028c9e58e04611fd6"',
    );
  });
});
