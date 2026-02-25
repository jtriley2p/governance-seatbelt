const GENERIC_CHAIN_NAME = /^Chain\s+\d+$/i;

export function resolveChainName(chainId: number, providedName?: string): string {
  const cleanedProvidedName = providedName?.trim();
  if (cleanedProvidedName && !GENERIC_CHAIN_NAME.test(cleanedProvidedName)) {
    return cleanedProvidedName;
  }

  return `Chain ${chainId}`;
}
