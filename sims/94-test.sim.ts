/**
 * FOR TESTING ONLY.
 *
 * This sim is only meant to mimic proposal 94 after the real proposal has
 * already executed on-chain. It keeps the bridge/message structure the same,
 * but swaps mutable production targets for fresh fake addresses so replaying
 * the flow does not collide with live state.
 *
 * Do not use this as a real proposal config.
 */
import { encodeFunctionData, getAddress, parseAbi, parseEther, parseGwei } from 'viem';

import { build94To95TestOnlyCeloState } from '../tests/fixtures/test-only-94-95-flow';
import type { SimulationConfigNew } from '../types';
import ArbitrumDelayedInboxAbi from '../utils/abis/ArbitrumDelayedInboxAbi.json' assert {
  type: 'json',
};
import L2CrossChainAccount from '../utils/abis/L2CrossChainAccount.json' assert { type: 'json' };
import v3FactoryAbi from '../utils/abis/v3FactoryAbi.json' assert { type: 'json' };

const XDM_GAS_LIMIT = 200_000;
const ARB_GAS_LIMIT = 200_000n;
const ARB_MAX_FEE_PER_GAS = parseGwei('0.1');
const ARB_MAX_SUBMISSION_COST = parseEther('0.01');
const ARB_VALUE = ARB_MAX_SUBMISSION_COST + ARB_GAS_LIMIT * ARB_MAX_FEE_PER_GAS;

const OP_L1_MESSENGER = getAddress('0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1');
const OP_CROSS_CHAIN_ACCOUNT = getAddress('0xa1dD330d602c32622AA270Ea73d078B803Cb3518');
const BASE_L1_MESSENGER = getAddress('0x866E82a600A1414e583f7F13623F1aC5d58b0Afa');
const BASE_CROSS_CHAIN_ACCOUNT = getAddress('0x31FAfd4889FA1269F7a13A66eE0fB458f27D72A9');
const ARB_INBOX = getAddress('0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f');
const ARB_ALIASED_TIMELOCK = getAddress('0x2BAD8182C09F50c8318d769245beA52C32Be46CD');
const WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');
const WORMHOLE_BRIDGE = getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B');
const WORMHOLE_CELO_CHAIN_ID = 14;
const CELO_CROSS_CHAIN_ACCOUNT = getAddress('0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7');

// Keep bridge entrypoints real, but replace mutable production targets/recipients
// with fresh fake addresses so this harness can be replayed safely.
const OP_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009410');
const OP_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009411');
const OP_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009412');
const OP_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009413');
const BASE_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009420');
const BASE_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009421');
const BASE_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009422');
const BASE_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009423');
const ARB_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009430');
const ARB_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009431');
const ARB_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009432');
const ARB_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009433');
const MAINNET_WETH = getAddress('0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2');
const CELO_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009450');
const CELO_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009451');
const CELO_V4_POOL_MANAGER_TEST = getAddress('0x1000000000000000000000000000000000009452');

const SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
]);
const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)', 'function setFeeToSetter(address)']);
const OWNED_ABI = parseAbi(['function transferOwnership(address newOwner)']);
const WETH_ABI = parseAbi(['function deposit()']);
const WORMHOLE_SENDER_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);

const opV3Forward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [
    OP_V3_FACTORY_TEST,
    encodeFunctionData({
      abi: v3FactoryAbi,
      functionName: 'setOwner',
      args: [OP_FEE_ADAPTER_TEST],
    }),
  ],
});

const baseV3Forward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [
    BASE_V3_FACTORY_TEST,
    encodeFunctionData({
      abi: v3FactoryAbi,
      functionName: 'setOwner',
      args: [BASE_FEE_ADAPTER_TEST],
    }),
  ],
});

const opV2Forward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [
    OP_V2_FACTORY_TEST,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [OP_TOKEN_JAR_TEST],
    }),
  ],
});

const baseV2Forward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [
    BASE_V2_FACTORY_TEST,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [BASE_TOKEN_JAR_TEST],
    }),
  ],
});

const celoTargets = [
  CELO_V3_FACTORY_TEST,
  CELO_V2_FACTORY_TEST,
  CELO_V4_POOL_MANAGER_TEST,
] as const;
const celoValues = [0n, 0n, 0n] as const;
const celoDatas = [
  encodeFunctionData({
    abi: v3FactoryAbi,
    functionName: 'setOwner',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
  encodeFunctionData({
    abi: V2_FACTORY_ABI,
    functionName: 'setFeeToSetter',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
  encodeFunctionData({
    abi: OWNED_ABI,
    functionName: 'transferOwnership',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
] as const;

const calls = [
  {
    target: OP_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [OP_CROSS_CHAIN_ACCOUNT, opV3Forward, XDM_GAS_LIMIT],
    }),
    value: 0n,
    signature: '',
  },
  {
    target: BASE_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [BASE_CROSS_CHAIN_ACCOUNT, baseV3Forward, XDM_GAS_LIMIT],
    }),
    value: 0n,
    signature: '',
  },
  {
    target: ARB_INBOX,
    calldata: encodeFunctionData({
      abi: ArbitrumDelayedInboxAbi,
      functionName: 'createRetryableTicket',
      args: [
        ARB_V3_FACTORY_TEST,
        0n,
        ARB_MAX_SUBMISSION_COST,
        ARB_ALIASED_TIMELOCK,
        ARB_ALIASED_TIMELOCK,
        ARB_GAS_LIMIT,
        ARB_MAX_FEE_PER_GAS,
        encodeFunctionData({
          abi: v3FactoryAbi,
          functionName: 'setOwner',
          args: [ARB_FEE_ADAPTER_TEST],
        }),
      ],
    }),
    value: ARB_VALUE,
    signature: '',
  },
  {
    target: MAINNET_WETH,
    calldata: encodeFunctionData({
      abi: WETH_ABI,
      functionName: 'deposit',
      args: [],
    }),
    value: 0n,
    signature: '',
  },
  {
    target: OP_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [OP_CROSS_CHAIN_ACCOUNT, opV2Forward, XDM_GAS_LIMIT],
    }),
    value: 0n,
    signature: '',
  },
  {
    target: BASE_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [BASE_CROSS_CHAIN_ACCOUNT, baseV2Forward, XDM_GAS_LIMIT],
    }),
    value: 0n,
    signature: '',
  },
  {
    target: ARB_INBOX,
    calldata: encodeFunctionData({
      abi: ArbitrumDelayedInboxAbi,
      functionName: 'createRetryableTicket',
      args: [
        ARB_V2_FACTORY_TEST,
        0n,
        ARB_MAX_SUBMISSION_COST,
        ARB_ALIASED_TIMELOCK,
        ARB_ALIASED_TIMELOCK,
        ARB_GAS_LIMIT,
        ARB_MAX_FEE_PER_GAS,
        encodeFunctionData({
          abi: V2_FACTORY_ABI,
          functionName: 'setFeeTo',
          args: [ARB_TOKEN_JAR_TEST],
        }),
      ],
    }),
    value: ARB_VALUE,
    signature: '',
  },
  {
    target: WORMHOLE_SENDER,
    calldata: encodeFunctionData({
      abi: WORMHOLE_SENDER_ABI,
      functionName: 'sendMessage',
      args: [
        [...celoTargets],
        [...celoValues],
        [...celoDatas],
        WORMHOLE_BRIDGE,
        WORMHOLE_CELO_CHAIN_ID,
      ],
    }),
    value: 0n,
    signature: '',
  },
];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
  governorType: 'bravo',
  targets: calls.map((call) => call.target),
  values: calls.map((call) => call.value),
  signatures: calls.map((call) => call.signature),
  calldatas: calls.map((call) => call.calldata),
  stateObjectsByChain: build94To95TestOnlyCeloState([
    CELO_V3_FACTORY_TEST,
    CELO_V2_FACTORY_TEST,
    CELO_V4_POOL_MANAGER_TEST,
  ]),
  description: `# Protocol Fee Expansion: Vote 1 (For Testing Only)

This test-only harness mirrors the proposal 94 flow with fresh fake target addresses. The fake Celo contracts are seeded with owner-gated bytecode so this sim can hand ownership from the Wormhole executor to the Celo CrossChainAccount for derivation testing.`,
};
