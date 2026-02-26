'use client';

import {
  extractPublishIdFromPathname,
  normalizeArtifactUrl,
  normalizePublishId,
  withArtifactParam,
} from '@/lib/share-link';
import { usePathname, useSearchParams } from 'next/navigation';

export function useArtifactQueryParam(): string | null {
  const searchParams = useSearchParams();
  return normalizeArtifactUrl(searchParams.get('artifact'));
}

export function useHrefWithArtifact(href: string): string {
  const pathname = usePathname();
  const artifactUrl = useArtifactQueryParam();
  const searchParams = useSearchParams();
  const publishIdFromPath = extractPublishIdFromPathname(pathname);
  const publishId = publishIdFromPath ?? normalizePublishId(searchParams.get('publishId'));

  if (publishIdFromPath) {
    if (href === '/') {
      return `/p/${publishId}`;
    }
    if (href === '/action') {
      return `/p/${publishId}/action`;
    }
  }

  return withArtifactParam(href, artifactUrl, publishId);
}
