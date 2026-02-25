/**
 * Simulation for ActivateL2sProposal: activate v2 and V3 protocol fees on Celo, Soneium,
 * Worldchain, XLayer, and Zora.
 */
import { encodeFunctionData, getAddress, parseAbi } from 'viem';

import type { SimulationConfigNew } from '../types';

// ─── ABI fragments ───
const FORWARD_ABI = parseAbi(['function forward(address target, bytes data)']);
const SET_OWNER_ABI = parseAbi(['function setOwner(address _owner)']);
const EMPTY_SIG = '' as `0x${string}`;

// ─── Gas limits (match Solidity script) ───
const XDM_GAS_LIMIT = 200_000;
const DEPOSIT_GAS_LIMIT = 200_000n;

// ─── Soneium (owner = aliased Timelock → depositTransaction) ───
const SONEIUM_PORTAL = getAddress('0x88e529A6ccd302c948689Cd5156C83D4614FAE92');
const SONEIUM_V2_FACTORY = getAddress('0x97FeBbC2AdBD5644ba22736E962564B23F5828CE');
const SONEIUM_V3_FACTORY = getAddress('0x42aE7Ec7ff020412639d443E245D936429Fbe717');
const SONEIUM_FEE_ADAPTER = getAddress('0x47Cf920815344Fd684A48BBEFcbfbed9C7AE09CF');
const SONEIUM_TOKEN_JAR = getAddress('0x85aeb792b94a9d79741002FC871423Ec5dAD29e9');

// ─── XLayer (owner = aliased Timelock → depositTransaction) ───
const XLAYER_PORTAL = getAddress('0x64057ad1DdAc804d0D26A7275b193D9DACa19993');
const XLAYER_V2_FACTORY = getAddress('0xDf38F24fE153761634Be942F9d859f3DBA857E95');
const XLAYER_V3_FACTORY = getAddress('0x4B2ab38DBF28D31D467aA8993f6c2585981D6804');
const XLAYER_FEE_ADAPTER = getAddress('0x6A88EF2e6511CAFfE2D006e260e7A5d1E7D4d7D7');
const XLAYER_TOKEN_JAR = getAddress('0x8Dd8B6D56e4a4A158EDbBfE7f2f703B8FFC1a754');

// ─── Celo (owner = CrossChainAccount after Wormhole handoff → XDM) ───
const CELO_L1_MESSENGER = getAddress('0x1AC1181fc4e4F877963680587AEAa2C90D7EbB95');
const CELO_CROSS_CHAIN_ACCOUNT = getAddress('0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7');
const CELO_V2_FACTORY = getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f'); // currently owned by wormhole, will be handed off
const CELO_V3_FACTORY = getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc');
const CELO_FEE_ADAPTER = getAddress('0xB9952C01830306ea2fAAe1505f6539BD260Bfc48');
const CELO_TOKEN_JAR = getAddress('0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B');

// ─── Worldchain (owner = CrossChainAccount → XDM) ───
const WORLDCHAIN_L1_MESSENGER = getAddress('0xf931a81D18B1766d15695ffc7c1920a62b7e710a');
const WORLDCHAIN_CROSS_CHAIN_ACCOUNT = getAddress('0xcb2436774C3e191c85056d248EF4260ce5f27A9D');
const WORLDCHAIN_V2_FACTORY = getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f');
const WORLDCHAIN_V3_FACTORY = getAddress('0x7a5028BDa40e7B173C278C5342087826455ea25a');
const WORLDCHAIN_FEE_ADAPTER = getAddress('0x1CE9d4DfB474Ef9ea7dc0e804a333202e40d6201');
const WORLDCHAIN_TOKEN_JAR = getAddress('0xbDb82c2dE7D8748A3e499e771604ef8ef8544918');

// ─── Zora (owner = CrossChainAccount → XDM) ───
const ZORA_L1_MESSENGER = getAddress('0xdC40a14d9abd6F410226f1E6de71aE03441ca506');
const ZORA_CROSS_CHAIN_ACCOUNT = getAddress('0x36eEC182D0B24Df3DC23115D64DB521A93D5154f');
const ZORA_V2_FACTORY = getAddress('0x0F797dC7efaEA995bB916f268D919d0a1950eE3C');
const ZORA_V3_FACTORY = getAddress('0x7145F8aeef1f6510E92164038E1B6F8cB2c42Cbb');
const ZORA_FEE_ADAPTER = getAddress('0xbfc49b47637a4DC9b7B8dE8E71BF41E519103B95');
const ZORA_TOKEN_JAR = getAddress('0x4753C137002D802f45302b118E265c41140e73C2');

const SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
]);
const OPTIMISM_PORTAL_ABI = parseAbi([
  'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data)',
]);
const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)']);

// Soneium — depositTransaction to transfer v3 factory to fee adapter
const call0 = {
  target: SONEIUM_PORTAL,
  calldata: encodeFunctionData({
    abi: OPTIMISM_PORTAL_ABI,
    functionName: 'depositTransaction',
    args: [
      SONEIUM_V3_FACTORY,
      0n,
      DEPOSIT_GAS_LIMIT,
      false,
      encodeFunctionData({
        abi: SET_OWNER_ABI,
        functionName: 'setOwner',
        args: [SONEIUM_FEE_ADAPTER],
      }),
    ],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// Soneium V2 factory — setFeeTo to TokenJar
const call1 = {
  target: SONEIUM_PORTAL,
  calldata: encodeFunctionData({
    abi: OPTIMISM_PORTAL_ABI,
    functionName: 'depositTransaction',
    args: [
      SONEIUM_V2_FACTORY,
      0n,
      DEPOSIT_GAS_LIMIT,
      false,
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeTo',
        args: [SONEIUM_TOKEN_JAR],
      }),
    ],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// XLayer — depositTransaction to transfer factory to fee adapter
const call2 = {
  target: XLAYER_PORTAL,
  calldata: encodeFunctionData({
    abi: OPTIMISM_PORTAL_ABI,
    functionName: 'depositTransaction',
    args: [
      XLAYER_V3_FACTORY,
      0n,
      DEPOSIT_GAS_LIMIT,
      false,
      encodeFunctionData({
        abi: SET_OWNER_ABI,
        functionName: 'setOwner',
        args: [XLAYER_FEE_ADAPTER],
      }),
    ],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// XLayer V2 factory — setFeeTo to TokenJar
const call3 = {
  target: XLAYER_PORTAL,
  calldata: encodeFunctionData({
    abi: OPTIMISM_PORTAL_ABI,
    functionName: 'depositTransaction',
    args: [
      XLAYER_V2_FACTORY,
      0n,
      DEPOSIT_GAS_LIMIT,
      false,
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeTo',
        args: [XLAYER_TOKEN_JAR],
      }),
    ],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// Celo — XDM to transfer V3 factory to fee adapter
const celoV3Forward = encodeFunctionData({
  abi: FORWARD_ABI,
  functionName: 'forward',
  args: [
    CELO_V3_FACTORY,
    encodeFunctionData({
      abi: SET_OWNER_ABI,
      functionName: 'setOwner',
      args: [CELO_FEE_ADAPTER],
    }),
  ],
});

const call4 = {
  target: CELO_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [CELO_CROSS_CHAIN_ACCOUNT, celoV3Forward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// Celo — set V2 factory feeTo to TokenJar
const celoV2FeeToForward = encodeFunctionData({
  abi: FORWARD_ABI,
  functionName: 'forward',
  args: [
    CELO_V2_FACTORY,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [CELO_TOKEN_JAR],
    }),
  ],
});

const call5 = {
  target: CELO_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [CELO_CROSS_CHAIN_ACCOUNT, celoV2FeeToForward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// Worldchain — XDM to transfer V3 factory to fee adapter
const worldchainV3Forward = encodeFunctionData({
  abi: FORWARD_ABI,
  functionName: 'forward',
  args: [
    WORLDCHAIN_V3_FACTORY,
    encodeFunctionData({
      abi: SET_OWNER_ABI,
      functionName: 'setOwner',
      args: [WORLDCHAIN_FEE_ADAPTER],
    }),
  ],
});

const call6 = {
  target: WORLDCHAIN_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [WORLDCHAIN_CROSS_CHAIN_ACCOUNT, worldchainV3Forward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// Worldchain — V2 factory setFeeTo to TokenJar
const worldchainV2FeeToForward = encodeFunctionData({
  abi: FORWARD_ABI,
  functionName: 'forward',
  args: [
    WORLDCHAIN_V2_FACTORY,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [WORLDCHAIN_TOKEN_JAR],
    }),
  ],
});
const call7 = {
  target: WORLDCHAIN_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [WORLDCHAIN_CROSS_CHAIN_ACCOUNT, worldchainV2FeeToForward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// Zora — XDM to transfer V3 factory to fee adapter
const zoraV3Forward = encodeFunctionData({
  abi: FORWARD_ABI,
  functionName: 'forward',
  args: [
    ZORA_V3_FACTORY,
    encodeFunctionData({
      abi: SET_OWNER_ABI,
      functionName: 'setOwner',
      args: [ZORA_FEE_ADAPTER],
    }),
  ],
});

const call8 = {
  target: ZORA_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [ZORA_CROSS_CHAIN_ACCOUNT, zoraV3Forward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

// Zora — V2 factory setFeeTo to TokenJar
const zoraV2FeeToForward = encodeFunctionData({
  abi: FORWARD_ABI,
  functionName: 'forward',
  args: [
    ZORA_V2_FACTORY,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [ZORA_TOKEN_JAR],
    }),
  ],
});
const call9 = {
  target: ZORA_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [ZORA_CROSS_CHAIN_ACCOUNT, zoraV2FeeToForward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: EMPTY_SIG,
};

const calls = [call0, call1, call2, call3, call4, call5, call6, call7, call8, call9];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
  governorType: 'bravo',
  targets: calls.map((c) => c.target),
  values: calls.map((c) => c.value),
  signatures: calls.map((c) => c.signature),
  calldatas: calls.map((c) => c.calldata),
  description: `# Protocol Fee Expansion: Vote 2

## Proposal Spec

If this proposal passes, it will execute ten transactions: 

\`\`\`
/// Enable fees on Soneium, XLayer, Celo, Woldchain, and Zora. For each chain:

/// Set the owner of the V3 Factory to the V3OpenFeeAdapter
V3_FACTORY.setOwner(address(v3OpenFeeAdapter));

/// Set the recipient of V2 protocol fees to the TokenJar
V2_FACTORY.setFeeTo(address(tokenJar));
\`\`\`

Because these transactions are crosschain, governance front ends may not decode them correctly. We recommend reviewing the [Seatbelt simulation report](https://github.com/uniswapfoundation/governance-seatbelt/actions) to confirm their validity. Three other things to note:

- Soneium and XLayer deployments are owned by DUNI's alias address on those chains. Celo, Worldchain, and Zora deployments are owned by CrossChainAccount contracts owned by DUNI. Standardizing ownership across chains will be addressed in a future governance proposal.
- On Celo, Uniswap v2 and v3 admin roles are being transferred from Wormhole to a DUNI-owned CrossChainAccount in proposal 94, which will execute prior to this proposal if passed. Because this proposal uses that CrossChainAccount, simulations currently fail.
- Tenderly, a dependency for these simulations, does not support Zora so those calls cannot be simulated.

### Relevant Addresses

**Soneium**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0x85aeb792b94a9d79741002FC871423Ec5dAD29e9\`](https://soneium.blockscout.com/address/0x85aeb792b94a9d79741002FC871423Ec5dAD29e9) |
| Releaser (OptimismBridgedResourceFirepit) | [\`0xc9CC50A75cE2a5f88fa77B43e3b050480c731b6e\`](https://soneium.blockscout.com/address/0xc9CC50A75cE2a5f88fa77B43e3b050480c731b6e) |
| V3OpenFeeAdapter | [\`0x47Cf920815344Fd684A48BBEFcbfbed9C7AE09CF\`](https://soneium.blockscout.com/address/0x47Cf920815344Fd684A48BBEFcbfbed9C7AE09CF) |
| UniswapV3Factory | [\`0x42aE7Ec7ff020412639d443E245D936429Fbe717\`](https://soneium.blockscout.com/address/0x42aE7Ec7ff020412639d443E245D936429Fbe717) |
| UniswapV2Factory | [\`0x97FeBbC2AdBD5644ba22736E962564B23F5828CE\`](https://soneium.blockscout.com/address/0x97FeBbC2AdBD5644ba22736E962564B23F5828CE) |
| Mainnet Bridge | [\`0x88e529A6ccd302c948689Cd5156C83D4614FAE92\`](https://etherscan.io/address/0x88e529A6ccd302c948689Cd5156C83D4614FAE92) |

**XLayer**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0x8Dd8B6D56e4a4A158EDbBfE7f2f703B8FFC1a754\`](https://www.oklink.com/x-layer/address/0x8dd8b6d56e4a4a158edbbfe7f2f703b8ffc1a754/contract) |
| Releaser (OptimismBridgedResourceFirepit) | [\`0xe122E231cb52aea99690963Fd73E91e33E97468f\`](https://www.oklink.com/xlayer/address/0xe122E231cb52aea99690963Fd73E91e33E97468f) |
| V3OpenFeeAdapter | [\`0x6A88EF2e6511CAFfE2D006e260e7A5d1E7D4d7D7\`](https://www.oklink.com/x-layer/address/0x6a88ef2e6511caffe2d006e260e7a5d1e7d4d7d7/contract) |
| UniswapV3Factory | [\`0x4B2ab38DBF28D31D467aA8993f6c2585981D6804\`](https://www.oklink.com/x-layer/address/0x4b2ab38dbf28d31d467aa8993f6c2585981d6804/contract) |
| UniswapV2Factory | [\`0xDf38F24fE153761634Be942F9d859f3DBA857E95\`](https://www.oklink.com/x-layer/address/0xdf38f24fe153761634be942f9d859f3dba857e95) |
| Mainnet Bridge | [\`0x64057ad1DdAc804d0D26A7275b193D9DACa19993\`](https://etherscan.io/address/0x64057ad1DdAc804d0D26A7275b193D9DACa19993#code) |

**Celo**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B\`](https://celoscan.io/address/0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B#code) |
| Releaser (OptimismBridgedResourceFirepit) | [\`0x2758FbaA228D7d3c41dD139F47dab1a27bF9bc25\`](https://celoscan.io/address/0x2758FbaA228D7d3c41dD139F47dab1a27bF9bc25) |
| V3OpenFeeAdapter | [\`0xB9952C01830306ea2fAAe1505f6539BD260Bfc48\`](https://celoscan.io/address/0xB9952C01830306ea2fAAe1505f6539BD260Bfc48) |
| UniswapV3Factory | [\`0xAfE208a311B21f13EF87E33A90049fC17A7acDEc\`](https://celoscan.io/address/0xafe208a311b21f13ef87e33a90049fc17a7acdec) |
| UniswapV2Factory | [\`0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f\`](https://celoscan.io/address/0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f#code) |
| Mainnet Bridge | [\`0x1AC1181fc4e4F877963680587AEAa2C90D7EbB95\`](https://etherscan.io/address/0x1AC1181fc4e4F877963680587AEAa2C90D7EbB95) |
| Celo CrossChainAccount | [\`0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7\`](https://celoscan.io/address/0x044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7) |

**Worldchain**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0xbDb82c2dE7D8748A3e499e771604ef8ef8544918\`](https://worldscan.org/address/0xbDb82c2dE7D8748A3e499e771604ef8ef8544918#code) |
| Releaser (OptimismBridgedResourceFirepit) | [\`0xbDb82c2dE7D8748A3e499e771604ef8ef8544918\`](https://worldscan.org/address/0xbDb82c2dE7D8748A3e499e771604ef8ef8544918) |
| V3OpenFeeAdapter | [\`0x1CE9d4DfB474Ef9ea7dc0e804a333202e40d6201\`](https://worldscan.org/address/0x1CE9d4DfB474Ef9ea7dc0e804a333202e40d6201#code) |
| UniswapV3Factory | [\`0x7a5028BDa40e7B173C278C5342087826455ea25a\`](https://worldscan.org/address/0x7a5028bda40e7b173c278c5342087826455ea25a#code) |
| UniswapV2Factory | [\`0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f\`](https://worldscan.org/address/0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f#code) |
| Mainnet Bridge | [\`0xf931a81D18B1766d15695ffc7c1920a62b7e710a\`](https://etherscan.io/address/0xf931a81D18B1766d15695ffc7c1920a62b7e710a) |
| CrossChainAccount | [\`0xcb2436774C3e191c85056d248EF4260ce5f27A9D\`](https://worldscan.org/address/0xcb2436774c3e191c85056d248ef4260ce5f27a9d) |

**Zora**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0x4753C137002D802f45302b118E265c41140e73C2\`](https://explorer.zora.energy/address/0x4753C137002D802f45302b118E265c41140e73C2) |
| Releaser (OptimismBridgedResourceFirepit) | [\`0x2f98eD4D04e633169FbC941BFCc54E785853b143\`](https://explorer.zora.energy/address/0x2f98eD4D04e633169FbC941BFCc54E785853b143) |
| V3OpenFeeAdapter | [\`0xbfc49b47637a4DC9b7B8dE8E71BF41E519103B95\`](https://explorer.zora.energy/address/0xbfc49b47637a4DC9b7B8dE8E71BF41E519103B95) |
| UniswapV3Factory | [\`0x7145F8aeef1f6510E92164038E1B6F8cB2c42Cbb\`](https://explorer.zora.energy/address/0x7145F8aeef1f6510E92164038E1B6F8cB2c42Cbb) |
| UniswapV2Factory | [\`0x0F797dC7efaEA995bB916f268D919d0a1950eE3C\`](https://explorer.zora.energy/address/0x0F797dC7efaEA995bB916f268D919d0a1950eE3C) |
| Mainnet Bridge | [\`0xdC40a14d9abd6F410226f1E6de71aE03441ca506\`](https://etherscan.io/address/0xdc40a14d9abd6f410226f1e6de71ae03441ca506) |
| CrossChainAccount | [\`0x36eEC182D0B24Df3DC23115D64DB521A93D5154f\`](https://explorer.zora.energy/address/0x36eEC182D0B24Df3DC23115D64DB521A93D5154f) |

## Proposal

*This is the first proposal to use the new governance process [approved](https://gov.uniswap.org/t/unification-proposal/25881#p-57882-protocol-fee-rollout-4) in UNIfication. The new process only applies to fee parameter updates, where proposals can bypass the RFC stage and go directly to a five-day Snapshot followed by an onchain vote. This allows for faster updates to protocol fees, while retaining the security of onchain governance.*

Snapshot vote [here](https://snapshot.box/#/s:uniswapgovernance.eth/proposal/0x0242a914c60945d25873d2a98c6abd9f69cb889c6616e27f3c0ab759f9e8d783).

Since UNIfication went live in late December we have been monitoring protocol fees, which were rolled out gradually to ensure protocol health. This started with v2 and select v3 pools on Ethereum mainnet. This rollout has gone well, with market-adjusted TVL [up](https://defillama.com/protocol/uniswap?fees=false&events=false&denomination=ETH) on Ethereum mainnet since December. The burn system is working as expected, permissionlessly converting fees in [many different tokens](https://dune.com/queries/6711845) into UNI burns.

Now, we propose to:

- Expand protocol fees on v2 and v3 to Arbitrum, Base, Celo, OP Mainnet, Soneium, X Layer, Worldchain, and Zora
- Enable protocol fees on all v3 pools via a new tier-based [v3OpenFeeAdapter](https://github.com/Uniswap/protocol-fees/blob/main/src/feeAdapters/V3OpenFeeAdapter.sol) on mainnet and the above L2s

### **Implementation Details**

**Expand protocol fees to L2s and burn UNI on mainnet**

This proposal introduces v2 and v3 protocol fees on eight chains. Fees on each chain will be routed to the TokenJar on that respective chain.

UNI burned on L2s doesn't stay on L2s - it is bridged back to mainnet and sent to 0xdead. This uses the same infrastructure used for burning Unichain sequencer fees ([OptimismBridgedResourceFirepit](https://github.com/Uniswap/protocol-fees/blob/main/src/releasers/OptimismBridgedResourceFirepit.sol) for OP Stack chains, and [ArbitrumBridgedResourceFirepit](https://github.com/Uniswap/protocol-fees/blob/main/src/releasers/ArbitrumBridgedResourceFirepit.sol) for Arbitrum).

**Enable fees on all v3 pools**

The current v3FeeAdapter manages protocol fees pool by pool and governance maintains a list of individual pools and their fee levels. Today, those pools account for a significant majority of v3 volume on Ethereum mainnet.

v3OpenFeeAdapter replaces this with a tier-based system. Protocol fees are set uniformly across all pools sharing the same LP fee tier. For example, all 1bps LP fee pools could have protocol fees set to 25%. Any pool automatically gets the default protocol fee for its tier, no governance action is needed. This means if this proposal passes, protocol fees will be active on every v3 pool. Governance retains the ability to override fees on individual pools.

### **Governance Process**

Please note that because of GovernorBravo's limit of 10 actions per proposal, there will be two separate onchain votes posted in parallel. One proposal will include the change to mainnet's fee controller and turn on fees on Base, OP Mainnet, and Arbitrum, the other will turn on fees on Celo, Soneium, Worldchain, X Layer, and Zora.`,
};
