import type { CrossChainMessagePreview } from '@/hooks/use-simulation-results';
import { resolveChainName } from '@/lib/chain-name';

export function formatCrossChainCall(message: CrossChainMessagePreview): string {
  if (message.call?.signature) return message.call.signature;
  if (message.call?.selector) return message.call.selector;
  if (message.l2InputData) return message.l2InputData.slice(0, 10);
  return '(unknown)';
}

type CrossChainChainSummary = {
  chainId: number;
  chainName: string;
  explorerBaseUrl: string;
  bridgeType?: string;
  total: number;
  successCount: number;
  failureCount: number;
  failures: Array<{
    index: number;
    status: 'failure' | 'skipped';
    call: string;
    targetLabel?: string;
    target?: string;
    error?: string;
  }>;
};

function toFailureStatus(status: CrossChainMessagePreview['status']): 'failure' | 'skipped' {
  return status === 'failure' ? 'failure' : 'skipped';
}

export function summarizeCrossChainMessages(messages: CrossChainMessagePreview[]): {
  total: number;
  successCount: number;
  failureCount: number;
  chains: CrossChainChainSummary[];
} {
  const byChain = new Map<number, CrossChainMessagePreview[]>();
  for (const msg of messages) {
    const list = byChain.get(msg.chainId) ?? [];
    list.push(msg);
    byChain.set(msg.chainId, list);
  }

  const chains: CrossChainChainSummary[] = Array.from(byChain.entries())
    .map(([chainId, chainMessages]) => {
      const chainName = resolveChainName(chainId, chainMessages[0]?.chainName);
      const explorerBaseUrl = chainMessages[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
      const bridgeType = chainMessages[0]?.bridgeType;
      const successCount = chainMessages.filter((m) => m.status === 'success').length;
      const failureCount = chainMessages.length - successCount;

      return {
        chainId,
        chainName,
        explorerBaseUrl,
        bridgeType,
        total: chainMessages.length,
        successCount,
        failureCount,
        failures: chainMessages
          .map((m, index) => ({
            index,
            call: formatCrossChainCall(m),
            targetLabel: m.targetLabel,
            target: m.l2TargetAddress,
            status: m.status,
            error: m.error,
          }))
          .filter((m) => m.status !== 'success')
          .map(({ index, status, call, targetLabel, target, error }) => ({
            index,
            status: toFailureStatus(status),
            call,
            targetLabel,
            target,
            error,
          })),
      };
    })
    .sort((a, b) => a.chainName.localeCompare(b.chainName));

  const total = chains.reduce((acc, c) => acc + c.total, 0);
  const successCount = chains.reduce((acc, c) => acc + c.successCount, 0);
  const failureCount = total - successCount;

  return { total, successCount, failureCount, chains };
}
