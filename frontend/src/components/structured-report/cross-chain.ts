import type {
  CrossChainJobPreview,
  CrossChainJobStepPreview,
} from '@/hooks/use-simulation-results';
import { resolveChainName } from '@/lib/chain-name';

export function formatCrossChainCall(step: CrossChainJobStepPreview): string {
  if (step.call?.signature) return step.call.signature;
  if (step.call?.selector) return step.call.selector;
  if (step.l2InputData) return step.l2InputData.slice(0, 10);
  return '(unknown)';
}

type CrossChainChainSummary = {
  chainId: number;
  chainName: string;
  explorerBaseUrl: string;
  bridgeType?: string;
  total: number;
  successCount: number;
  failureCount: number;
  failures: Array<{
    executionIndex: number;
    sourceOrder: number;
    status: 'failure' | 'skipped';
    call: string | null;
    targetLabel?: string;
    target?: string;
    error?: string;
  }>;
};

function toFailureStatus(status: CrossChainJobPreview['status']): 'failure' | 'skipped' {
  return status === 'failure' ? 'failure' : 'skipped';
}

export function summarizeCrossChainJobs(jobs: CrossChainJobPreview[]): {
  total: number;
  successCount: number;
  failureCount: number;
  chains: CrossChainChainSummary[];
} {
  const byChain = new Map<number, CrossChainJobPreview[]>();
  for (const job of jobs) {
    const list = byChain.get(job.chainId) ?? [];
    list.push(job);
    byChain.set(job.chainId, list);
  }

  const chains: CrossChainChainSummary[] = Array.from(byChain.entries())
    .map(([chainId, chainJobs]) => {
      const chainName = resolveChainName(chainId, chainJobs[0]?.chainName);
      const explorerBaseUrl = chainJobs[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
      const bridgeType = chainJobs[0]?.bridgeType;
      const successCount = chainJobs.filter((job) => job.status === 'success').length;
      const failureCount = chainJobs.length - successCount;

      return {
        chainId,
        chainName,
        explorerBaseUrl,
        bridgeType,
        total: chainJobs.length,
        successCount,
        failureCount,
        failures: chainJobs
          .map((job, executionIndex) => ({
            executionIndex,
            sourceOrder: job.sourceOrder,
            call: job.steps[0] ? formatCrossChainCall(job.steps[0]) : null,
            targetLabel: job.steps[0]?.targetLabel,
            target: job.steps[0]?.l2TargetAddress,
            status: job.status,
            error: job.error,
          }))
          .filter((job) => job.status !== 'success')
          .map(({ executionIndex, sourceOrder, status, call, targetLabel, target, error }) => ({
            executionIndex,
            sourceOrder,
            status: toFailureStatus(status),
            call,
            targetLabel,
            target,
            error,
          })),
      };
    })
    .sort((a, b) => a.chainName.localeCompare(b.chainName));

  const total = chains.reduce((acc, c) => acc + c.total, 0);
  const successCount = chains.reduce((acc, c) => acc + c.successCount, 0);
  const failureCount = total - successCount;

  return { total, successCount, failureCount, chains };
}
