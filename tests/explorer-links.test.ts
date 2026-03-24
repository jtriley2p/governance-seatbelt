import { describe, expect, it } from 'bun:test';
import { toBlockExplorerAddressUrl } from '../utils/explorer-links';

describe('toBlockExplorerAddressUrl', () => {
  it('preserves checksum casing for standard explorers', () => {
    const address = '0x24A3D4757E330890A8b8978028c9e58e04611fD6';

    expect(toBlockExplorerAddressUrl(address, 'https://etherscan.io')).toBe(
      `https://etherscan.io/address/${address}`,
    );
  });

  it('lowercases Tempo explorer addresses', () => {
    const address = '0x24A3D4757E330890A8b8978028c9e58e04611fD6';

    expect(toBlockExplorerAddressUrl(address, 'https://explore.tempo.xyz')).toBe(
      'https://explore.tempo.xyz/address/0x24a3d4757e330890a8b8978028c9e58e04611fd6',
    );
  });
});
