'use client';

import { CheckCircleIcon, ClockIcon, PlayIcon, SendIcon, XCircleIcon } from 'lucide-react';
import type { ProposalActionIconName } from '../lib/proposal-action-icons';

const ICONS = {
  send: SendIcon,
  play: PlayIcon,
  check: CheckCircleIcon,
  x: XCircleIcon,
  clock: ClockIcon,
} as const;

export function ProposalActionIcon({
  iconName,
  className,
}: {
  iconName: ProposalActionIconName;
  className: string;
}) {
  const Icon = ICONS[iconName];
  return <Icon className={className} />;
}
