/**
 * FOR TESTING ONLY.
 *
 * This sim is only meant to mimic proposal 95 against a matching test-only
 * predecessor baseline. It keeps the bridge/message structure the same, but
 * swaps mutable production targets for fresh fake addresses so replaying the
 * flow does not collide with live state.
 *
 * Do not use this as a real proposal config.
 */
import { encodeFunctionData, getAddress, parseAbi } from 'viem';

import type { SimulationConfigNew } from '../types';
import { build94To95TestOnlyCeloState } from '../tests/fixtures/test-only-94-95-flow';

const FORWARD_ABI = parseAbi(['function forward(address target, bytes data)']);
const SET_OWNER_ABI = parseAbi(['function setOwner(address _owner)']);
const EMPTY_SIG = '';
const XDM_GAS_LIMIT = 200_000;
const DEPOSIT_GAS_LIMIT = 200_000n;

const SONEIUM_PORTAL = getAddress('0x88e529A6ccd302c948689Cd5156C83D4614FAE92');
const XLAYER_PORTAL = getAddress('0x64057ad1DdAc804d0D26A7275b193D9DACa19993');
const CELO_L1_MESSENGER = getAddress('0x1AC1181fc4e4F877963680587AEAa2C90D7EbB95');
const CELO_CROSS_CHAIN_ACCOUNT = getAddress('0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7');
const WORLDCHAIN_L1_MESSENGER = getAddress('0xf931a81D18B1766d15695ffc7c1920a62b7e710a');
const WORLDCHAIN_CROSS_CHAIN_ACCOUNT = getAddress('0xcb2436774C3e191c85056d248EF4260ce5f27A9D');
const ZORA_L1_MESSENGER = getAddress('0xdC40a14d9abd6F410226f1E6de71aE03441ca506');
const ZORA_CROSS_CHAIN_ACCOUNT = getAddress('0x36eEC182D0B24Df3DC23115D64DB521A93D5154f');

const SONEIUM_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009510');
const SONEIUM_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009511');
const SONEIUM_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009512');
const SONEIUM_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009513');
const XLAYER_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009520');
const XLAYER_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009521');
const XLAYER_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009522');
const XLAYER_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009523');
const CELO_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009451');
const CELO_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009450');
const CELO_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009532');
const CELO_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009533');
const WORLDCHAIN_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009540');
const WORLDCHAIN_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009541');
const WORLDCHAIN_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009542');
const WORLDCHAIN_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009543');
const ZORA_V2_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009550');
const ZORA_V3_FACTORY_TEST = getAddress('0x1000000000000000000000000000000000009551');
const ZORA_FEE_ADAPTER_TEST = getAddress('0x1000000000000000000000000000000000009552');
const ZORA_TOKEN_JAR_TEST = getAddress('0x1000000000000000000000000000000000009553');

const SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
]);
const OPTIMISM_PORTAL_ABI = parseAbi([
  'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data)',
]);
const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)']);

const calls = [
  {
    target: SONEIUM_PORTAL,
    calldata: encodeFunctionData({
      abi: OPTIMISM_PORTAL_ABI,
      functionName: 'depositTransaction',
      args: [
        SONEIUM_V3_FACTORY_TEST,
        0n,
        DEPOSIT_GAS_LIMIT,
        false,
        encodeFunctionData({
          abi: SET_OWNER_ABI,
          functionName: 'setOwner',
          args: [SONEIUM_FEE_ADAPTER_TEST],
        }),
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: SONEIUM_PORTAL,
    calldata: encodeFunctionData({
      abi: OPTIMISM_PORTAL_ABI,
      functionName: 'depositTransaction',
      args: [
        SONEIUM_V2_FACTORY_TEST,
        0n,
        DEPOSIT_GAS_LIMIT,
        false,
        encodeFunctionData({
          abi: V2_FACTORY_ABI,
          functionName: 'setFeeTo',
          args: [SONEIUM_TOKEN_JAR_TEST],
        }),
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: XLAYER_PORTAL,
    calldata: encodeFunctionData({
      abi: OPTIMISM_PORTAL_ABI,
      functionName: 'depositTransaction',
      args: [
        XLAYER_V3_FACTORY_TEST,
        0n,
        DEPOSIT_GAS_LIMIT,
        false,
        encodeFunctionData({
          abi: SET_OWNER_ABI,
          functionName: 'setOwner',
          args: [XLAYER_FEE_ADAPTER_TEST],
        }),
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: XLAYER_PORTAL,
    calldata: encodeFunctionData({
      abi: OPTIMISM_PORTAL_ABI,
      functionName: 'depositTransaction',
      args: [
        XLAYER_V2_FACTORY_TEST,
        0n,
        DEPOSIT_GAS_LIMIT,
        false,
        encodeFunctionData({
          abi: V2_FACTORY_ABI,
          functionName: 'setFeeTo',
          args: [XLAYER_TOKEN_JAR_TEST],
        }),
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: CELO_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        CELO_CROSS_CHAIN_ACCOUNT,
        encodeFunctionData({
          abi: FORWARD_ABI,
          functionName: 'forward',
          args: [
            CELO_V3_FACTORY_TEST,
            encodeFunctionData({
              abi: SET_OWNER_ABI,
              functionName: 'setOwner',
              args: [CELO_FEE_ADAPTER_TEST],
            }),
          ],
        }),
        XDM_GAS_LIMIT,
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: CELO_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        CELO_CROSS_CHAIN_ACCOUNT,
        encodeFunctionData({
          abi: FORWARD_ABI,
          functionName: 'forward',
          args: [
            CELO_V2_FACTORY_TEST,
            encodeFunctionData({
              abi: V2_FACTORY_ABI,
              functionName: 'setFeeTo',
              args: [CELO_TOKEN_JAR_TEST],
            }),
          ],
        }),
        XDM_GAS_LIMIT,
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: WORLDCHAIN_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        WORLDCHAIN_CROSS_CHAIN_ACCOUNT,
        encodeFunctionData({
          abi: FORWARD_ABI,
          functionName: 'forward',
          args: [
            WORLDCHAIN_V3_FACTORY_TEST,
            encodeFunctionData({
              abi: SET_OWNER_ABI,
              functionName: 'setOwner',
              args: [WORLDCHAIN_FEE_ADAPTER_TEST],
            }),
          ],
        }),
        XDM_GAS_LIMIT,
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: WORLDCHAIN_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        WORLDCHAIN_CROSS_CHAIN_ACCOUNT,
        encodeFunctionData({
          abi: FORWARD_ABI,
          functionName: 'forward',
          args: [
            WORLDCHAIN_V2_FACTORY_TEST,
            encodeFunctionData({
              abi: V2_FACTORY_ABI,
              functionName: 'setFeeTo',
              args: [WORLDCHAIN_TOKEN_JAR_TEST],
            }),
          ],
        }),
        XDM_GAS_LIMIT,
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: ZORA_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        ZORA_CROSS_CHAIN_ACCOUNT,
        encodeFunctionData({
          abi: FORWARD_ABI,
          functionName: 'forward',
          args: [
            ZORA_V3_FACTORY_TEST,
            encodeFunctionData({
              abi: SET_OWNER_ABI,
              functionName: 'setOwner',
              args: [ZORA_FEE_ADAPTER_TEST],
            }),
          ],
        }),
        XDM_GAS_LIMIT,
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
  },
  {
    target: ZORA_L1_MESSENGER,
    calldata: encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        ZORA_CROSS_CHAIN_ACCOUNT,
        encodeFunctionData({
          abi: FORWARD_ABI,
          functionName: 'forward',
          args: [
            ZORA_V2_FACTORY_TEST,
            encodeFunctionData({
              abi: V2_FACTORY_ABI,
              functionName: 'setFeeTo',
              args: [ZORA_TOKEN_JAR_TEST],
            }),
          ],
        }),
        XDM_GAS_LIMIT,
      ],
    }),
    value: 0n,
    signature: EMPTY_SIG,
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
  stateObjectsByChain: build94To95TestOnlyCeloState([CELO_V3_FACTORY_TEST, CELO_V2_FACTORY_TEST]),
  description: `# Protocol Fee Expansion: Vote 2 (For Testing Only)

This test-only harness mirrors the proposal 95 flow with fresh fake target addresses. The fake Celo contracts are seeded so plain 95-test should fail ownership checks, while 95-test derived from 94-test should inherit the 94 ownership handoff and succeed.`,
};
