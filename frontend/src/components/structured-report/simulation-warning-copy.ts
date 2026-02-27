import type { StructuredSimulationReport } from '../../hooks/use-simulation-results';

type Metadata = StructuredSimulationReport['metadata'];

export function getDerivedStateWarning(metadata: Metadata): string | null {
  const dependency = metadata.dependency;
  if (!dependency || dependency.mode !== 'derived') return null;

  const references: string[] = [];
  if (dependency.derivedFromProposalId) {
    references.push(`proposal ${dependency.derivedFromProposalId}`);
  }
  if (dependency.derivedFromSimulationId) {
    references.push(`simulation ${dependency.derivedFromSimulationId}`);
  }

  const referenceText = references.length > 0 ? ` (${references.join(', ')})` : '';
  const statusText =
    dependency.status === 'passed' ? '' : ` Dependency status: ${dependency.status}.`;
  const reasonText = dependency.reason ? ` Reason: ${dependency.reason}.` : '';

  return `This simulation uses derived state from a predecessor execution${referenceText}.${statusText}${reasonText}`.trim();
}
