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

type ChainCapability = {
  chainName: string;
  supportsL2Checks: boolean;
  supportsTenderlyDestinationSimulation: boolean;
  isOpStackDestination: boolean;
};

const CHAIN_CAPABILITIES: Record<number, ChainCapability> = {
  [mainnet.id]: {
    chainName: mainnet.name,
    supportsL2Checks: false,
    supportsTenderlyDestinationSimulation: false,
    isOpStackDestination: false,
  },
  [optimism.id]: {
    chainName: optimism.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [base.id]: {
    chainName: base.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [arbitrum.id]: {
    chainName: arbitrum.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [unichain.id]: {
    chainName: unichain.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [ink.id]: {
    chainName: ink.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [soneium.id]: {
    chainName: soneium.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [bob.id]: {
    chainName: bob.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [celo.id]: {
    chainName: celo.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [worldchain.id]: {
    chainName: worldchain.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [xLayer.id]: {
    chainName: xLayer.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [zora.id]: {
    chainName: zora.name,
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: false,
    isOpStackDestination: true,
  },
};

const OP_STACK_DESTINATION_CHAIN_ORDER = [
  optimism.id,
  base.id,
  unichain.id,
  xLayer.id,
  worldchain.id,
  celo.id,
  ink.id,
  soneium.id,
  bob.id,
  zora.id,
];

export function getChainName(chainId: number): string {
  return CHAIN_CAPABILITIES[chainId]?.chainName ?? `Chain ${chainId}`;
}

export function supportsL2Checks(chainId: number): boolean {
  return CHAIN_CAPABILITIES[chainId]?.supportsL2Checks ?? false;
}

export function supportsTenderlyDestinationSimulation(chainId: number): boolean {
  return CHAIN_CAPABILITIES[chainId]?.supportsTenderlyDestinationSimulation ?? false;
}

export function getOpStackDestinationChainIds(): number[] {
  return OP_STACK_DESTINATION_CHAIN_ORDER.filter(
    (chainId) => CHAIN_CAPABILITIES[chainId]?.isOpStackDestination,
  );
}
