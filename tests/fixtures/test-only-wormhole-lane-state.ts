import { getAddress, pad, toHex } from 'viem';
import type { Address } from 'viem';
import { avalanche, bsc, celo, monad, polygon } from 'viem/chains';
import type { SimulationConfigNew } from '../../types';

export const TEST_ONLY_CELO_PRE_94_OWNER = getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071');

export const TEST_ONLY_WORMHOLE_LANES = {
  bnb: {
    chainId: bsc.id,
    wormholeChainId: 4,
    l2FromAddress: getAddress('0x341c1511141022cf8eE20824Ae0fFA3491F1302b'),
    name: 'BNB Smart Chain',
  },
  polygon: {
    chainId: polygon.id,
    wormholeChainId: 5,
    l2FromAddress: getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374'),
    name: 'Polygon',
  },
  avalanche: {
    chainId: avalanche.id,
    wormholeChainId: 6,
    l2FromAddress: getAddress('0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc'),
    name: 'Avalanche',
  },
  celo: {
    chainId: celo.id,
    wormholeChainId: 14,
    l2FromAddress: TEST_ONLY_CELO_PRE_94_OWNER,
    name: 'Celo',
  },
  monad: {
    chainId: monad.id,
    wormholeChainId: 48,
    l2FromAddress: getAddress('0xe783de89a7f0408687f051e3e6d0beb62719ebad'),
    name: 'Monad',
  },
} as const;

export type TestOnlyWormholeLaneKey = keyof typeof TEST_ONLY_WORMHOLE_LANES;

// Runtime bytecode for a tiny owner-gated test-only fixture contract. We keep it
// inline because Tenderly state seeding needs raw runtime code and these
// representative lane sims should not depend on an extra compile step.
export const TEST_ONLY_OWNED_TARGET_RUNTIME_BYTECODE =
  '0x608060405234801561000f575f5ffd5b5060043610610060575f3560e01c8063017e7e581461006457806313af4035146100935780638da5cb5b146100a8578063a2e74af614610093578063f2fde38b14610093578063f46901ed146100ba575b5f5ffd5b600154610077906001600160a01b031681565b6040516001600160a01b03909116815260200160405180910390f35b6100a66100a1366004610162565b6100cd565b005b5f54610077906001600160a01b031681565b6100a66100c8366004610162565b610117565b5f546001600160a01b031633146100f6576040516282b42960e81b815260040160405180910390fd5b5f80546001600160a01b0319166001600160a01b0392909216919091179055565b5f546001600160a01b03163314610140576040516282b42960e81b815260040160405180910390fd5b600180546001600160a01b0319166001600160a01b0392909216919091179055565b5f60208284031215610172575f5ffd5b81356001600160a01b0381168114610188575f5ffd5b939250505056fea264697066735822122023b46487b21aa1f7ef8ca5b6eb58918d1da4b9f825f74993f50e7c826ee6f6c964736f6c63430008210033' as const;

export const TEST_ONLY_CROSS_CHAIN_ACCOUNT_RUNTIME_BYTECODE =
  '0x608060405260043610610028575f3560e01c80636fadcf721461002c5780638da5cb5b14610041575b5f80fd5b61003f61003a366004610169565b61007b565b005b34801561004c575f80fd5b505f5461005f906001600160a01b031681565b6040516001600160a01b03909116815260200160405180910390f35b5f546001600160a01b031633146100c65760405162461bcd60e51b815260206004820152600a60248201526927a7262cafa7aba722a960b11b60448201526064015b60405180910390fd5b5f836001600160a01b03163484846040516100e29291906101f2565b5f6040518083038185875af1925050503d805f811461011c576040519150601f19603f3d011682016040523d82523d5f602084013e610121565b606091505b50509050806101635760405162461bcd60e51b815260206004820152600e60248201526d14d55090d0531317d1905253115160921b60448201526064016100bd565b50505050565b5f805f6040848603121561017b575f80fd5b83356001600160a01b0381168114610191575f80fd5b9250602084013567ffffffffffffffff808211156101ad575f80fd5b818601915086601f8301126101c0575f80fd5b8135818111156101ce575f80fd5b8760208285010111156101df575f80fd5b6020830194508093505050509250925092565b818382375f910190815291905056fea2646970667358221220af4d6ee3673cf533e637899ea89c0ee09dd06056326a6066ada0ffd2b4dae47564736f6c63430008150033' as const;

const OWNER_SLOT = toHex(0n, { size: 32 });
const FEE_TO_SLOT = toHex(1n, { size: 32 });

type SeededStateObjects = NonNullable<SimulationConfigNew['stateObjectsByChain']>;

export type TestOnlyLaneArtifacts = {
  crossChainAccount: Address;
  v2Factory: Address;
  v3Factory: Address;
  v4PoolManager: Address;
  feeAdapter: Address;
  tokenJar: Address;
};

export const TEST_ONLY_WORMHOLE_LANE_ARTIFACTS: Record<
  TestOnlyWormholeLaneKey,
  TestOnlyLaneArtifacts
> = {
  bnb: {
    crossChainAccount: getAddress('0x100000000000000000000000000000000000b110'),
    v2Factory: getAddress('0x100000000000000000000000000000000000b111'),
    v3Factory: getAddress('0x100000000000000000000000000000000000b112'),
    v4PoolManager: getAddress('0x100000000000000000000000000000000000b113'),
    feeAdapter: getAddress('0x100000000000000000000000000000000000b114'),
    tokenJar: getAddress('0x100000000000000000000000000000000000b115'),
  },
  polygon: {
    crossChainAccount: getAddress('0x100000000000000000000000000000000000b210'),
    v2Factory: getAddress('0x100000000000000000000000000000000000b211'),
    v3Factory: getAddress('0x100000000000000000000000000000000000b212'),
    v4PoolManager: getAddress('0x100000000000000000000000000000000000b213'),
    feeAdapter: getAddress('0x100000000000000000000000000000000000b214'),
    tokenJar: getAddress('0x100000000000000000000000000000000000b215'),
  },
  avalanche: {
    crossChainAccount: getAddress('0x100000000000000000000000000000000000b310'),
    v2Factory: getAddress('0x100000000000000000000000000000000000b311'),
    v3Factory: getAddress('0x100000000000000000000000000000000000b312'),
    v4PoolManager: getAddress('0x100000000000000000000000000000000000b313'),
    feeAdapter: getAddress('0x100000000000000000000000000000000000b314'),
    tokenJar: getAddress('0x100000000000000000000000000000000000b315'),
  },
  celo: {
    crossChainAccount: getAddress('0x100000000000000000000000000000000000b010'),
    v2Factory: getAddress('0x100000000000000000000000000000000000b011'),
    v3Factory: getAddress('0x100000000000000000000000000000000000b012'),
    v4PoolManager: getAddress('0x100000000000000000000000000000000000b013'),
    feeAdapter: getAddress('0x100000000000000000000000000000000000b014'),
    tokenJar: getAddress('0x100000000000000000000000000000000000b015'),
  },
  monad: {
    crossChainAccount: getAddress('0x100000000000000000000000000000000000b410'),
    v2Factory: getAddress('0x100000000000000000000000000000000000b411'),
    v3Factory: getAddress('0x100000000000000000000000000000000000b412'),
    v4PoolManager: getAddress('0x100000000000000000000000000000000000b413'),
    feeAdapter: getAddress('0x100000000000000000000000000000000000b414'),
    tokenJar: getAddress('0x100000000000000000000000000000000000b415'),
  },
};

export function buildTestOnlyOwnedTargetState(
  owner: Address,
): NonNullable<SeededStateObjects[number]>[string] {
  return {
    code: TEST_ONLY_OWNED_TARGET_RUNTIME_BYTECODE,
    storage: {
      [OWNER_SLOT]: pad(owner, { size: 32 }),
      [FEE_TO_SLOT]: pad('0x0000000000000000000000000000000000000000', { size: 32 }),
    },
  };
}

export function buildTestOnlyCrossChainAccountState(
  owner: Address,
): NonNullable<SeededStateObjects[number]>[string] {
  return {
    code: TEST_ONLY_CROSS_CHAIN_ACCOUNT_RUNTIME_BYTECODE,
    storage: {
      [OWNER_SLOT]: pad(owner, { size: 32 }),
    },
  };
}

export function buildTestOnlyWormholeLaneState(
  chainId: number,
  destinationAuthority: Address,
  targetContracts: readonly Address[],
  crossChainAccount?: Address,
): SeededStateObjects {
  const chainState = Object.fromEntries(
    targetContracts.map((target) => [
      getAddress(target),
      buildTestOnlyOwnedTargetState(destinationAuthority),
    ]),
  );

  if (crossChainAccount) {
    chainState[getAddress(crossChainAccount)] =
      buildTestOnlyCrossChainAccountState(destinationAuthority);
  }

  return {
    [chainId]: chainState,
  };
}
