export const PROPOSAL_ACTION_ICON_NAMES = ['send', 'play', 'check', 'x', 'clock'] as const;

export type ProposalActionIconName = (typeof PROPOSAL_ACTION_ICON_NAMES)[number];
