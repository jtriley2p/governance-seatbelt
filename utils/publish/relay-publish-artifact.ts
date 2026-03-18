import type { PublishableSimulationResult } from './artifact-validator';

type RelayPublishArtifactEntry = {
  report: {
    markdownReport: string;
  } & Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Serialize a publish artifact for the managed relay path.
 *
 * The relay/viewer only needs the structured JSON report, so we blank the
 * rendered markdown report before upload to keep payload size down.
 */
export function buildRelayPublishArtifactRaw(
  artifact:
    | PublishableSimulationResult
    | PublishableSimulationResult[]
    | RelayPublishArtifactEntry
    | RelayPublishArtifactEntry[],
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
