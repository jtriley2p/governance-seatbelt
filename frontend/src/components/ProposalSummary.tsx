'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useHrefWithArtifact } from '@/hooks/use-artifact-navigation';
import type { Proposal } from '@/hooks/use-simulation-results';
import type {
  ProposalActionAvailability,
  ProposalActionMode,
  ProposalBlockedState,
} from '@/lib/write-actions';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  PlayIcon,
  SendIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useAccount } from 'wagmi';

interface ProposalSummaryProps {
  proposal: Proposal;
  mode: ProposalActionMode;
  availability: ProposalActionAvailability;
  blockedState: ProposalBlockedState;
  className?: string;
}

function getSummaryIcon(
  mode: ProposalActionMode,
  availability: ProposalActionAvailability,
  blockedState: ProposalBlockedState,
) {
  if (mode === 'new') return <SendIcon className="h-5 w-5 text-primary" />;
  if (mode === 'executed') return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
  if (availability === 'execute') return <PlayIcon className="h-5 w-5 text-primary" />;
  if (blockedState === 'defeated') return <XCircleIcon className="h-5 w-5 text-red-500" />;
  if (blockedState === 'expired' || blockedState === 'canceled') {
    return <XCircleIcon className="h-5 w-5 text-gray-500" />;
  }
  if (mode === 'invalid') return <XCircleIcon className="h-5 w-5 text-gray-500" />;
  return <ClockIcon className="h-5 w-5 text-gray-500" />;
}

function getSummaryBorderStyle(
  mode: ProposalActionMode,
  availability: ProposalActionAvailability,
  blockedState: ProposalBlockedState,
) {
  if (mode === 'new') return 'border-primary/20 bg-primary/5';
  if (mode === 'executed') return 'border-green-500/20 bg-green-500/5';
  if (availability === 'execute') return 'border-orange-500/20 bg-orange-500/5';
  if (blockedState === 'defeated') return 'border-red-500/20 bg-red-500/5';
  return 'border-gray-500/20 bg-gray-500/5';
}

function getSummaryText(
  mode: ProposalActionMode,
  availability: ProposalActionAvailability,
  blockedState: ProposalBlockedState,
) {
  if (mode === 'new') {
    return {
      title: 'Proposal Ready',
      buttonText: 'Review & Propose',
    };
  }

  if (mode === 'executed') {
    return {
      title: 'Already Executed',
      buttonText: 'View Details',
    };
  }

  if (availability === 'execute') {
    return {
      title: 'Ready to Execute',
      buttonText: 'Review & Execute',
    };
  }

  if (blockedState === 'defeated') {
    return {
      title: 'Proposal Defeated',
      buttonText: null,
    };
  }

  if (blockedState === 'expired') {
    return {
      title: 'Proposal Expired',
      buttonText: null,
    };
  }

  if (blockedState === 'canceled') {
    return {
      title: 'Proposal Canceled',
      buttonText: null,
    };
  }

  if (mode === 'invalid') {
    return {
      title: 'Action Unavailable',
      buttonText: null,
    };
  }

  return {
    title: 'Proposal Not Executable',
    buttonText: null,
  };
}

export function ProposalSummary({
  proposal,
  mode,
  availability,
  blockedState,
  className,
}: ProposalSummaryProps) {
  const { isConnected } = useAccount();
  const actionHref = useHrefWithArtifact('/action');
  const callCount = proposal.targets.length;
  const summaryText = getSummaryText(mode, availability, blockedState);

  const getDescription = () => {
    const callText = `${callCount} contract call${callCount > 1 ? 's' : ''}`;

    if (mode === 'executed') {
      return `${callText} • View execution details`;
    }

    if (!summaryText.buttonText) {
      return `${callText} • ${summaryText.title}`;
    }

    const walletText = isConnected ? 'Wallet connected' : 'Connect wallet to continue';
    return `${callText} • ${walletText}`;
  };

  return (
    <Card
      className={`${className || ''} border-dashed border-2 ${getSummaryBorderStyle(mode, availability, blockedState)}`}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-full bg-background shrink-0">
              {getSummaryIcon(mode, availability, blockedState)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm">{summaryText.title}</p>
              <p className="text-xs text-muted-foreground truncate">{getDescription()}</p>
            </div>
          </div>
          {summaryText.buttonText && (
            <Button asChild size="sm" className="gap-2 w-full sm:w-auto shrink-0">
              <Link href={actionHref}>
                {summaryText.buttonText}
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
