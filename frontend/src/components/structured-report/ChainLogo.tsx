// Chain logos stored in /public/chain-logos/
// Existing official assets:
// - Ethereum: https://github.com/0xa3k5/web3icons
// - Optimism: https://github.com/0xa3k5/web3icons
// - Base: https://github.com/base/brand-kit (The Square)
// - Arbitrum: https://github.com/0xa3k5/web3icons
// Additional official assets:
// - Celo: https://celo.org/brand-kit
// - X Layer: https://static.oklink.com
// - World: https://world.org/brand#world-logo
// - Soneium: https://soneium.org/en/brand-kit/
// - Zora: provided by team brand asset

export function ChainLogo({ chainId, size = 20 }: { chainId: number; size?: number }) {
  const logoFiles: Record<number, string> = {
    1: '/chain-logos/ethereum.svg',
    10: '/chain-logos/optimism.svg',
    196: '/chain-logos/xlayer.webp',
    1868: '/chain-logos/soneium.webp',
    42220: '/chain-logos/celo.png',
    480: '/chain-logos/worldchain.svg',
    7777777: '/chain-logos/zora.svg',
    8453: '/chain-logos/base.svg',
    42161: '/chain-logos/arbitrum.svg',
  };

  const logoPath = logoFiles[chainId];

  if (!logoPath) {
    return (
      <div
        className="rounded-full bg-muted flex items-center justify-center text-muted-foreground"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
        ⛓
      </div>
    );
  }

  return (
    <img
      src={logoPath}
      alt={`Chain ${chainId} logo`}
      width={size}
      height={size}
      className="shrink-0 object-contain"
    />
  );
}
