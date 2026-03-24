import {
  DEFAULT_BLOCK_EXPLORER_BASE_URL,
  normalizeBlockExplorerBaseUrl,
  toBlockExplorerAddressUrl,
  toBlockExplorerBlockUrl,
} from '../shared/explorer-links';

export {
  DEFAULT_BLOCK_EXPLORER_BASE_URL,
  normalizeBlockExplorerBaseUrl,
  toBlockExplorerAddressUrl,
  toBlockExplorerBlockUrl,
};

const SOURCIFY_REPO_CONTRACTS_BASE_URL = 'https://repo.sourcify.dev/contracts';

function normalizeSourcifyMatchPath(match?: string): 'full_match' | 'partial_match' {
  if (match === 'match') {
    return 'partial_match';
  }

  return 'full_match';
}

export function toSourcifyAddressUrl(address: string, chainId: number, match?: string): string {
  const matchPath = normalizeSourcifyMatchPath(match);
  return `${SOURCIFY_REPO_CONTRACTS_BASE_URL}/${matchPath}/${chainId}/${address}/`;
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
