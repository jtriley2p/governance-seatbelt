import { encodeFunctionData, getAddress, parseAbi } from 'viem';
import type { SimulationConfigNew } from '../types';
import { WORMHOLE_SEND_MESSAGE_ABI } from '../utils/bridges/wormhole';

const GOVERNOR_ADDRESS = getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3');
const WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');
const WORMHOLE_BRIDGE = getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B');
const TEMPO_WORMHOLE_CHAIN_ID = 68;

const TEMPO_V2_FACTORY = getAddress('0xf9EC577a4E45B5278BB7Cf60FCBc20c3acAef68f');
const TEMPO_V3_FACTORY = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
const TEMPO_V4_POOL_MANAGER = getAddress('0x33620f62C5b9B2086dD6b62F4A297A9f30347029');

const V2_FACTORY_ABI = parseAbi(['function feeToSetter() view returns (address)']);
const OWNABLE_ABI = parseAbi(['function owner() view returns (address)']);

const wormholeCall = {
  target: WORMHOLE_SENDER,
  calldata: encodeFunctionData({
    abi: WORMHOLE_SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [
      [TEMPO_V2_FACTORY, TEMPO_V3_FACTORY, TEMPO_V4_POOL_MANAGER],
      [0n, 0n, 0n],
      [
        encodeFunctionData({
          abi: V2_FACTORY_ABI,
          functionName: 'feeToSetter',
        }),
        encodeFunctionData({
          abi: OWNABLE_ABI,
          functionName: 'owner',
        }),
        encodeFunctionData({
          abi: OWNABLE_ABI,
          functionName: 'owner',
        }),
      ],
      WORMHOLE_BRIDGE,
      TEMPO_WORMHOLE_CHAIN_ID,
    ],
  }),
  value: 0n,
  signature: '',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: GOVERNOR_ADDRESS,
  governorType: 'bravo',
  targets: [wormholeCall.target],
  values: [wormholeCall.value],
  signatures: [wormholeCall.signature as `0x${string}`],
  calldatas: [wormholeCall.calldata],
  description: `# Tempo real Uniswap verifier demo

This demo proposal sends a real Wormhole payload to Tempo so Seatbelt resolves verification on the actual destination chain.

## Tempo targets

1. Tempo V2 factory: \`${TEMPO_V2_FACTORY}\`
   - Calls \`feeToSetter()\`
   - Expected verifier result today: currently unverified on Tempo verifier

2. Tempo V3 factory: \`${TEMPO_V3_FACTORY}\`
   - Calls \`owner()\`
   - Expected verifier result today: verified as \`UniswapV3Factory\`

3. Tempo V4 pool manager: \`${TEMPO_V4_POOL_MANAGER}\`
   - Calls \`owner()\`
   - Expected verifier result today: verified as \`PoolManager\`

This is a real-address verification demo meant to show Tempo destination-chain contract verification in the report, not a realistic governance action.`,
};
