'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Proposal } from '@/hooks/use-simulation-results';
import type {
  ProposalActionAvailability,
  ProposalActionMode,
  ProposalBlockedState,
} from '@/lib/write-actions';
import { CheckCircleIcon, ClockIcon, PlayIcon, SendIcon, XCircleIcon } from 'lucide-react';
import { useState } from 'react';

interface ProposalCardProps {
  proposal: Proposal;
  mode: ProposalActionMode;
  availability: ProposalActionAvailability;
  blockedState: ProposalBlockedState;
  onAction: () => void;
  isPending: boolean;
  isPendingConfirmation: boolean;
  isConnected: boolean;
  className?: string;
}

function getCardText(
  mode: ProposalActionMode,
  availability: ProposalActionAvailability,
  blockedState: ProposalBlockedState,
) {
  if (mode === 'new') {
    return {
      title: 'Proposal Creation',
      description: 'Transaction Parameters',
      readyText: 'Ready to propose',
      buttonLabel: 'Propose',
    };
  }

  if (mode === 'executed') {
    return {
      title: 'Executed Proposal',
      description: 'This proposal has already been executed',
      readyText: 'Already executed',
      buttonLabel: null,
    };
  }

  if (availability === 'execute') {
    return {
      title: 'Proposal Execution',
      description: 'Transaction Parameters',
      readyText: 'Ready to execute',
      buttonLabel: 'Execute',
    };
  }

  if (blockedState === 'defeated') {
    return {
      title: 'Proposal Defeated',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal defeated',
      buttonLabel: null,
    };
  }

  if (blockedState === 'expired') {
    return {
      title: 'Proposal Expired',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal expired',
      buttonLabel: null,
    };
  }

  if (blockedState === 'canceled') {
    return {
      title: 'Proposal Canceled',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal canceled',
      buttonLabel: null,
    };
  }

  if (mode === 'invalid') {
    return {
      title: 'Invalid Proposal Metadata',
      description: 'This report cannot be used for execution.',
      readyText: 'Action unavailable',
      buttonLabel: null,
    };
  }

  return {
    title: 'Proposal Not Executable',
    description: 'This proposal is not currently executable.',
    readyText: 'Not executable',
    buttonLabel: null,
  };
}

function getStatusIcon(
  mode: ProposalActionMode,
  availability: ProposalActionAvailability,
  blockedState: ProposalBlockedState,
) {
  if (mode === 'new' || availability === 'execute') {
    return <CheckCircleIcon className="h-4 w-4 mr-2 text-green-500" />;
  }

  if (mode === 'executed') {
    return <CheckCircleIcon className="h-4 w-4 mr-2 text-gray-400" />;
  }

  if (blockedState === 'defeated') {
    return <XCircleIcon className="h-4 w-4 mr-2 text-red-500" />;
  }

  if (blockedState === 'expired' || blockedState === 'canceled' || mode === 'invalid') {
    return <XCircleIcon className="h-4 w-4 mr-2 text-gray-400" />;
  }

  return <ClockIcon className="h-4 w-4 mr-2 text-gray-400" />;
}

export function ProposalCard({
  proposal,
  mode,
  availability,
  blockedState,
  onAction,
  isPending,
  isPendingConfirmation,
  isConnected,
  className,
}: ProposalCardProps) {
  const [selectedCallIndex, setSelectedCallIndex] = useState(0);
  const hasMultipleCalls = proposal.targets.length > 1;
  const cardText = getCardText(mode, availability, blockedState);

  const currentTarget = hasMultipleCalls
    ? proposal.targets[selectedCallIndex]
    : proposal.targets[0];
  const currentValue = hasMultipleCalls
    ? proposal.values[selectedCallIndex].toString()
    : proposal.values[0].toString();
  const currentSignature = hasMultipleCalls
    ? proposal.signatures[selectedCallIndex]
    : proposal.signatures[0];
  const currentCalldata = hasMultipleCalls
    ? proposal.calldatas[selectedCallIndex]
    : proposal.calldatas[0];

  const getActionText = () => {
    if (!isConnected) return 'Connect Wallet';
    if (isPendingConfirmation) return 'Confirming...';
    if (isPending) {
      return availability === 'propose' ? 'Creating...' : 'Executing...';
    }
    return cardText.buttonLabel;
  };

  const isActionable = availability === 'propose' || availability === 'execute';
  const isDisabled = !isActionable || isPending || isPendingConfirmation || !isConnected;
  const ActionIcon = availability === 'propose' ? SendIcon : PlayIcon;

  return (
    <Card className={`w-full ${className || ''} border border-muted`}>
      <CardHeader className="px-6">
        <CardTitle>{cardText.title}</CardTitle>
        <CardDescription>{cardText.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 px-6">
        {hasMultipleCalls && (
          <div className="mb-4">
            <h3 className="font-medium text-sm mb-2">Select Call</h3>
            <div className="flex flex-wrap gap-2">
              {proposal.targets.map((_: string, index: number) => (
                <Button
                  key={`call-target-${proposal.targets[index]}-${index}`}
                  variant={selectedCallIndex === index ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCallIndex(index)}
                  className="cursor-pointer"
                >
                  Call {index + 1}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="font-medium text-sm mb-2">Target Contract</h3>
          <p className="font-mono text-sm break-all bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentTarget}
          </p>
        </div>

        <div>
          <h3 className="font-medium text-sm mb-2">ETH Value</h3>
          <p className="font-mono text-sm bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentValue}
          </p>
        </div>

        <div>
          <h3 className="font-medium text-sm mb-2">Function Signature</h3>
          <p className="font-mono text-sm bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentSignature || '(empty)'}
          </p>
        </div>

        <div>
          <h3 className="font-medium text-sm mb-2">Encoded Function Data</h3>
          <p className="font-mono text-sm break-all bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentCalldata}
          </p>
        </div>

        {hasMultipleCalls && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing call {selectedCallIndex + 1} of {proposal.targets.length}
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between items-center border-t py-4 px-6 mt-auto">
        <div className="flex items-center text-sm text-muted-foreground">
          {getStatusIcon(mode, availability, blockedState)}
          {cardText.readyText}
        </div>
        {cardText.buttonLabel && (
          <Button
            onClick={onAction}
            disabled={isDisabled}
            size="lg"
            className="ml-6 px-6 font-medium cursor-pointer gap-2"
          >
            {!isDisabled && <ActionIcon className="h-4 w-4" />}
            {getActionText()}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
