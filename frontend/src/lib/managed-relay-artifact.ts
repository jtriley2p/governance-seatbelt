type ManagedRelayArtifactEntry = {
  report: {
    markdownReport: string;
  } & Record<string, unknown>;
} & Record<string, unknown>;

export function buildManagedRelayArtifactRaw(
  artifact: ManagedRelayArtifactEntry | ManagedRelayArtifactEntry[],
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
