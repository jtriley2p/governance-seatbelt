'use client';

import { Button } from '@/components/ui/button';
import { useHrefWithArtifact } from '@/hooks/use-artifact-navigation';
import { useShareLink } from '@/hooks/use-share-link';
import { useSimulationResults } from '@/hooks/use-simulation-results';
import { getProposalActionUi, renderProposalActionIcon } from '@/lib/proposal-action-ui';
import { resolveProposalAction } from '@/lib/write-actions';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { FileTextIcon, Link2Icon, Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

function NavbarConnect() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;

        if (!connected) {
          return (
            <Button type="button" size="sm" className="cursor-pointer" onClick={openConnectModal}>
              Connect Wallet
            </Button>
          );
        }

        if (chain.unsupported) {
          return (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="cursor-pointer"
              onClick={openChainModal}
            >
              Wrong network
            </Button>
          );
        }

        return (
          <div className="flex items-center gap-2" aria-label="Wallet">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={openChainModal}
              aria-label={`Network: ${chain.name}`}
            >
              {chain.name}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={openAccountModal}
            >
              <span
                className="inline-block size-2 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              {account.displayName}
              {account.displayBalance ? ` (${account.displayBalance})` : ''}
            </Button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const reportHref = useHrefWithArtifact('/');
  const actionHref = useHrefWithArtifact('/action');
  const { hasArtifact, isGenerating, onShare } = useShareLink();
  const { data: simulationData } = useSimulationResults();

  const rawSimulationType = simulationData?.report.structuredReport?.metadata?.simulationType;
  const proposalState = simulationData?.report.structuredReport?.metadata?.proposalState;
  const actionResolution = resolveProposalAction(rawSimulationType, proposalState);
  const actionNav = getProposalActionUi(actionResolution).nav;

  const reportIsActive =
    pathname === '/' ||
    /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pathname,
    );
  const actionIsActive =
    pathname === '/action' ||
    /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/action$/i.test(
      pathname,
    );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
              <Link href={reportHref} className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">Seatbelt</h1>
              </Link>
              <div className="sm:hidden text-[10px] leading-none text-muted-foreground">
                Maintained by{' '}
                <a
                  href="https://scopelift.co"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  ScopeLift
                </a>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden="true">|</span>
                <span>
                  Maintained by{' '}
                  <a
                    href="https://scopelift.co"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    ScopeLift
                  </a>
                </span>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-1">
              <NavLink href={reportHref} active={reportIsActive}>
                <FileTextIcon className="h-4 w-4" />
                Report
              </NavLink>
              <NavLink href={actionHref} active={actionIsActive}>
                {renderProposalActionIcon(actionNav.iconName, 'h-4 w-4')}
                {actionNav.label}
              </NavLink>
            </div>
          </div>

          <div className="flex items-center">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex h-8 gap-1.5 text-xs border border-border cursor-pointer"
                onClick={onShare}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2Icon className="h-3.5 w-3.5" />
                )}
                <span className="font-medium">
                  {isGenerating
                    ? 'Generating Link…'
                    : hasArtifact
                      ? 'Copy Share Link'
                      : 'Generate Share Link'}
                </span>
              </Button>
              <NavbarConnect />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </Link>
  );
}
