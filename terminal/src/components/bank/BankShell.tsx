import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { TerminalThemeScope } from '../../theme/TerminalThemeScope'
import { hasBankCredential } from '../../lib/bankAuth'
import { TELEGRAM_BOT_URL } from '../../lib/botLink'

/**
 * Standalone mobile shell for Suwappu Bank (no trading header / market strip). Bank calls authenticate with
 * Telegram initData only (api-ts telegramAuth), so outside Telegram we say so instead of firing doomed 401s.
 * The URL is left untouched, so /bank/claim/<token> is still the route when the user reopens it from Telegram.
 */
export function BankShell({ title, onBack, children, bare = false }: { title?: string; onBack?: () => void; children: ReactNode; bare?: boolean }) {
  const navigate = useNavigate()
  return (
    <TerminalThemeScope>
      <div
        className="terminal-theme-page h-[100dvh] w-full overflow-y-auto overflow-x-hidden overscroll-contain text-terminal-text font-sans flex flex-col"
        style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        {!bare && (
          <header style={{ paddingTop: 'env(safe-area-inset-top)' }} className="sticky top-0 z-20 shrink-0 flex items-center gap-1 min-h-12 px-2 bg-terminal-bg border-b border-terminal-border">
            <button type="button" aria-label="Back" onClick={onBack ?? (() => navigate('/bank'))} className="min-w-[44px] min-h-[44px] text-terminal-text-secondary hover:text-terminal-text">←</button>
            <h1 className="flex-1 min-w-0 truncate font-display font-semibold text-sm">{title}</h1>
            <button type="button" onClick={() => navigate('/')} className="min-h-[44px] px-2 text-xs font-semibold text-terminal-text-secondary hover:text-terminal-text">Terminal</button>
          </header>
        )}
        <div className="flex-1 min-w-0">
          {hasBankCredential() || bare ? children : <NeedsTelegram />}
        </div>
      </div>
    </TerminalThemeScope>
  )
}

const BOT_URL = TELEGRAM_BOT_URL

function NeedsTelegram() {
  return (
    <div role="status" className="p-6 max-w-sm mx-auto text-center space-y-2">
      <p className="text-sm font-semibold">Open Suwappu Bank from Telegram</p>
      <p className="text-xs text-terminal-text-secondary">Bank sign-in uses your Telegram session. Open this page from the Suwappu bot (/bank) to continue.</p>
      <a href={BOT_URL} className="terminal-button inline-flex min-h-[44px] items-center px-4 text-sm font-semibold">Open in Telegram</a>
    </div>
  )
}
