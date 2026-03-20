'use client';

import { ProposalActionIcon } from '@/components/ProposalActionIcon';
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
import { getProposalCardUi } from '@/lib/proposal-action-ui';
import type { ProposalActionResolution } from '@/lib/write-actions';
import { useState } from 'react';

interface ProposalCardProps {
  proposal: Proposal;
  action: ProposalActionResolution;
  onAction: () => void;
  isPending: boolean;
  isPendingConfirmation: boolean;
  isConnected: boolean;
  className?: string;
}

export function ProposalCard({
  proposal,
  action,
  onAction,
  isPending,
  isPendingConfirmation,
  isConnected,
  className,
}: ProposalCardProps) {
  const [selectedCallIndex, setSelectedCallIndex] = useState(0);
  const hasMultipleCalls = proposal.targets.length > 1;
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
  const card = getProposalCardUi(action, {
    isConnected,
    isPending,
    isPendingConfirmation,
  });

  return (
    <Card className={`w-full ${className || ''} border border-muted`}>
      <CardHeader className="px-6">
        <CardTitle>{card.title}</CardTitle>
        <CardDescription>{card.description}</CardDescription>
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
          <ProposalActionIcon iconName={card.statusIconName} className={card.statusIconClassName} />
          {card.readyText}
        </div>
        {card.showButton && (
          <Button
            onClick={onAction}
            disabled={card.isButtonDisabled}
            size="lg"
            className="ml-6 px-6 font-medium cursor-pointer gap-2"
          >
            {card.buttonIconName && (
              <ProposalActionIcon iconName={card.buttonIconName} className="h-4 w-4" />
            )}
            {card.buttonLabel}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
