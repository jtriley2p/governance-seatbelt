import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PermissionsDiffItem } from '../hooks/use-simulation-results';
import { PermissionsDiff } from './PermissionsDiff';

describe('PermissionsDiff', () => {
  it('uses chain explorer links for permission cards on L2 metadata', () => {
    const contractAddress = '0x1111111111111111111111111111111111111111';
    const account = '0x2222222222222222222222222222222222222222';
    const sender = '0x3333333333333333333333333333333333333333';

    const items: PermissionsDiffItem[] = [
      {
        kind: 'role_granted',
        contractAddress,
        contractName: 'L2 Token at `0x1111111111111111111111111111111111111111`',
        role: {
          id: '0x0000000000000000000000000000000000000000000000000000000000000000',
          name: 'DEFAULT_ADMIN_ROLE',
        },
        account,
        sender,
      },
    ];

    const html = renderToStaticMarkup(
      <PermissionsDiff items={items} blockExplorerBaseUrl="https://soneium.blockscout.com" />,
    );

    expect(html).toContain(`href="https://soneium.blockscout.com/address/${contractAddress}"`);
    expect(html).toContain(`href="https://soneium.blockscout.com/address/${account}"`);
    expect(html).toContain(`href="https://soneium.blockscout.com/address/${sender}"`);
    expect(html).not.toContain('https://etherscan.io/address/');
  });
});
