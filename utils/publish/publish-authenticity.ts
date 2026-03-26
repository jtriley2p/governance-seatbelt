import { createHmac, timingSafeEqual } from 'node:crypto';

type OpenJsonObject = Record<string, unknown>;

export type PublishAuthenticityEnvelope = {
  algorithm: 'hmac-sha256';
  key_id: string;
  signature: string;
  signed_fields: readonly ['publish_id', 'published_at', 'artifact_hash', 'relay_version'];
};

const SIGNED_FIELDS = [
  'publish_id',
  'published_at',
  'artifact_hash',
  'relay_version',
] as const satisfies PublishAuthenticityEnvelope['signed_fields'];

export function readNonEmptyEnv(
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

export function signPublishMetadata(
  metadata: OpenJsonObject,
  env: Record<string, string | undefined>,
): PublishAuthenticityEnvelope | undefined {
  const secret = readNonEmptyEnv(env, 'SEATBELT_PUBLISH_HMAC_SECRET');
  if (!secret) return undefined;

  const keyId = readNonEmptyEnv(env, 'SEATBELT_PUBLISH_HMAC_KEY_ID') ?? 'default';
  const signature = createHmac('sha256', secret).update(buildSignedPayload(metadata)).digest('hex');

  return {
    algorithm: 'hmac-sha256',
    key_id: keyId,
    signature,
    signed_fields: SIGNED_FIELDS,
  };
}

export function verifyPublishMetadataSignature(
  metadata: OpenJsonObject,
  env: Record<string, string | undefined>,
): {
  status: 'verified' | 'unsigned' | 'invalid' | 'unconfigured';
  keyId?: string;
  algorithm?: string;
  reason?: string;
} {
  const authenticity = metadata.authenticity;
  if (!authenticity || typeof authenticity !== 'object') {
    return { status: 'unsigned', reason: 'Publish metadata is not signed.' };
  }

  const secret = readNonEmptyEnv(env, 'SEATBELT_PUBLISH_HMAC_SECRET');
  if (!secret) {
    return {
      status: 'unconfigured',
      reason: 'Viewer authenticity verification is not configured.',
    };
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

  if (algorithm !== 'hmac-sha256') {
    return { status: 'invalid', keyId, algorithm, reason: 'Unsupported authenticity algorithm.' };
  }

  if (signedFields !== undefined) {
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
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(buildSignedPayload(metadata))
    .digest();
  const providedSignature = Buffer.from(signatureValue, 'hex');
  if (providedSignature.length !== expectedSignature.length) {
    return { status: 'invalid', keyId, algorithm, reason: 'Publish signature length mismatch.' };
  }

  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return {
      status: 'invalid',
      keyId,
      algorithm,
      reason: 'Publish signature verification failed.',
    };
  }

  return { status: 'verified', keyId, algorithm };
}
