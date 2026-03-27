import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  signPublishMetadata,
  verifyPublishMetadataSignature,
} from '../utils/publish/publish-authenticity';

describe('publish authenticity', () => {
  const baseMetadata = {
    publish_id: '11111111-1111-4111-8111-111111111111',
    published_at: '2026-03-26T00:00:00.000Z',
    artifact_hash: 'deadbeef',
    relay_version: 'test-relay',
  } as const;

  test('does not sign when secret is not configured', () => {
    expect(signPublishMetadata(baseMetadata, {})).toBeUndefined();
    expect(signPublishMetadata(baseMetadata, { SEATBELT_PUBLISH_HMAC_SECRET: '' })).toBeUndefined();
  });

  test('signs and verifies metadata when configured', () => {
    const env = { SEATBELT_PUBLISH_HMAC_SECRET: 'test-secret', SEATBELT_PUBLISH_HMAC_KEY_ID: 'k1' };
    const envelope = signPublishMetadata(baseMetadata, env);
    expect(envelope).toBeDefined();
    expect(envelope?.algorithm).toBe('hmac-sha256');
    expect(envelope?.key_id).toBe('k1');
    expect(envelope?.signed_fields).toEqual([
      'publish_id',
      'published_at',
      'artifact_hash',
      'relay_version',
    ]);

    const metadata = { ...baseMetadata, authenticity: envelope };
    expect(verifyPublishMetadataSignature(metadata, env)).toEqual({
      status: 'verified',
      keyId: 'k1',
      algorithm: 'hmac-sha256',
    });
  });

  test('returns unsigned when metadata has no authenticity envelope', () => {
    const env = { SEATBELT_PUBLISH_HMAC_SECRET: 'test-secret' };
    expect(verifyPublishMetadataSignature({ ...baseMetadata }, env)).toEqual({
      status: 'unsigned',
      reason: 'Publish metadata is not signed.',
    });
  });

  test('returns unconfigured when authenticity exists but viewer secret is missing', () => {
    const metadata = {
      ...baseMetadata,
      authenticity: {
        algorithm: 'hmac-sha256',
        key_id: 'k1',
        signature: '00',
        signed_fields: ['publish_id', 'published_at', 'artifact_hash', 'relay_version'],
      },
    };

    expect(verifyPublishMetadataSignature(metadata, {})).toEqual({
      status: 'unconfigured',
      reason: 'Viewer authenticity verification is not configured.',
    });
  });

  test('returns invalid when signature verification fails', () => {
    const env = { SEATBELT_PUBLISH_HMAC_SECRET: 'test-secret', SEATBELT_PUBLISH_HMAC_KEY_ID: 'k1' };
    const envelope = signPublishMetadata(baseMetadata, env)!;
    const tampered = { ...baseMetadata, artifact_hash: 'cafebabe', authenticity: envelope };

    expect(verifyPublishMetadataSignature(tampered, env)).toMatchObject({
      status: 'invalid',
      reason: 'Publish signature verification failed.',
    });
  });

  test('returns invalid for unsupported algorithms', () => {
    const env = { SEATBELT_PUBLISH_HMAC_SECRET: 'test-secret' };
    const metadata = {
      ...baseMetadata,
      authenticity: {
        algorithm: 'rsa-sha256',
        key_id: 'k1',
        signature: '00',
      },
    };

    expect(verifyPublishMetadataSignature(metadata, env)).toEqual({
      status: 'invalid',
      keyId: 'k1',
      algorithm: 'rsa-sha256',
      reason: 'Unsupported authenticity algorithm.',
    });
  });

  test('returns invalid when signed_fields is missing', () => {
    const env = { SEATBELT_PUBLISH_HMAC_SECRET: 'test-secret', SEATBELT_PUBLISH_HMAC_KEY_ID: 'k1' };
    const envelope = signPublishMetadata(baseMetadata, env)!;
    const authenticity: Record<string, unknown> = { ...envelope, signed_fields: undefined };

    const metadata = { ...baseMetadata, authenticity };
    expect(verifyPublishMetadataSignature(metadata, env)).toEqual({
      status: 'invalid',
      keyId: 'k1',
      algorithm: 'hmac-sha256',
      reason: 'Publish signed_fields payload is missing.',
    });
  });

  test('signs and verifies metadata with ed25519 when configured', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const env = {
      SEATBELT_PUBLISH_ED25519_PRIVATE_KEY: privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString(),
      SEATBELT_PUBLISH_ED25519_PUBLIC_KEY: publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString(),
      SEATBELT_PUBLISH_ED25519_KEY_ID: 'k-ed',
    };

    const envelope = signPublishMetadata(baseMetadata, env);
    expect(envelope).toBeDefined();
    expect(envelope?.algorithm).toBe('ed25519');
    expect(envelope?.key_id).toBe('k-ed');
    expect(envelope?.signature).toMatch(/^[0-9a-f]+$/i);

    const metadata = { ...baseMetadata, authenticity: envelope };
    expect(verifyPublishMetadataSignature(metadata, env)).toEqual({
      status: 'verified',
      keyId: 'k-ed',
      algorithm: 'ed25519',
    });
  });
});
