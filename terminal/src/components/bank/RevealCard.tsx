import { useEffect, useRef, useState } from 'react'
import { bank, bankErrorText, isNotAvailable } from '../../lib/bankApi'
import { Btn, Card } from './BankUI'

/* Minimal typing for the slice of Stripe.js we use (loaded from js.stripe.com at runtime, never bundled). */
interface StripeEl { mount: (el: HTMLElement) => void; destroy: () => void }
interface StripeElements { create: (type: string, opts: Record<string, unknown>) => StripeEl }
interface StripeJs {
  createEphemeralKeyNonce: (o: { issuingCard: string }) => Promise<{ nonce?: string; error?: { message?: string } }>
  elements: () => StripeElements
}
declare global { interface Window { Stripe?: (pk: string) => StripeJs } }

const STRIPE_SRC = 'https://js.stripe.com/v3/'

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_SRC}"]`)
    const s = existing ?? document.createElement('script')
    s.addEventListener('load', () => resolve())
    s.addEventListener('error', () => reject(new Error('Could not load the secure card display. Check your connection and try again.')))
    if (!existing) { s.src = STRIPE_SRC; s.async = true; document.head.appendChild(s) }
  })
}

/**
 * Card reveal via Stripe Issuing Elements (ephemeral-key flow). The card number, expiry and CVC render inside
 * Stripe-hosted iframes: they never pass through our JS state, props or logs. Stripe.js is fetched only when the
 * user taps reveal and the server confirms a publishable key exists.
 */
export function RevealCard({ cardId, providerCardId, provider }: { cardId: string; providerCardId?: string; provider: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'shown' | 'unavailable' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const numRef = useRef<HTMLDivElement>(null)
  const expRef = useRef<HTMLDivElement>(null)
  const cvcRef = useRef<HTMLDivElement>(null)
  const mounted = useRef<StripeEl[]>([])
  const timer = useRef<number | undefined>(undefined)

  const hide = () => {
    mounted.current.forEach((e) => { try { e.destroy() } catch { /* already gone */ } })
    mounted.current = []
    window.clearTimeout(timer.current)
    setState('idle')
  }
  useEffect(() => () => { mounted.current.forEach((e) => { try { e.destroy() } catch { /* noop */ } }); window.clearTimeout(timer.current) }, [])

  const reveal = async () => {
    setState('loading'); setMsg('')
    try {
      if (provider !== 'stripe') { setState('unavailable'); return }
      if (!providerCardId) { setMsg('This card cannot be revealed here yet.'); setState('unavailable'); return }
      const cfg = await bank.revealConfig()
      await loadStripeJs()
      if (!window.Stripe) throw new Error('Secure card display did not load.')
      const stripe = window.Stripe(cfg.publishableKey)
      const n = await stripe.createEphemeralKeyNonce({ issuingCard: providerCardId })
      if (!n.nonce) throw new Error(n.error?.message ?? 'Could not start a secure session.')
      const k = await bank.revealKey(cardId, n.nonce)
      const els = stripe.elements()
      const common = { issuingCard: providerCardId, nonce: n.nonce, ephemeralKeySecret: k.ephemeralKeySecret, style: { base: { fontSize: '16px', fontFamily: 'monospace' } } }
      setState('shown')
      // Wait a tick so the mount targets are rendered.
      await new Promise((r) => setTimeout(r, 0))
      const pairs: Array<[string, HTMLDivElement | null]> = [['issuingCardNumberDisplay', numRef.current], ['issuingCardExpiryDisplay', expRef.current], ['issuingCardCvcDisplay', cvcRef.current]]
      for (const [type, el] of pairs) { if (!el) continue; const e = els.create(type, common); e.mount(el); mounted.current.push(e) }
      timer.current = window.setTimeout(hide, 60_000)
    } catch (e) {
      if (isNotAvailable(e)) { setState('unavailable'); return }
      setMsg(bankErrorText(e)); setState('error')
    }
  }

  if (state === 'unavailable') return <Card><p className="text-sm font-semibold">Card details</p><p className="text-xs text-terminal-text-secondary mt-1">{msg || 'Showing card details is not available yet.'}</p></Card>
  return (
    <Card className="space-y-2">
      <p className="text-sm font-semibold">Card details</p>
      {state === 'shown' ? (
        <>
          <div className="space-y-2" aria-label="Card details shown securely by the card provider">
            <div className="rounded-terminal-control bg-terminal-bg-tertiary px-3 py-2"><p className="text-[11px] text-terminal-text-secondary">Card number</p><div ref={numRef} className="h-6" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-terminal-control bg-terminal-bg-tertiary px-3 py-2"><p className="text-[11px] text-terminal-text-secondary">Expiry</p><div ref={expRef} className="h-6" /></div>
              <div className="rounded-terminal-control bg-terminal-bg-tertiary px-3 py-2"><p className="text-[11px] text-terminal-text-secondary">CVC</p><div ref={cvcRef} className="h-6" /></div>
            </div>
          </div>
          <p className="text-xs text-terminal-text-secondary">Hidden automatically after 60 seconds.</p>
          <Btn variant="ghost" className="w-full" onClick={hide}>Hide details</Btn>
        </>
      ) : (
        <>
          <p className="text-xs text-terminal-text-secondary">Details are shown by the card provider in a secure frame. We never see or store the number.</p>
          {state === 'error' && <p className="text-xs text-bear break-words" role="alert">{msg}</p>}
          <Btn className="w-full" disabled={state === 'loading'} onClick={() => void reveal()}>{state === 'loading' ? 'Loading…' : 'Show card details'}</Btn>
        </>
      )}
    </Card>
  )
}
