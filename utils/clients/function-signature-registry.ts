import { toFunctionSelector } from 'viem';
import { z } from '../validation/zod';

const FOUR_BYTE_LOOKUP_TIMEOUT_MS = 2500;
const FOUR_BYTE_ENDPOINT = 'https://www.4byte.directory/api/v1/signatures/';

const selectorResultCache = new Map<string, string | null>();
const selectorPromiseCache = new Map<string, Promise<string | null>>();

const fourByteResponseSchema = z
  .object({
    results: z.array(
      z
        .object({
          text_signature: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function normalizeSelector(selector: string): string | null {
  const normalized = selector.trim().toLowerCase();
  return /^0x[0-9a-f]{8}$/.test(normalized) ? normalized : null;
}

function chooseBestSignature(selector: string, signatures: string[]): string | null {
  const candidates = signatures
    .map((signature) => signature.trim())
    .filter((signature) => signature.length > 0)
    .filter((signature) => {
      try {
        return toFunctionSelector(signature).toLowerCase() === selector;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  return candidates[0] ?? null;
}

async function fetchSignatureFrom4Byte(selector: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FOUR_BYTE_LOOKUP_TIMEOUT_MS);

  try {
    const url = `${FOUR_BYTE_ENDPOINT}?hex_signature=${selector}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const rawData = await response.json();
    const parsed = fourByteResponseSchema.safeParse(rawData);
    if (!parsed.success) return null;

    const signatures = parsed.data.results.map((item) => item.text_signature);
    return chooseBestSignature(selector, signatures);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function lookupFunctionSignatureBySelector(selector: string): Promise<string | null> {
  const normalizedSelector = normalizeSelector(selector);
  if (!normalizedSelector) return null;

  if (selectorResultCache.has(normalizedSelector)) {
    return selectorResultCache.get(normalizedSelector) ?? null;
  }

  const existingPromise = selectorPromiseCache.get(normalizedSelector);
  if (existingPromise) return await existingPromise;

  const lookupPromise = fetchSignatureFrom4Byte(normalizedSelector);
  selectorPromiseCache.set(normalizedSelector, lookupPromise);

  const signature = await lookupPromise;
  selectorPromiseCache.delete(normalizedSelector);
  selectorResultCache.set(normalizedSelector, signature);

  return signature;
}

export function clearFunctionSignatureRegistryCache(): void {
  selectorResultCache.clear();
  selectorPromiseCache.clear();
}
