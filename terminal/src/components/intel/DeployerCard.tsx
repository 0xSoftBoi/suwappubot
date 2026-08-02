import { useState } from 'react'
import toast from 'react-hot-toast'
import { truncateAddress, rugRate, formatPct } from '../../lib/intelFormat'
import { useAddDevWatch, useDevWatchList, useRemoveDevWatch } from '../../hooks/useTokenIntel'
import { TerminalButton, TerminalKeyValueRow } from '../foundation'

interface DeployerCardProps {
  deployer: string | null
  chain: string
  priorDeploys: number | null
  deadDeploys: number | null
}

// No explorer-URL helper exists elsewhere in terminal/ yet — a small local
// map covers the chains this panel can see. Unknown chains just skip the link.
const EXPLORER_ADDRESS_URL: Record<string, string> = {
  ethereum: 'https://etherscan.io/address/',
  base: 'https://basescan.org/address/',
  arbitrum: 'https://arbiscan.io/address/',
  optimism: 'https://optimistic.etherscan.io/address/',
  polygon: 'https://polygonscan.com/address/',
  bsc: 'https://bscscan.com/address/',
  avalanche: 'https://snowtrace.io/address/',
  solana: 'https://solscan.io/account/',
  sui: 'https://suiscan.xyz/mainnet/account/',
}

function explorerUrl(chain: string, address: string): string | null {
  const base = EXPLORER_ADDRESS_URL[chain]
  return base ? `${base}${address}` : null
}

function rugRateTone(rate: number | null): { label: string; className: string } {
  if (rate === null) return { label: 'Unknown history', className: 'text-terminal-text-muted' }
  if (rate === 0) return { label: 'Clean history', className: 'text-bull' }
  if (rate < 25) return { label: 'Low rug rate', className: 'text-bull' }
  if (rate < 60) return { label: 'Elevated rug rate', className: 'text-terminal-warn' }
  return { label: 'High rug rate', className: 'text-bear' }
}

export function DeployerCard({ deployer, chain, priorDeploys, deadDeploys }: DeployerCardProps) {
  const [copied, setCopied] = useState(false)
  const { data: watchList } = useDevWatchList()
  const addWatch = useAddDevWatch()
  const removeWatch = useRemoveDevWatch()

  if (!deployer) {
    return (
      <div className="text-[11px] text-terminal-text-muted" data-testid="deployer-card-empty">
        Deployer address unavailable.
      </div>
    )
  }

  const watched = watchList?.find(
    (w) => w.deployer_address.toLowerCase() === deployer.toLowerCase() && w.chain === chain
  )
  const rate = rugRate(deadDeploys, priorDeploys)
  const tone = rugRateTone(rate)
  const url = explorerUrl(chain, deployer)
  const busy = addWatch.isPending || removeWatch.isPending

  const handleCopy = () => {
    navigator.clipboard.writeText(deployer)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleWatchToggle = () => {
    if (watched) {
      removeWatch.mutate(watched.id, {
        onSuccess: () => toast.success('Stopped watching deployer'),
        onError: () => toast.error("Couldn't update the watch list — try again."),
      })
    } else {
      addWatch.mutate(
        { deployer_address: deployer, chain },
        {
          onSuccess: () => toast.success('Watching deployer'),
          onError: () => toast.error("Couldn't update the watch list — try again."),
        }
      )
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="deployer-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={handleCopy}
            title="Click to copy"
            className="truncate font-mono text-[12px] text-terminal-text hover:text-sakura-400 transition-colors"
          >
            {truncateAddress(deployer)}
          </button>
          {copied && <span className="text-[9px] text-bull shrink-0">Copied</span>}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title="View on explorer"
              className="shrink-0 text-terminal-text-muted hover:text-terminal-text"
            >
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
        </div>
        <TerminalButton
          size="sm"
          variant={watched ? 'secondary' : 'primary'}
          onClick={handleWatchToggle}
          disabled={busy}
        >
          {watched ? '\u{1F441} Watching' : '\u{1F441} Watch deployer'}
        </TerminalButton>
      </div>

      <TerminalKeyValueRow
        label="Prior Deploys"
        value={priorDeploys ?? '--'}
        detail={deadDeploys !== null && deadDeploys !== undefined ? `${deadDeploys} went to zero` : undefined}
      />
      <TerminalKeyValueRow
        label="Rug Rate"
        value={<span className={tone.className}>{rate === null ? '--' : formatPct(rate, 0)}</span>}
        detail={tone.label}
      />
    </div>
  )
}
