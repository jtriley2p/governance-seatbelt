const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  130: 'Unichain',
  196: 'X Layer',
  480: 'World Chain',
  1301: 'Unichain Sepolia',
  1868: 'Soneium',
  8453: 'Base',
  42161: 'Arbitrum',
  42220: 'Celo',
  57073: 'Ink',
  60808: 'BOB',
  7777777: 'Zora',
};

const GENERIC_CHAIN_NAME = /^Chain\s+\d+$/i;

export function resolveChainName(chainId: number, providedName?: string): string {
  const knownName = CHAIN_NAMES[chainId];
  if (knownName) return knownName;

  const cleanedProvidedName = providedName?.trim();
  if (cleanedProvidedName && !GENERIC_CHAIN_NAME.test(cleanedProvidedName)) {
    return cleanedProvidedName;
  }

  return `Chain ${chainId}`;
}
