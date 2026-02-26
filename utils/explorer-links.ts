export const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://etherscan.io';

export function normalizeBlockExplorerBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? '').trim();
  if (!normalized) {
    return DEFAULT_BLOCK_EXPLORER_BASE_URL;
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function toBlockExplorerAddressUrl(address: string, baseUrl?: string): string {
  return `${normalizeBlockExplorerBaseUrl(baseUrl)}/address/${address}`;
}

export function toBlockExplorerBlockUrl(
  blockNumber: bigint | number | string,
  baseUrl?: string,
): string {
  return `${normalizeBlockExplorerBaseUrl(baseUrl)}/block/${blockNumber}`;
}

export function toExplorerAddressMarkdownLink(address: string, baseUrl?: string): string {
  return `[${address}](${toBlockExplorerAddressUrl(address, baseUrl)})`;
}
