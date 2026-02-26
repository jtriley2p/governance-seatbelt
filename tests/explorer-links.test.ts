import { describe, expect, test } from 'bun:test';

function seedRpcEnv(): void {
  process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
  process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
  process.env.ETHERSCAN_API_KEY ??= 'test-key';
  process.env.TENDERLY_ACCESS_TOKEN ??= 'test-token';
  process.env.TENDERLY_USER ??= 'test-user';
  process.env.TENDERLY_PROJECT_SLUG ??= 'test-project';
}

describe('canonical explorer link helpers', () => {
  test('builds normalized address links and report helper reuses canonical output', async () => {
    seedRpcEnv();

    const { toExplorerAddressMarkdownLink } = await import('../utils/explorer-links');
    const { toAddressLink } = await import('../presentation/report');

    const address = '0x1234567890abcdef1234567890abcdef12345678';
    const baseUrl = 'https://basescan.org/';

    const canonical = toExplorerAddressMarkdownLink(address, baseUrl);
    const fromReport = toAddressLink(address, baseUrl);

    expect(canonical).toBe(`[${address}](https://basescan.org/address/${address})`);
    expect(fromReport).toBe(canonical);
  });

  test('normalizes base URLs and defaults to etherscan when missing', async () => {
    const { normalizeBlockExplorerBaseUrl, toExplorerAddressMarkdownLink } = await import(
      '../utils/explorer-links'
    );

    const address = '0x1234567890abcdef1234567890abcdef12345678';

    expect(normalizeBlockExplorerBaseUrl('https://arbiscan.io/')).toBe('https://arbiscan.io');
    expect(normalizeBlockExplorerBaseUrl(undefined)).toBe('https://etherscan.io');
    expect(toExplorerAddressMarkdownLink(address)).toBe(
      `[${address}](https://etherscan.io/address/${address})`,
    );
  });
});
