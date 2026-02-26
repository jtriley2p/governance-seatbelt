'use client';

import {
  buildCanonicalShareUrl,
  buildPrettyShareUrl,
  buildViewerUrl,
  extractPublishIdFromPathname,
  normalizeArtifactUrl,
  normalizePublishId,
} from '@/lib/share-link';
import { useMutation } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

type ShareArtifactResponse = {
  artifactUrl: string;
  viewerUrl: string | null;
  publishId: string | null;
};

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const errorValue = Reflect.get(payload, 'error');
  if (typeof errorValue !== 'string') {
    return null;
  }

  const trimmed = errorValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand-based copy when async clipboard is denied.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard API unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Clipboard copy failed');
  }
}

async function requestShareArtifact(): Promise<ShareArtifactResponse> {
  const response = await fetch('/api/share-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore parse failures and fall through to a generic error.
  }

  if (!response.ok) {
    const responseErrorMessage = readErrorMessage(payload);
    throw new Error(responseErrorMessage ?? 'Share link generation failed');
  }

  if (!payload || typeof payload !== 'object' || !('artifactUrl' in payload)) {
    throw new Error('Share link response is invalid');
  }

  const artifactUrl = Reflect.get(payload, 'artifactUrl');
  const publishIdValue = Reflect.get(payload, 'publishId');
  const normalizedArtifactUrl =
    typeof artifactUrl === 'string' ? normalizeArtifactUrl(artifactUrl) : null;

  if (!normalizedArtifactUrl) {
    throw new Error('Share link response is invalid');
  }

  return {
    artifactUrl: normalizedArtifactUrl,
    viewerUrl: normalizeViewerUrl(Reflect.get(payload, 'viewerUrl')),
    publishId: typeof publishIdValue === 'string' ? normalizePublishId(publishIdValue) : null,
  };
}

function normalizeViewerUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!(parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
      return null;
    }

    return buildViewerUrl(parsed.toString());
  } catch {
    return null;
  }
}

function resolveViewerUrl(preferredViewerUrl: string | null = null): string {
  const normalizedPreferredViewerUrl = normalizeViewerUrl(preferredViewerUrl);
  if (normalizedPreferredViewerUrl) {
    return normalizedPreferredViewerUrl;
  }

  if (typeof window === 'undefined') {
    throw new Error('Window is unavailable');
  }

  const configuredViewerUrl = process.env.NEXT_PUBLIC_SHARE_VIEWER_URL?.trim();
  if (configuredViewerUrl) {
    return buildViewerUrl(configuredViewerUrl);
  }

  if (LOCALHOST_HOSTS.has(window.location.hostname)) {
    throw new Error(
      'Viewer URL is not configured by relay. Configure SEATBELT_VIEWER_URL (relay) or NEXT_PUBLIC_SHARE_VIEWER_URL (frontend).',
    );
  }

  return buildViewerUrl(window.location.origin);
}

export function useShareLink() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const artifactFromQuery = normalizeArtifactUrl(searchParams.get('artifact'));
  const publishIdFromPath = extractPublishIdFromPathname(pathname);
  const publishIdFromQuery = normalizePublishId(searchParams.get('publishId'));
  const publishId = publishIdFromPath ?? publishIdFromQuery;

  const generateMutation = useMutation({
    mutationFn: requestShareArtifact,
  });

  const handleShare = async () => {
    if (publishId) {
      try {
        const viewerUrl = resolveViewerUrl();
        const shareUrl = buildPrettyShareUrl(viewerUrl, publishId);
        await copyToClipboard(shareUrl);
        toast.success('Share link copied');
      } catch (error) {
        console.error('Error copying existing share link:', error);
        toast.error('Couldn’t generate share link. Try again.');
      }

      return;
    }

    if (artifactFromQuery) {
      try {
        const viewerUrl = resolveViewerUrl();
        const shareUrl = buildCanonicalShareUrl(viewerUrl, artifactFromQuery);
        await copyToClipboard(shareUrl);
        toast.success('Share link copied');
      } catch (error) {
        console.error('Error copying existing share link:', error);
        toast.error('Couldn’t generate share link. Try again.');
      }

      return;
    }

    const loadingToastId = toast.loading(
      'Generating share link. Usually takes ~10-20s, but can take up to 2 minutes…',
    );
    try {
      const shareArtifactResult = await generateMutation.mutateAsync();
      const artifactUrl = shareArtifactResult.artifactUrl;
      const publishViewerUrl = resolveViewerUrl(shareArtifactResult.viewerUrl);
      const shareUrl = shareArtifactResult.publishId
        ? buildPrettyShareUrl(publishViewerUrl, shareArtifactResult.publishId)
        : buildCanonicalShareUrl(publishViewerUrl, artifactUrl);
      await copyToClipboard(shareUrl);
      toast.success('Share link ready — copied to clipboard', { id: loadingToastId });
    } catch (error) {
      console.error('Error generating share link:', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Couldn’t generate share link. Try again.';
      toast.error(message, { id: loadingToastId });
    }
  };

  return {
    hasArtifact: artifactFromQuery !== null || publishId !== null,
    isGenerating: generateMutation.isPending,
    onShare: handleShare,
  };
}
