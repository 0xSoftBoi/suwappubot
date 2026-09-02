import { useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useTrading } from '../../contexts/TradingContext'
import { useBottomTab } from '../../contexts/BottomTabContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePersistentState } from '../../lib/persist'
import { openCommandPalette } from '../command/CommandPalette'
import { requestMobileTab } from '../layout/TradingLayout'

interface Step {
  id: 'connect' | 'fund' | 'swap'
  label: string
  hint: string
  run: () => void
  disabled?: boolean
  disabledHint?: string
}

// Compact, dismissible bottom-right card shown only to signed-out visitors —
// the empty state IS the pitch (brief §WS-B). Each row triggers the real
// existing action (no fake modal, no dead links). Dismissal persists in
// localStorage so it doesn't nag returning visitors who chose to skip it.
export function FirstRunChecklist() {
  const {
    isAuthenticated,
    needsTradingProof,
    signInWithWallet,
    isWalletConnecting,
    isWalletAuthAvailable,
  } = useAuth()
  const { setTradingMode } = useTrading()
  const { setActiveTab } = useBottomTab()
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  // Alert deep links land the trader on a full-width confirm ticket; the
  // fixed card sat on top of its Buy/Sell button.
  const isAlertSwap = /(^|\/)alert-swap(\/|$)/.test(pathname)
  const [dismissed, setDismissed] = usePersistentState('onboarding-checklist-dismissed', false)
  // Collapsed to a pill until the visitor opens it: the full card sat on top
  // of the bottom-panel tab strip and the right-hand panels, hiding the
  // Agent Approvals / Audit tabs entirely at laptop widths.
  const [expanded, setExpanded] = usePersistentState('onboarding-checklist-expanded', false)
  const [completed, setCompleted] = useState<Set<Step['id']>>(new Set())

  // The desktop checklist is a fixed overlay; on phones it obscures the
  // persistent trading navigation and the swap CTA. Mobile already exposes a
  // wallet-first header and dedicated Swap tab, so keep the trading surface clear.
  if ((isAuthenticated && !needsTradingProof) || dismissed || isMobile || isAlertSwap) return null

  const markDone = (id: Step['id']) => setCompleted((prev) => new Set(prev).add(id))

  const goToPortfolio = () => {
    setTradingMode('spot')
    setActiveTab('portfolio')
    if (isMobile) requestMobileTab('portfolio')
  }

  const goToSwap = () => {
    setTradingMode('spot')
    if (isMobile) requestMobileTab('swap')
    openCommandPalette()
  }

  const steps: Step[] = [
    {
      id: 'connect',
      label: needsTradingProof ? 'Verify wallet' : 'Connect wallet',
      hint: needsTradingProof
        ? 'Prove wallet control before trading'
        : 'Non-custodial — sign in with a SIWE signature',
      run: () => {
        markDone('connect')
        void signInWithWallet()
      },
      disabled: isWalletConnecting || !isWalletAuthAvailable,
      disabledHint: !isWalletAuthAvailable
        ? 'Wallet sign-in is not available on this server yet'
        : 'Signing…',
    },
    {
      id: 'fund',
      label: 'Fund it',
      hint: 'Deposit from another wallet or exchange',
      run: () => {
        markDone('fund')
        goToPortfolio()
      },
    },
    {
      id: 'swap',
      label: 'First swap',
      hint: 'Pick a token and trade cross-chain',
      run: () => {
        markDone('swap')
        goToSwap()
      },
    },
  ]

  const doneCount = steps.filter((step) => completed.has(step.id)).length

  if (!expanded) {
    return (
      <div className="pointer-events-auto fixed bottom-3 right-3 z-40 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label="Open the getting-started checklist"
          className="terminal-theme-overlay flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium text-terminal-text transition-colors hover:text-terminal-accent"
        >
          <span className="terminal-theme-caption text-[10px] uppercase text-terminal-accent">Get started</span>
          <span className="tnum text-terminal-text-secondary">{doneCount}/{steps.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss the getting-started checklist"
          title="Dismiss"
          className="terminal-theme-overlay rounded-full p-1.5 text-terminal-text-muted transition-colors hover:text-terminal-text"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="terminal-theme-overlay pointer-events-auto fixed bottom-3 right-3 z-40 w-[276px] max-w-[calc(100vw-24px)] p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          aria-label="Collapse the getting-started checklist"
          className="text-left"
        >
          <div className="terminal-theme-caption text-[10px] uppercase text-terminal-accent">Get started</div>
          <div className="mt-0.5 text-[13px] font-semibold text-terminal-text">3 steps to your first trade</div>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss the getting-started checklist"
          title="Dismiss"
          className="text-terminal-text-muted transition-colors hover:text-terminal-text"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <ol className="mt-2.5 flex flex-col gap-1">
        {steps.map((step, i) => {
          const done = completed.has(step.id)
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={step.run}
                disabled={step.disabled}
                title={step.disabled ? step.disabledHint : step.hint}
                className="terminal-theme-control flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className={`tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    done
                      ? 'bg-terminal-up text-terminal-on-accent'
                      : 'accent-wash text-terminal-accent'
                  }`}
                  aria-hidden="true"
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-terminal-text">{step.label}</span>
                  <span className="block truncate text-[10px] text-terminal-text-muted">{step.hint}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
