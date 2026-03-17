import type { PublishableSimulationResult } from './artifact-validator';

type ManagedRelayArtifactEntry = {
  report: {
    markdownReport: string;
  } & Record<string, unknown>;
} & Record<string, unknown>;

export function buildManagedRelayArtifactRaw(
  artifact:
    | PublishableSimulationResult
    | PublishableSimulationResult[]
    | ManagedRelayArtifactEntry
    | ManagedRelayArtifactEntry[],
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
