'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useHrefWithArtifact } from '@/hooks/use-artifact-navigation';
import type { Proposal } from '@/hooks/use-simulation-results';
import { getProposalActionUi, renderProposalActionIcon } from '@/lib/proposal-action-ui';
import type { ProposalActionResolution } from '@/lib/write-actions';
import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useAccount } from 'wagmi';

interface ProposalSummaryProps {
  proposal: Proposal;
  action: ProposalActionResolution;
  className?: string;
}

export function ProposalSummary({ proposal, action, className }: ProposalSummaryProps) {
  const { isConnected } = useAccount();
  const actionHref = useHrefWithArtifact('/action');
  const callCount = proposal.targets.length;
  const summary = getProposalActionUi(action).summary;

  const getDescription = () => {
    const callText = `${callCount} contract call${callCount > 1 ? 's' : ''}`;

    if (action.kind === 'executed') {
      return `${callText} • View execution details`;
    }

    if (!summary.buttonText) {
      return `${callText} • ${summary.title}`;
    }

    const walletText = isConnected ? 'Wallet connected' : 'Connect wallet to continue';
    return `${callText} • ${walletText}`;
  };

  return (
    <Card className={`${className || ''} border-dashed border-2 ${summary.borderStyle}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-full bg-background shrink-0">
              {renderProposalActionIcon(summary.iconName, summary.iconClassName)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm">{summary.title}</p>
              <p className="text-xs text-muted-foreground truncate">{getDescription()}</p>
            </div>
          </div>
          {summary.buttonText && (
            <Button asChild size="sm" className="gap-2 w-full sm:w-auto shrink-0">
              <Link href={actionHref}>
                {summary.buttonText}
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
