'use client';

import { Badge } from '@/components/ui/badge';
import type { CrossChainJobPreview } from '@/hooks/use-simulation-results';
import { resolveChainName } from '@/lib/chain-name';
import { ExternalLinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { ChainLogo } from './ChainLogo';
import { formatCrossChainCall } from './cross-chain';
import { buildAddressLinkForExplorer } from './explorer';

export function CrossChainPreview({ jobs }: { jobs: CrossChainJobPreview[] }) {
  const groups = useMemo(() => {
    const byChain = new Map<number, CrossChainJobPreview[]>();
    for (const job of jobs) {
      const list = byChain.get(job.chainId) ?? [];
      list.push(job);
      byChain.set(job.chainId, list);
    }
    return Array.from(byChain.entries()).sort((a, b) => {
      const aName = resolveChainName(a[0], a[1][0]?.chainName);
      const bName = resolveChainName(b[0], b[1][0]?.chainName);
      return aName.localeCompare(bName);
    });
  }, [jobs]);

  return (
    <div className="space-y-3">
      {groups.map(([chainId, chainJobs]) => {
        const chainName = resolveChainName(chainId, chainJobs[0]?.chainName);
        const explorerBaseUrl = chainJobs[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
        const bridgeType = chainJobs[0]?.bridgeType;

        return (
          <div key={chainId}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ChainLogo chainId={chainId} size={16} />
                <span title={`Chain ID: ${chainId}`}>{chainName}</span>
              </div>
              {bridgeType ? (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {bridgeType}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              {chainJobs.map((job) => {
                const firstStep = job.steps[0];
                const jobKey = `${job.chainId}-${job.bridgeType}-${job.sourceOrder}-${job.l2FromAddress}-${job.status}`;
                const target = firstStep?.l2TargetAddress;
                const targetLabel = firstStep?.targetLabel;
                const call = firstStep ? formatCrossChainCall(firstStep) : '(empty job)';

                const statusBadge =
                  job.status === 'success' ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] h-5 px-1.5">
                      OK
                    </Badge>
                  ) : job.status === 'skipped' ? (
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      Skipped
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
                      Failed
                    </Badge>
                  );

                return (
                  <div key={jobKey} className="border border-border/40 rounded bg-muted/20 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Job {job.sourceOrder + 1}</span>
                        {targetLabel ? <span className="font-medium">{targetLabel}</span> : null}
                        {target ? (
                          <a
                            href={buildAddressLinkForExplorer(target, explorerBaseUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center"
                            title={target}
                          >
                            {target.slice(0, 6)}...{target.slice(-4)}
                            <ExternalLinkIcon className="h-2.5 w-2.5 ml-0.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">
                            (unknown target)
                          </span>
                        )}
                      </div>
                      {statusBadge}
                    </div>

                    <code className="block mt-1.5 font-mono text-[10px] text-muted-foreground truncate">
                      {call}
                    </code>

                    <div className="text-[10px] text-muted-foreground mt-1">
                      {job.steps.length} step{job.steps.length === 1 ? '' : 's'}
                    </div>

                    {job.error ? (
                      <div className="text-[10px] text-red-600 mt-1">{job.error}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
