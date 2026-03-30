import type {
  PublishArtifactMetadata,
  PublishAuthenticityMetadata,
  ReportTrustMetadata,
} from '@/hooks/use-simulation-results';

const GENERIC_TRUST_WARNING_REASONS = new Set([
  'Simulation completed with warnings or inconclusive checks.',
  'Some checks were skipped and should be reviewed.',
]);

type PublishedFileKind = 'artifact' | 'metadata';

export function getVisibleTrustState(
  trust: ReportTrustMetadata | undefined,
): { level: 'blocked' | 'warning'; label: string; reasons: string[] } | null {
  if (!trust) return null;

  if (trust.level === 'blocked') {
    return {
      level: 'blocked',
      label: 'Blocked',
      reasons: trust.blockingReasons ?? [],
    };
  }

  const specificWarningReasons = (trust.warningReasons ?? []).filter(
    (reason) => !GENERIC_TRUST_WARNING_REASONS.has(reason),
  );

  if (specificWarningReasons.length === 0) {
    return null;
  }

  return {
    level: 'warning',
    label: 'Review trust',
    reasons: specificWarningReasons,
  };
}

export function getCanonicalPublishedFileUrl(
  publish: PublishArtifactMetadata | undefined,
  kind: PublishedFileKind,
): string | undefined {
  if (!publish) return undefined;

  const currentUrl = kind === 'artifact' ? publish.artifactUrl : publish.metadataUrl;
  if (!currentUrl) return undefined;

  try {
    const parsed = new URL(currentUrl);
    if (!parsed.hostname.endsWith('.vercel.app')) {
      return parsed.toString();
    }
  } catch {
    return currentUrl;
  }

  if (publish.publishId.trim().length === 0) {
    return currentUrl;
  }

  const pathname = kind === 'artifact' ? '/simulation-results.json' : '/publish-metadata.json';
  return `https://a-${publish.publishId}.publish.scopelift.co${pathname}`;
}

export function formatAuthenticityBadgeLabel(
  authenticity: PublishAuthenticityMetadata | undefined,
): string | null {
  if (!authenticity) return null;

  switch (authenticity.status) {
    case 'verified':
      return 'Artifact verified';
    case 'invalid':
      return 'Verification failed';
    case 'unsigned':
      return 'Unsigned artifact';
    case 'unconfigured':
      return 'Verification unavailable';
  }
}

export function formatAuthenticityDetails(
  authenticity: PublishAuthenticityMetadata | undefined,
): string | null {
  if (!authenticity) return null;

  if (authenticity.status === 'verified') {
    return [authenticity.algorithm, authenticity.keyId].filter(Boolean).join(' · ');
  }

  return authenticity.reason;
}
