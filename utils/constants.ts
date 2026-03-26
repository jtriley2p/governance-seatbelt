import { getAddress } from 'viem';

// Keep these exports side-effect free so test imports don't hard-require secrets.
export const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? '';
export const TENDERLY_ACCESS_TOKEN = process.env.TENDERLY_ACCESS_TOKEN ?? '';
export const TENDERLY_USER = process.env.TENDERLY_USER ?? '';
export const TENDERLY_PROJECT_SLUG = process.env.TENDERLY_PROJECT_SLUG ?? '';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new Error(`${name} is not defined`);
}

// Define the constants.
export const BLOCK_GAS_LIMIT = 30_000_000;
export const TENDERLY_BASE_URL = 'https://api.tenderly.co/api/v1';

export function getTenderlyAccessToken(): string {
  return requireEnv('TENDERLY_ACCESS_TOKEN');
}

export function getTenderlyUser(): string {
  return requireEnv('TENDERLY_USER');
}

export function getTenderlyProjectSlug(): string {
  return requireEnv('TENDERLY_PROJECT_SLUG');
}

export function getTenderlyEncodeUrl(): string {
  return `${TENDERLY_BASE_URL}/account/${getTenderlyUser()}/project/${getTenderlyProjectSlug()}/contracts/encode-states`;
}

export function getTenderlySimUrl(): string {
  return `${TENDERLY_BASE_URL}/account/${getTenderlyUser()}/project/${getTenderlyProjectSlug()}/simulate`;
}

// Only required when running a specific sim from a config file
// Note that if SIM_NAME is defined, that simulation takes precedence over scanning mode with GitHub Actions
export const SIM_NAME = process.env.SIM_NAME ?? null;

// Only required to scan for new proposals and simulate with GitHub Actions
export const DAO_NAME = process.env.DAO_NAME ?? null;
export const GOVERNOR_ADDRESS = process.env.GOVERNOR_ADDRESS
  ? getAddress(process.env.GOVERNOR_ADDRESS)
  : null;
export const REPORTS_OUTPUT_DIRECTORY = 'reports';

// Re-export security constants (these can be imported without env validation)
export { SECURITY_TOOL_TIMEOUT_MS } from './security-constants';

// Slither configuration
// When true, allows Slither to run on unverified contracts (not recommended for security)
export const SLITHER_ALLOW_UNVERIFIED = process.env.SLITHER_ALLOW_UNVERIFIED === 'true';
