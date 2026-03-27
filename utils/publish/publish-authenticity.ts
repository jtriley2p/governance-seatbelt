import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

type OpenJsonObject = Record<string, unknown>;

export type PublishAuthenticityEnvelope = {
  algorithm: 'ed25519';
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

function isHexSignature(value: string): boolean {
  return value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function buildSignedPayload(metadata: OpenJsonObject): string {
  return SIGNED_FIELDS.map((field) => `${field}=${String(metadata[field] ?? '')}`).join('\n');
}

export function signPublishMetadata(
  metadata: OpenJsonObject,
  env: Record<string, string | undefined>,
): PublishAuthenticityEnvelope | undefined {
  const ed25519PrivateKey = readNonEmptyEnv(env, 'SEATBELT_PUBLISH_ED25519_PRIVATE_KEY');
  if (!ed25519PrivateKey) return undefined;

  const keyId = readNonEmptyEnv(env, 'SEATBELT_PUBLISH_ED25519_KEY_ID') ?? 'default';
  const payload = Buffer.from(buildSignedPayload(metadata));
  const privateKey = createPrivateKey(ed25519PrivateKey);
  const signature = sign(null, payload, privateKey).toString('hex');

  return {
    algorithm: 'ed25519',
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

  if (!isHexSignature(signatureValue)) {
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
  const providedSignature = Buffer.from(signatureValue, 'hex');

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
