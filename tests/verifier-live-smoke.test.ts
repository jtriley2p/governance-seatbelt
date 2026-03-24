import { describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CacheManager } from '../utils/clients/block-explorers/cache';
import { seedRpcEnv } from './helpers/verification-test-helpers';

const RUN_LIVE_VERIFIER_SMOKE = process.env.RUN_LIVE_VERIFIER_SMOKE === '1';
const LIVE_TIMEOUT_MS = 20_000;

const maybeLive = RUN_LIVE_VERIFIER_SMOKE ? it : it.skip;
const maybeLiveWithEtherscan =
  RUN_LIVE_VERIFIER_SMOKE &&
  typeof process.env.ETHERSCAN_API_KEY === 'string' &&
  process.env.ETHERSCAN_API_KEY.trim().length > 0 &&
  process.env.ETHERSCAN_API_KEY !== 'test-key'
    ? it
    : it.skip;

function deleteCacheFile(directory: string, chainId: number, address: string): void {
  const cachePath = join(process.cwd(), 'cache', directory, `${chainId}-${address}.json`);
  if (existsSync(cachePath)) {
    unlinkSync(cachePath);
  }
}

describe('live verifier smoke', () => {
  maybeLiveWithEtherscan(
    'hits the Etherscan verifier path on mainnet',
    async () => {
      seedRpcEnv();

      const { VerificationBackend } = await import('../utils/clients/client');
      const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
      const chainId = 1;
      const address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

      CacheManager.clearMemory();
      BlockExplorerFactory.clear();
      deleteCacheFile('verification', chainId, address);

      const result = await BlockExplorerFactory.getContractVerification(address, chainId);

      expect(result.status).toBe('verified');
      expect(result.verificationBackend).toBe(VerificationBackend.EtherscanV2);
      expect(result.source === 'sourcify' || result.source === 'block-explorer').toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  maybeLive(
    'hits the Sourcify verifier path directly',
    async () => {
      seedRpcEnv();

      const { SourcifyClient } = await import('../utils/clients/sourcify');
      const chainId = 1;
      const address = '0xcA11bde05977b3631167028862bE2a173976CA11';

      SourcifyClient.clearCache();

      const result = await SourcifyClient.isContractVerified(address, chainId);

      expect(result.verified).toBe(true);
      expect(result.status === 'exact_match' || result.status === 'match').toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  maybeLive(
    'hits the Blockscout verifier path on Ink',
    async () => {
      seedRpcEnv();

      const { VerificationBackend } = await import('../utils/clients/client');
      const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
      const chainId = 57073;
      const address = '0xcA11bde05977b3631167028862bE2a173976CA11';

      CacheManager.clearMemory();
      BlockExplorerFactory.clear();
      deleteCacheFile('verification', chainId, address);
      deleteCacheFile('abis', chainId, address);

      const verification = await BlockExplorerFactory.getContractVerification(address, chainId);
      const abi = await BlockExplorerFactory.fetchContractAbi(address, chainId);

      expect(verification.status).toBe('verified');
      expect(verification.verificationBackend).toBe(VerificationBackend.Blockscout);
      expect(abi).toBeArray();
      expect(abi?.length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );

  maybeLive(
    'hits the Tempo verifier path for verification and metadata',
    async () => {
      seedRpcEnv();

      const { VerificationBackend } = await import('../utils/clients/client');
      const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
      const chainId = 4217;
      const address = '0x24a3d4757E330890A8b8978028c9e58E04611fd6';

      CacheManager.clearMemory();
      BlockExplorerFactory.clear();
      deleteCacheFile('verification', chainId, address);
      deleteCacheFile('abis', chainId, address);
      deleteCacheFile('contract-names', chainId, address);

      const verification = await BlockExplorerFactory.getContractVerification(address, chainId);
      const abi = await BlockExplorerFactory.fetchContractAbi(address, chainId);
      const name = await BlockExplorerFactory.fetchContractName(address, chainId);

      expect(verification.status).toBe('verified');
      expect(verification.verificationBackend).toBe(VerificationBackend.Tempo);
      expect(verification.blockExplorer?.name).toBe('Tempo');
      expect(abi).toBeArray();
      expect(abi?.length).toBeGreaterThan(0);
      expect(name).toBe('UniswapV3Factory');
    },
    LIVE_TIMEOUT_MS,
  );
});
