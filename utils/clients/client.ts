import { http, createPublicClient } from 'viem';
import type { PublicClient, Transport } from 'viem';
import {
  arbitrum,
  base,
  bob,
  celo,
  ink,
  mainnet,
  optimism,
  soneium,
  unichain,
  worldchain,
  xLayer,
  zora,
} from 'viem/chains';
import { DEFAULT_BLOCK_EXPLORER_BASE_URL, normalizeBlockExplorerBaseUrl } from '../explorer-links';

export enum BlockExplorerSource {
  Blockscout = 'blockscout',
  Etherscan = 'etherscan',
}

export enum VerificationBackend {
  EtherscanV2 = 'etherscan-v2',
  Blockscout = 'blockscout',
  SourcifyOnly = 'sourcify-only',
}

export interface ChainConfig {
  chainId: number;
  blockExplorer: {
    baseUrl: string;
    // Legacy fields retained for test fixture compatibility only.
    apiUrl?: string;
    source?: BlockExplorerSource;
    apiKey?: string;
  };
  verification?: {
    backend: VerificationBackend;
    apiUrl?: string;
    apiKey?: string;
    degradedReason?: string;
  };
  rpcUrl: string;
}

if (!process.env.MAINNET_RPC_URL || !process.env.ARBITRUM_RPC_URL) {
  throw new Error(
    'MAINNET_RPC_URL and ARBITRUM_RPC_URL must be set. Optional: OPTIMISM_RPC_URL, BASE_RPC_URL, or ALCHEMY_API_KEY',
  );
}

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const OPTIMISM_RPC_URL =
  process.env.OPTIMISM_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://mainnet.optimism.io');
const BASE_RPC_URL =
  process.env.BASE_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://mainnet.base.org');
const UNICHAIN_RPC_URL =
  process.env.UNICHAIN_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://unichain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://mainnet.unichain.org');
const INK_RPC_URL =
  process.env.INK_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://ink-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://rpc-gel.inkonchain.com');
const SONEIUM_RPC_URL = process.env.SONEIUM_RPC_URL || soneium.rpcUrls.default.http[0];
const BOB_RPC_URL = process.env.BOB_RPC_URL || 'https://bob.drpc.org';
const CELO_RPC_URL = process.env.CELO_RPC_URL || celo.rpcUrls.default.http[0];
const WORLDCHAIN_RPC_URL = process.env.WORLDCHAIN_RPC_URL || worldchain.rpcUrls.default.http[0];
const ZORA_RPC_URL = process.env.ZORA_RPC_URL || zora.rpcUrls.default.http[0];
const XLAYER_RPC_URL = process.env.XLAYER_RPC_URL || xLayer.rpcUrls.default.http[0];

const ETHERSCAN_V2_API_URL = 'https://api.etherscan.io/v2/api';

type ChainById = {
  [mainnet.id]: typeof mainnet;
  [arbitrum.id]: typeof arbitrum;
  [optimism.id]: typeof optimism;
  [base.id]: typeof base;
  [unichain.id]: typeof unichain;
  [ink.id]: typeof ink;
  [soneium.id]: typeof soneium;
  [bob.id]: typeof bob;
  [celo.id]: typeof celo;
  [worldchain.id]: typeof worldchain;
  [zora.id]: typeof zora;
  [xLayer.id]: typeof xLayer;
};

const CHAIN_BY_ID: ChainById = {
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [base.id]: base,
  [unichain.id]: unichain,
  [ink.id]: ink,
  [soneium.id]: soneium,
  [bob.id]: bob,
  [celo.id]: celo,
  [worldchain.id]: worldchain,
  [zora.id]: zora,
  [xLayer.id]: xLayer,
};

type SupportedChainId = keyof ChainById;
type ChainForId<I extends SupportedChainId> = ChainById[I];
type ClientRegistry = {
  [I in SupportedChainId]: PublicClient<Transport, ChainForId<I>>;
};

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [mainnet.id]: {
    chainId: mainnet.id,
    blockExplorer: {
      baseUrl: mainnet.blockExplorers?.default.url || 'https://etherscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: process.env.MAINNET_RPC_URL,
  },
  [arbitrum.id]: {
    chainId: arbitrum.id,
    blockExplorer: {
      baseUrl: arbitrum.blockExplorers?.default.url || 'https://arbiscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: process.env.ARBITRUM_RPC_URL,
  },
  [optimism.id]: {
    chainId: optimism.id,
    blockExplorer: {
      baseUrl: optimism.blockExplorers?.default.url || 'https://optimistic.etherscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: OPTIMISM_RPC_URL,
  },
  [base.id]: {
    chainId: base.id,
    blockExplorer: {
      baseUrl: base.blockExplorers?.default.url || 'https://basescan.org',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: BASE_RPC_URL,
  },
  [unichain.id]: {
    chainId: unichain.id,
    blockExplorer: {
      baseUrl: unichain.blockExplorers?.default.url || 'https://uniscan.xyz',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: UNICHAIN_RPC_URL,
  },
  [ink.id]: {
    chainId: ink.id,
    blockExplorer: {
      baseUrl: ink.blockExplorers?.default.url,
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: ink.blockExplorers?.default.apiUrl,
    },
    rpcUrl: INK_RPC_URL,
  },
  [soneium.id]: {
    chainId: soneium.id,
    blockExplorer: {
      baseUrl: soneium.blockExplorers?.default.url,
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: 'https://soneium.blockscout.com/api/v2',
    },
    rpcUrl: SONEIUM_RPC_URL,
  },
  [bob.id]: {
    chainId: bob.id,
    blockExplorer: {
      baseUrl: bob.blockExplorers?.default.url,
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: 'https://explorer.gobob.xyz/api/v2',
    },
    rpcUrl: BOB_RPC_URL,
  },
  [celo.id]: {
    chainId: celo.id,
    blockExplorer: {
      baseUrl: celo.blockExplorers?.default.url || 'https://celoscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: CELO_RPC_URL,
  },
  [worldchain.id]: {
    chainId: worldchain.id,
    blockExplorer: {
      baseUrl: worldchain.blockExplorers?.default.url || 'https://worldscan.org',
    },
    verification: {
      backend: VerificationBackend.SourcifyOnly,
      degradedReason:
        'Worldchain verification backend API is not supported yet; using Sourcify only.',
    },
    rpcUrl: WORLDCHAIN_RPC_URL,
  },
  [zora.id]: {
    chainId: zora.id,
    blockExplorer: {
      baseUrl: zora.blockExplorers?.default.url || 'https://explorer.zora.energy',
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: 'https://explorer.zora.energy/api/v2',
    },
    rpcUrl: ZORA_RPC_URL,
  },
  [xLayer.id]: {
    chainId: xLayer.id,
    blockExplorer: {
      baseUrl: xLayer.blockExplorers?.default.url || 'https://www.oklink.com/xlayer',
    },
    verification: {
      backend: VerificationBackend.SourcifyOnly,
      degradedReason: 'XLayer verification backend API is not supported yet; using Sourcify only.',
    },
    rpcUrl: XLAYER_RPC_URL,
  },
};

export function getChainConfig(chainId: number): ChainConfig {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`No configuration found for chain ID ${chainId}`);
  }
  return config;
}

export function formatVerificationBackend(backend: VerificationBackend): string {
  if (backend === VerificationBackend.EtherscanV2) return 'Etherscan v2 API';
  if (backend === VerificationBackend.Blockscout) return 'Blockscout API';
  return 'Sourcify-only (no verification API backend)';
}

export function getBlockExplorerBaseUrlForChain(chainId: number): string {
  try {
    return normalizeBlockExplorerBaseUrl(getChainConfig(chainId).blockExplorer.baseUrl);
  } catch {
    return DEFAULT_BLOCK_EXPLORER_BASE_URL;
  }
}

export interface ResolvedVerificationConfig {
  backend: VerificationBackend;
  apiUrl?: string;
  apiKey?: string;
  degradedReason?: string;
}

export function resolveVerificationConfig(config: ChainConfig): ResolvedVerificationConfig {
  if (config.verification) {
    return config.verification;
  }

  if (config.blockExplorer.source === BlockExplorerSource.Blockscout) {
    return {
      backend: VerificationBackend.Blockscout,
      apiUrl: config.blockExplorer.apiUrl,
      degradedReason: undefined,
    };
  }

  return {
    backend: VerificationBackend.EtherscanV2,
    apiKey: config.blockExplorer.apiKey,
    degradedReason: undefined,
  };
}

const clients = {
  [mainnet.id]: createPublicClient({
    chain: mainnet,
    transport: http(CHAIN_CONFIGS[mainnet.id].rpcUrl),
  }),
  [arbitrum.id]: createPublicClient({
    chain: arbitrum,
    transport: http(CHAIN_CONFIGS[arbitrum.id].rpcUrl),
  }),
  [optimism.id]: createPublicClient({
    chain: optimism,
    transport: http(CHAIN_CONFIGS[optimism.id].rpcUrl),
  }),
  [base.id]: createPublicClient({
    chain: base,
    transport: http(CHAIN_CONFIGS[base.id].rpcUrl),
  }),
  [unichain.id]: createPublicClient({
    chain: unichain,
    transport: http(CHAIN_CONFIGS[unichain.id].rpcUrl),
  }),
  [ink.id]: createPublicClient({
    chain: ink,
    transport: http(CHAIN_CONFIGS[ink.id].rpcUrl),
  }),
  [soneium.id]: createPublicClient({
    chain: soneium,
    transport: http(CHAIN_CONFIGS[soneium.id].rpcUrl),
  }),
  [bob.id]: createPublicClient({
    chain: bob,
    transport: http(CHAIN_CONFIGS[bob.id].rpcUrl),
  }),
  [celo.id]: createPublicClient({
    chain: celo,
    transport: http(CHAIN_CONFIGS[celo.id].rpcUrl),
  }),
  [worldchain.id]: createPublicClient({
    chain: worldchain,
    transport: http(CHAIN_CONFIGS[worldchain.id].rpcUrl),
  }),
  [zora.id]: createPublicClient({
    chain: zora,
    transport: http(CHAIN_CONFIGS[zora.id].rpcUrl),
  }),
  [xLayer.id]: createPublicClient({
    chain: xLayer,
    transport: http(CHAIN_CONFIGS[xLayer.id].rpcUrl),
  }),
} satisfies ClientRegistry;

function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return Object.prototype.hasOwnProperty.call(CHAIN_BY_ID, chainId);
}

export function getClientForChain<I extends SupportedChainId>(chainId: I): ClientRegistry[I];
export function getClientForChain(chainId: number): ClientRegistry[SupportedChainId];
export function getClientForChain(chainId: number) {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`No client found for chain ID ${chainId}`);
  }

  return clients[chainId];
}

export const publicClient = clients[mainnet.id];
