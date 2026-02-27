export const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://etherscan.io';
const SOURCIFY_REPO_CONTRACTS_BASE_URL = 'https://repo.sourcify.dev/contracts';

export function normalizeBlockExplorerBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? '').trim();
  if (!normalized) {
    return DEFAULT_BLOCK_EXPLORER_BASE_URL;
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function normalizeSourcifyMatchPath(match?: string): 'full_match' | 'partial_match' {
  if (match === 'match') {
    return 'partial_match';
  }

  return 'full_match';
}

export function toBlockExplorerAddressUrl(address: string, baseUrl?: string): string {
  return `${normalizeBlockExplorerBaseUrl(baseUrl)}/address/${address}`;
}

export function toSourcifyAddressUrl(address: string, chainId: number, match?: string): string {
  const matchPath = normalizeSourcifyMatchPath(match);
  return `${SOURCIFY_REPO_CONTRACTS_BASE_URL}/${matchPath}/${chainId}/${address}/`;
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

export function toSourcifyAddressMarkdownLink(
  address: string,
  chainId: number,
  match?: string,
): string {
  return `[${address}](${toSourcifyAddressUrl(address, chainId, match)})`;
}
