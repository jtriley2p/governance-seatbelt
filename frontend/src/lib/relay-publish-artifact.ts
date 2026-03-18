type RelayPublishArtifactEntry = {
  report: {
    markdownReport: string;
  } & Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Build the frontend relay payload without the rendered markdown report.
 *
 * The hosted viewer reads structured JSON, so dropping markdown keeps the
 * published artifact small enough for the managed relay path.
 */
export function buildRelayPublishArtifactRaw(
  artifact: RelayPublishArtifactEntry | RelayPublishArtifactEntry[],
): string {
  const normalized = Array.isArray(artifact) ? artifact : [artifact];

  return JSON.stringify(
    normalized.map((result) => ({
      ...result,
      report: {
        ...result.report,
        markdownReport: '',
      },
    })),
  );
}
