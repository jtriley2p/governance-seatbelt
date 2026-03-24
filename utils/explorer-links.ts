export const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://etherscan.io';
const SOURCIFY_REPO_CONTRACTS_BASE_URL = 'https://repo.sourcify.dev/contracts';

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

function normalizeAddressForExplorer(address: string, baseUrl?: string): string {
  return shouldLowercaseAddressForExplorer(baseUrl) ? address.toLowerCase() : address;
}

function normalizeSourcifyMatchPath(match?: string): 'full_match' | 'partial_match' {
  if (match === 'match') {
    return 'partial_match';
  }

  return 'full_match';
}

export function toBlockExplorerAddressUrl(address: string, baseUrl?: string): string {
  return `${normalizeBlockExplorerBaseUrl(baseUrl)}/address/${normalizeAddressForExplorer(address, baseUrl)}`;
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
