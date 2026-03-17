import type { PublishableSimulationResult } from './artifact-validator';

export function buildManagedRelayArtifactRaw(
  artifact: PublishableSimulationResult | PublishableSimulationResult[],
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
