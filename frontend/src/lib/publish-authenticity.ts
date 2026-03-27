import { createPublicKey, verify } from 'node:crypto';
import { isHex } from 'viem';

type OpenJsonObject = Record<string, unknown>;

const SIGNED_FIELDS = ['publish_id', 'published_at', 'artifact_hash', 'relay_version'] as const;

export type PublishAuthenticityVerificationResult =
  | {
      status: 'verified';
      algorithm: 'ed25519';
      keyId: string;
      reason?: undefined;
    }
  | {
      status: 'unsigned' | 'unconfigured';
      reason: string;
      keyId?: undefined;
      algorithm?: undefined;
    }
  | {
      status: 'invalid';
      reason: string;
      keyId?: string;
      algorithm?: string;
    };

function readNonEmptyEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildSignedPayload(metadata: OpenJsonObject): string {
  return SIGNED_FIELDS.map((field) => `${field}=${String(metadata[field] ?? '')}`).join('\n');
}

export function verifyPublishMetadataSignature(
  metadata: OpenJsonObject,
  env: Record<string, string | undefined>,
): PublishAuthenticityVerificationResult {
  const authenticity = metadata.authenticity;
  if (!authenticity || typeof authenticity !== 'object') {
    return { status: 'unsigned', reason: 'Publish metadata is not signed.' };
  }

  const signatureValue = Reflect.get(authenticity, 'signature');
  const keyId = Reflect.get(authenticity, 'key_id');
  const algorithm = Reflect.get(authenticity, 'algorithm');
  const signedFields = Reflect.get(authenticity, 'signed_fields');
  if (
    typeof signatureValue !== 'string' ||
    typeof keyId !== 'string' ||
    typeof algorithm !== 'string'
  ) {
    return { status: 'invalid', reason: 'Publish authenticity payload is malformed.' };
  }

  if (algorithm !== 'ed25519') {
    return { status: 'invalid', keyId, algorithm, reason: 'Unsupported authenticity algorithm.' };
  }

  if (signedFields === undefined) {
    return {
      status: 'invalid',
      keyId,
      algorithm,
      reason: 'Publish signed_fields payload is missing.',
    };
  }
  if (!Array.isArray(signedFields)) {
    return {
      status: 'invalid',
      keyId,
      algorithm,
      reason: 'Publish signed_fields payload is malformed.',
    };
  }

  if (
    signedFields.length !== SIGNED_FIELDS.length ||
    !SIGNED_FIELDS.every((field, index) => signedFields[index] === field)
  ) {
    return {
      status: 'invalid',
      keyId,
      algorithm,
      reason: 'Unsupported signed_fields in authenticity payload.',
    };
  }

  if (!isHex(signatureValue, { strict: true })) {
    return { status: 'invalid', keyId, algorithm, reason: 'Publish signature is not valid hex.' };
  }

  const publicKeyPem = readNonEmptyEnv(env, 'SEATBELT_PUBLISH_ED25519_PUBLIC_KEY');
  if (!publicKeyPem) {
    return {
      status: 'unconfigured',
      reason: 'Viewer authenticity verification is not configured.',
    };
  }

  const payload = Buffer.from(buildSignedPayload(metadata));
  const providedSignature = Buffer.from(signatureValue.slice(2), 'hex');

  try {
    const publicKey = createPublicKey(publicKeyPem);
    const ok = verify(null, payload, publicKey, providedSignature);
    if (!ok) {
      return {
        status: 'invalid',
        keyId,
        algorithm,
        reason: 'Publish signature verification failed.',
      };
    }

    return { status: 'verified', keyId, algorithm };
  } catch {
    return {
      status: 'invalid',
      keyId,
      algorithm,
      reason: 'Publish signature verification failed.',
    };
  }
}
