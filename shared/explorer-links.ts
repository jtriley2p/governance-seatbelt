export const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://etherscan.io';

export function normalizeBlockExplorerBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? '').trim();
  if (!normalized) {
    return DEFAULT_BLOCK_EXPLORER_BASE_URL;
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function shouldLowercaseAddressForExplorer(baseUrl?: string): boolean {
  return normalizeBlockExplorerBaseUrl(baseUrl) === 'https://explore.tempo.xyz';
}

export function toBlockExplorerAddressUrl(address: string, baseUrl?: string): string {
  const normalizedBaseUrl = normalizeBlockExplorerBaseUrl(baseUrl);
  const normalizedAddress = shouldLowercaseAddressForExplorer(normalizedBaseUrl)
    ? address.toLowerCase()
    : address;
  return `${normalizedBaseUrl}/address/${normalizedAddress}`;
}

export function toBlockExplorerBlockUrl(
  blockNumber: bigint | number | string,
  baseUrl?: string,
): string {
  return `${normalizeBlockExplorerBaseUrl(baseUrl)}/block/${blockNumber}`;
}
