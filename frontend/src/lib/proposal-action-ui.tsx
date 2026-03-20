import type { ProposalActionBlockedReason, ProposalActionResolution } from '@/lib/write-actions';
import { CheckCircleIcon, ClockIcon, PlayIcon, SendIcon, XCircleIcon } from 'lucide-react';

export type ProposalActionIconName = 'send' | 'play' | 'check' | 'x' | 'clock';

export type NavActionUi = {
  iconName: ProposalActionIconName;
  label: string;
};

export type SummaryActionUi = {
  iconName: ProposalActionIconName;
  iconClassName: string;
  borderStyle: string;
  title: string;
  buttonText: string | null;
};

export type CardActionUi = {
  title: string;
  description: string;
  readyText: string;
  buttonLabel: string | null;
  statusIconName: ProposalActionIconName;
  statusIconClassName: string;
};

export type PageActionUi = {
  title: string;
  description: string;
  iconName: ProposalActionIconName;
  iconClassName: string;
  iconContainerClassName: string;
};

export type ProposalActionUi = {
  nav: NavActionUi;
  summary: SummaryActionUi;
  card: CardActionUi;
  page: PageActionUi;
};

export type ProposalActionButtonUi = {
  buttonLabel: string | null;
  buttonIconName: ProposalActionIconName | null;
  isDisabled: boolean;
  showButton: boolean;
};

type ProposalActionUiKey =
  | 'propose'
  | 'execute'
  | 'executed'
  | 'invalid'
  | ProposalActionBlockedReason;

const ICONS = {
  send: SendIcon,
  play: PlayIcon,
  check: CheckCircleIcon,
  x: XCircleIcon,
  clock: ClockIcon,
} as const;

export function renderProposalActionIcon(iconName: ProposalActionIconName, className: string) {
  const Icon = ICONS[iconName];
  return <Icon className={className} />;
}

export const PROPOSAL_ACTION_UI: Record<ProposalActionUiKey, ProposalActionUi> = {
  propose: {
    nav: { iconName: 'send', label: 'Propose' },
    summary: {
      iconName: 'send',
      iconClassName: 'h-5 w-5 text-primary',
      borderStyle: 'border-primary/20 bg-primary/5',
      title: 'Proposal Ready',
      buttonText: 'Review & Propose',
    },
    card: {
      title: 'Proposal Creation',
      description: 'Transaction Parameters',
      readyText: 'Ready to propose',
      buttonLabel: 'Propose',
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-green-500',
    },
    page: {
      title: 'Submit Proposal',
      description: 'Review the transaction parameters and submit this proposal on-chain.',
      iconName: 'send',
      iconClassName: 'h-6 w-6 text-primary',
      iconContainerClassName: 'bg-primary/10',
    },
  },
  execute: {
    nav: { iconName: 'play', label: 'Execute' },
    summary: {
      iconName: 'play',
      iconClassName: 'h-5 w-5 text-primary',
      borderStyle: 'border-orange-500/20 bg-orange-500/5',
      title: 'Ready to Execute',
      buttonText: 'Review & Execute',
    },
    card: {
      title: 'Proposal Execution',
      description: 'Transaction Parameters',
      readyText: 'Ready to execute',
      buttonLabel: 'Execute',
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-green-500',
    },
    page: {
      title: 'Execute Proposal',
      description: 'This proposal has passed voting and is ready to be executed.',
      iconName: 'play',
      iconClassName: 'h-6 w-6 text-orange-500',
      iconContainerClassName: 'bg-orange-500/10',
    },
  },
  executed: {
    nav: { iconName: 'check', label: 'Details' },
    summary: {
      iconName: 'check',
      iconClassName: 'h-5 w-5 text-green-500',
      borderStyle: 'border-green-500/20 bg-green-500/5',
      title: 'Already Executed',
      buttonText: 'View Details',
    },
    card: {
      title: 'Executed Proposal',
      description: 'This proposal has already been executed',
      readyText: 'Already executed',
      buttonLabel: null,
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Details',
      description: 'This proposal has already been executed on-chain.',
      iconName: 'check',
      iconClassName: 'h-6 w-6 text-green-500',
      iconContainerClassName: 'bg-green-500/10',
    },
  },
  defeated: {
    nav: { iconName: 'x', label: 'Defeated' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-red-500',
      borderStyle: 'border-red-500/20 bg-red-500/5',
      title: 'Proposal Defeated',
      buttonText: null,
    },
    card: {
      title: 'Proposal Defeated',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal defeated',
      buttonLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-red-500',
    },
    page: {
      title: 'Proposal Defeated',
      description: 'This proposal was defeated and can no longer be executed.',
      iconName: 'x',
      iconClassName: 'h-6 w-6 text-red-500',
      iconContainerClassName: 'bg-red-500/10',
    },
  },
  expired: {
    nav: { iconName: 'x', label: 'Expired' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Proposal Expired',
      buttonText: null,
    },
    card: {
      title: 'Proposal Expired',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal expired',
      buttonLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Expired',
      description: 'This proposal expired before execution and can no longer be executed.',
      iconName: 'x',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
  canceled: {
    nav: { iconName: 'x', label: 'Canceled' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Proposal Canceled',
      buttonText: null,
    },
    card: {
      title: 'Proposal Canceled',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal canceled',
      buttonLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Canceled',
      description: 'This proposal was canceled and can no longer be executed.',
      iconName: 'x',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
  unknown: {
    nav: { iconName: 'clock', label: 'Unavailable' },
    summary: {
      iconName: 'clock',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Proposal Not Executable',
      buttonText: null,
    },
    card: {
      title: 'Proposal Not Executable',
      description: 'This proposal is not currently executable.',
      readyText: 'Not executable',
      buttonLabel: null,
      statusIconName: 'clock',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Not Executable',
      description: 'This proposal cannot be executed from this report.',
      iconName: 'clock',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
  invalid: {
    nav: { iconName: 'clock', label: 'Unavailable' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Action Unavailable',
      buttonText: null,
    },
    card: {
      title: 'Invalid Proposal Metadata',
      description: 'This report cannot be used for execution.',
      readyText: 'Action unavailable',
      buttonLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Not Executable',
      description: 'This proposal cannot be executed from this report.',
      iconName: 'clock',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
};

function getProposalActionUiKey(action: ProposalActionResolution): ProposalActionUiKey {
  return action.kind === 'blocked' ? action.reason : action.kind;
}

export function getProposalActionUi(action: ProposalActionResolution): ProposalActionUi {
  return PROPOSAL_ACTION_UI[getProposalActionUiKey(action)];
}

export function getProposalActionButtonUi(
  action: ProposalActionResolution,
  options: {
    isConnected: boolean;
    isPending: boolean;
    isPendingConfirmation: boolean;
  },
): ProposalActionButtonUi {
  const card = getProposalActionUi(action).card;

  if (!card.buttonLabel) {
    return {
      buttonLabel: null,
      buttonIconName: null,
      isDisabled: true,
      showButton: false,
    };
  }

  if (!options.isConnected) {
    return {
      buttonLabel: 'Connect Wallet',
      buttonIconName: null,
      isDisabled: true,
      showButton: true,
    };
  }

  if (options.isPendingConfirmation) {
    return {
      buttonLabel: 'Confirming...',
      buttonIconName: null,
      isDisabled: true,
      showButton: true,
    };
  }

  if (options.isPending) {
    return {
      buttonLabel: action.kind === 'propose' ? 'Creating...' : 'Executing...',
      buttonIconName: null,
      isDisabled: true,
      showButton: true,
    };
  }

  return {
    buttonLabel: card.buttonLabel,
    buttonIconName: action.kind === 'propose' ? 'send' : 'play',
    isDisabled: false,
    showButton: true,
  };
}
