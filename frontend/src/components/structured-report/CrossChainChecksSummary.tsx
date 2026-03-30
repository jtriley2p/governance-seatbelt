'use client';

import { Badge } from '@/components/ui/badge';
import type { CrossChainJobPreview } from '@/hooks/use-simulation-results';
import { AlertTriangleIcon, CheckCircleIcon, ExternalLinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { ChainLogo } from './ChainLogo';
import { summarizeCrossChainJobs } from './cross-chain';
import { buildAddressLinkForExplorer } from './explorer';

interface CrossChainChecksSummaryProps {
  jobs: CrossChainJobPreview[];
  onNavigateToChain?: (chainId: number) => void;
}

export function CrossChainChecksSummary({ jobs, onNavigateToChain }: CrossChainChecksSummaryProps) {
  const summary = useMemo(() => summarizeCrossChainJobs(jobs), [jobs]);
  const hasFailures = summary.failureCount > 0;

  return (
    <div className="border border-muted rounded-md p-4 bg-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          {hasFailures ? (
            <AlertTriangleIcon className="h-5 w-5 text-yellow-500 mt-0.5" />
          ) : (
            <CheckCircleIcon className="h-5 w-5 text-green-500 mt-0.5" />
          )}
          <div>
            <div className="font-semibold">Cross-chain results</div>
            <div className="text-xs text-muted-foreground">
              L2 execution can fail independently of the main-chain checks.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300">
            {summary.successCount}/{summary.total} succeeded
          </Badge>
          {hasFailures ? (
            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
              {summary.failureCount} failed
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {summary.chains.map((chain) => (
          <div
            key={chain.chainId}
            className="border border-border/50 rounded-md bg-muted/20 overflow-hidden"
          >
            {onNavigateToChain ? (
              <button
                type="button"
                onClick={() => onNavigateToChain(chain.chainId)}
                className="group/chain w-full p-3 flex items-center justify-between gap-2 flex-wrap hover:bg-muted/40 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ChainLogo chainId={chain.chainId} size={18} />
                  <span title={`Chain ID: ${chain.chainId}`}>{chain.chainName}</span>
                  <span className="text-xs text-muted-foreground opacity-0 group-hover/chain:opacity-100 transition-opacity">
                    ↓
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {chain.bridgeType ? (
                    <Badge variant="outline" className="text-xs">
                      {chain.bridgeType}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-xs bg-muted-foreground/10">
                    {chain.successCount}/{chain.total} succeeded
                  </Badge>
                  {chain.failureCount > 0 ? (
                    <Badge variant="destructive" className="text-xs">
                      {chain.failureCount} failed
                    </Badge>
                  ) : null}
                </div>
              </button>
            ) : (
              <div className="p-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ChainLogo chainId={chain.chainId} size={18} />
                  <span title={`Chain ID: ${chain.chainId}`}>{chain.chainName}</span>
                </div>
                <div className="flex items-center gap-2">
                  {chain.bridgeType ? (
                    <Badge variant="outline" className="text-xs">
                      {chain.bridgeType}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-xs bg-muted-foreground/10">
                    {chain.successCount}/{chain.total} succeeded
                  </Badge>
                  {chain.failureCount > 0 ? (
                    <Badge variant="destructive" className="text-xs">
                      {chain.failureCount} failed
                    </Badge>
                  ) : null}
                </div>
              </div>
            )}

            {chain.failures.length ? (
              <div className="px-3 pb-3 space-y-1 text-xs text-muted-foreground border-t border-border/30">
                {chain.failures.map((job) => (
                  <div
                    key={`${chain.chainId}-${job.sourceOrder}`}
                    className="flex items-center gap-2 flex-wrap"
                  >
                    <span className="text-red-600 font-medium">
                      {job.status === 'skipped' ? 'skipped' : 'failed'}:
                    </span>
                    {job.call ? (
                      <code className="font-mono bg-muted-foreground/10 px-1 py-0.5 rounded">
                        {job.call}
                      </code>
                    ) : null}
                    {job.transportLabel ? (
                      <span>
                        via <code className="font-mono">{job.transportLabel}</code>
                      </span>
                    ) : null}
                    {job.targetLabel ? <span>{job.targetLabel}</span> : null}
                    {job.target ? (
                      <a
                        href={buildAddressLinkForExplorer(job.target, chain.explorerBaseUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                        title={job.target}
                      >
                        {job.target.slice(0, 6)}...{job.target.slice(-4)}
                        <ExternalLinkIcon className="h-3 w-3 ml-1" />
                      </a>
                    ) : null}
                    {job.error ? <span className="text-red-600">{job.error}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
