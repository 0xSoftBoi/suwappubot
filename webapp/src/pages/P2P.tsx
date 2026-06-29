import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppLayout, AppHeader } from '../components/layout'
import { SkeletonCard } from '../components/ui'
import { useP2POffers } from '../hooks/useP2POffers'
import { useP2PTrades } from '../hooks/useP2PTrades'
import { useP2PMyOffers } from '../hooks/useP2PMyOffers'
import { api } from '../lib/api'
import { openExternalLink } from '../lib/telegram'
import { a11yToast } from '../lib/a11yToast'
import { P2PMeProvider } from '../components/p2p/P2PMeProvider'
import { P2PMePanel } from '../components/p2p/P2PMePanel'
import type {
  P2POffer,
  P2PSource,
  P2POfferType,
  P2PCreateOfferRequest,
} from '../types/p2p'

// === Constants ===

const FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'INR', 'BRL'] as const
const CRYPTO_ASSETS = ['USDC', 'USDT', 'BTC', 'ETH'] as const

// User intent → maker offerType inversion.
// "Buy" crypto → browse makers SELLING crypto. "Sell" crypto → browse makers BUYING.
type UserSide = 'buy' | 'sell'
function sideToOfferType(side: UserSide): P2POfferType {
  return side === 'buy' ? 'sell_crypto' : 'buy_crypto'
}

interface SourceMeta {
  label: string
  glyph: string
  /** Tailwind chip classes (color is paired with the label — never color alone). */
  chipClass: string
  /** Human note about where the trade settles. */
  settlesNote: string
  /** Label for the external CTA. */
  externalLabel: string
}

const SOURCE_META: Record<P2PSource, SourceMeta> = {
  native: {
    label: 'Suwappu',
    glyph: '🟢',
    chipClass: 'bg-suwappu-success/15 text-suwappu-success',
    settlesNote: 'Settles in-app via Suwappu on-chain escrow.',
    externalLabel: 'Suwappu',
  },
  noones: {
    label: 'NoOnes',
    glyph: '🔵',
    chipClass: 'bg-blue-500/15 text-blue-600',
    settlesNote: 'Settles on NoOnes (custodial escrow).',
    externalLabel: 'NoOnes',
  },
  p2p_me: {
    label: 'P2P.me',
    glyph: '🟣',
    chipClass: 'bg-purple-500/15 text-purple-600',
    settlesNote: 'Settles on P2P.me (self-custody handoff).',
    externalLabel: 'P2P.me',
  },
}

// === Formatters ===

function formatPrice(v: number, fiat: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: fiat,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(v)
  } catch {
    return `${v.toFixed(2)} ${fiat}`
  }
}

function formatFiat(v: number, fiat: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: fiat,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ${fiat}`
  }
}

// === Source badge ===

function SourceBadge({ source }: { source: P2PSource }) {
  const meta = SOURCE_META[source]
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.chipClass}`}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      {meta.label}
    </span>
  )
}

// === Offer card ===

function OfferCard({ offer, onSelect }: { offer: P2POffer; onSelect: (o: P2POffer) => void }) {
  const completionPct = Math.round(offer.completionRate * 100)
  return (
    <button
      onClick={() => onSelect(offer)}
      className="w-full bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 text-left hover:bg-suwappu-sakura-light/20 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SourceBadge source={offer.source} />
          <span className="font-heading font-semibold text-sm text-suwappu-text truncate">
            {offer.makerHandle}
          </span>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-heading font-bold text-sm text-suwappu-text">
            {offer.pricePerUnit === 0
              ? 'Live rate'
              : formatPrice(offer.pricePerUnit, offer.fiatCurrency)}
          </p>
          <p className="text-[10px] text-suwappu-text-secondary">
            {offer.pricePerUnit === 0 ? 'at checkout' : `per ${offer.cryptoAsset}`}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-suwappu-text-secondary mb-2">
        <span>
          {formatFiat(offer.minFiatAmount, offer.fiatCurrency)} –{' '}
          {formatFiat(offer.maxFiatAmount, offer.fiatCurrency)}
        </span>
        <span>
          {completionPct}% · {offer.tradeCount} trades
        </span>
      </div>

      {offer.paymentMethods.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {offer.paymentMethods.slice(0, 4).map((pm) => (
            <span
              key={pm}
              className="px-2 py-0.5 bg-suwappu-sakura-light/40 text-suwappu-text-secondary text-[10px] rounded-full"
            >
              {pm}
            </span>
          ))}
          {offer.paymentMethods.length > 4 && (
            <span className="px-2 py-0.5 text-suwappu-text-secondary text-[10px]">
              +{offer.paymentMethods.length - 4}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

// === Offer detail sheet ===

function OfferSheet({
  offer,
  side,
  onClose,
  onTraded,
}: {
  offer: P2POffer
  side: UserSide
  onClose: () => void
  onTraded: () => void
}) {
  const meta = SOURCE_META[offer.source]
  const isP2PMe = offer.source === 'p2p_me'
  const isExternal = !isP2PMe && !!offer.executionUrl
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState(offer.paymentMethods[0] ?? '')
  const [submitting, setSubmitting] = useState(false)

  async function handleStartNativeTrade() {
    const fiatAmount = Number(amount)
    if (!fiatAmount || fiatAmount <= 0) {
      a11yToast.warning('Enter an amount to trade.')
      return
    }
    if (fiatAmount < offer.minFiatAmount || fiatAmount > offer.maxFiatAmount) {
      a11yToast.warning(
        `Amount must be between ${formatFiat(offer.minFiatAmount, offer.fiatCurrency)} and ${formatFiat(offer.maxFiatAmount, offer.fiatCurrency)}.`
      )
      return
    }
    setSubmitting(true)
    try {
      await api.startP2PTrade({
        offerId: offer.offerId,
        fiatAmount,
        paymentMethod,
      })
      a11yToast.success('Trade started. Check My Trades for the next step.')
      onTraded()
      onClose()
    } catch {
      // Native escrow is not fully wired on the backend yet — fail gracefully.
      a11yToast.info('Native escrow is coming soon. Try a NoOnes or P2P.me offer for now.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Offer details"
    >
      <div
        className="w-full max-w-md bg-white rounded-t-suwappu-xl p-4 pb-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SourceBadge source={offer.source} />
            <span className="font-heading font-semibold text-sm text-suwappu-text">
              {offer.makerHandle}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-full text-suwappu-text-secondary hover:bg-suwappu-sakura-light/40"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3 mb-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-suwappu-text-secondary">Price</span>
            <span className="font-heading font-semibold text-suwappu-text">
              {offer.pricePerUnit === 0
                ? 'Live rate at checkout'
                : `${formatPrice(offer.pricePerUnit, offer.fiatCurrency)} / ${offer.cryptoAsset}`}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-suwappu-text-secondary">Limits</span>
            <span className="text-suwappu-text">
              {formatFiat(offer.minFiatAmount, offer.fiatCurrency)} –{' '}
              {formatFiat(offer.maxFiatAmount, offer.fiatCurrency)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-suwappu-text-secondary">Asset</span>
            <span className="text-suwappu-text">
              {offer.cryptoAsset} on {offer.cryptoChain}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-suwappu-text-secondary">Reputation</span>
            <span className="text-suwappu-text">
              {Math.round(offer.completionRate * 100)}% · {offer.tradeCount} trades
            </span>
          </div>
        </div>

        {isP2PMe ? (
          <P2PMeProvider>
            <P2PMePanel offer={offer} side={side} onClose={onClose} />
          </P2PMeProvider>
        ) : isExternal ? (
          <>
            <p className="text-xs text-suwappu-text-secondary mb-3">{meta.settlesNote}</p>
            <button
              onClick={() => openExternalLink(offer.executionUrl as string)}
              className="w-full py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button"
            >
              Continue on {meta.externalLabel} ↗
            </button>
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">
              {side === 'buy' ? 'Amount to spend' : 'Amount to receive'} ({offer.fiatCurrency})
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`${offer.minFiatAmount} – ${offer.maxFiatAmount}`}
              className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none mb-3 placeholder:text-suwappu-text-secondary"
            />

            {offer.paymentMethods.length > 0 && (
              <>
                <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">
                  Payment method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none mb-3"
                >
                  {offer.paymentMethods.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </select>
              </>
            )}

            <button
              onClick={handleStartNativeTrade}
              disabled={submitting}
              className="w-full py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50"
            >
              {submitting ? 'Starting…' : side === 'buy' ? 'Buy crypto' : 'Sell crypto'}
            </button>
            <p className="text-[10px] text-suwappu-text-secondary mt-2 text-center">{meta.settlesNote}</p>
          </>
        )}
      </div>
    </div>
  )
}

// === Create offer form ===

function CreateOfferForm({ onCreated }: { onCreated: () => void }) {
  const [offerType, setOfferType] = useState<P2POfferType>('sell_crypto')
  const [fiatCurrency, setFiatCurrency] = useState<string>('USD')
  const [cryptoAsset, setCryptoAsset] = useState<string>('USDC')
  const [pricePerUnit, setPricePerUnit] = useState('')
  const [minFiatAmount, setMinFiatAmount] = useState('')
  const [maxFiatAmount, setMaxFiatAmount] = useState('')
  const [paymentMethods, setPaymentMethods] = useState('')
  const [region, setRegion] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleCreate() {
    const min = Number(minFiatAmount)
    const max = Number(maxFiatAmount)
    const price = Number(pricePerUnit) || 0
    const methods = paymentMethods.split(',').map((s) => s.trim()).filter(Boolean)
    if (!min || !max || max < min) {
      a11yToast.warning('Set valid min and max fiat amounts.')
      return
    }
    if (methods.length === 0) {
      a11yToast.warning('Add at least one payment method.')
      return
    }
    const req: P2PCreateOfferRequest = {
      offerType,
      fiatCurrency,
      cryptoAsset,
      cryptoChain: 'ethereum',
      pricePerUnit: price,
      minFiatAmount: min,
      maxFiatAmount: max,
      paymentMethods: methods,
      region: region.trim() || 'GLOBAL',
    }
    setSubmitting(true)
    try {
      await api.createP2POffer(req)
      a11yToast.success('Offer created.')
      onCreated()
    } catch {
      a11yToast.info('Native escrow is coming soon. Offer creation is not live yet.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none placeholder:text-suwappu-text-secondary'

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 space-y-2">
      <p className="font-heading font-semibold text-sm text-suwappu-text mb-1">Create offer</p>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={offerType}
          onChange={(e) => setOfferType(e.target.value as P2POfferType)}
          className={inputClass}
        >
          <option value="sell_crypto">I sell crypto</option>
          <option value="buy_crypto">I buy crypto</option>
        </select>
        <select value={fiatCurrency} onChange={(e) => setFiatCurrency(e.target.value)} className={inputClass}>
          {FIAT_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select value={cryptoAsset} onChange={(e) => setCryptoAsset(e.target.value)} className={inputClass}>
          {CRYPTO_ASSETS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={pricePerUnit}
          onChange={(e) => setPricePerUnit(e.target.value)}
          placeholder="Price (0 = live)"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={minFiatAmount}
          onChange={(e) => setMinFiatAmount(e.target.value)}
          placeholder="Min amount"
          className={inputClass}
        />
        <input
          type="number"
          inputMode="decimal"
          value={maxFiatAmount}
          onChange={(e) => setMaxFiatAmount(e.target.value)}
          placeholder="Max amount"
          className={inputClass}
        />
      </div>

      <input
        type="text"
        value={paymentMethods}
        onChange={(e) => setPaymentMethods(e.target.value)}
        placeholder="Payment methods (comma separated)"
        className={inputClass}
      />
      <input
        type="text"
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        placeholder="Region (e.g. US, EU, GLOBAL)"
        className={inputClass}
      />

      <button
        onClick={handleCreate}
        disabled={submitting}
        className="w-full py-2.5 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create offer'}
      </button>
    </div>
  )
}

// === My activity tab ===

function MyActivity() {
  const { data: trades, isLoading: tradesLoading } = useP2PTrades()
  const { data: offers, isLoading: offersLoading } = useP2PMyOffers()
  const queryClient = useQueryClient()

  function refreshMine() {
    queryClient.invalidateQueries({ queryKey: ['p2p', 'offers', 'mine'] })
    queryClient.invalidateQueries({ queryKey: ['p2p', 'trades'] })
  }

  return (
    <div className="space-y-3">
      <CreateOfferForm onCreated={refreshMine} />

      {/* My trades */}
      <div>
        <p className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2 px-1">My trades</p>
        {tradesLoading ? (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={3} variant="token" />
          </div>
        ) : trades && trades.length > 0 ? (
          <div className="space-y-2">
            {trades.map((t) => (
              <div key={t.tradeId} className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <SourceBadge source={t.source} />
                    <span className="text-sm font-heading font-semibold text-suwappu-text">
                      {t.offerType === 'sell_crypto' ? 'Buy' : 'Sell'} {t.cryptoAsset}
                    </span>
                  </div>
                  <span className="text-[11px] text-suwappu-text-secondary capitalize">{t.status}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-suwappu-text-secondary">
                  <span>
                    {formatFiat(t.fiatAmount, t.fiatCurrency)} · {t.paymentMethod}
                  </span>
                  <span>{t.counterpartyHandle}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
            <span className="text-3xl block mb-1">🤝</span>
            <p className="text-xs text-suwappu-text-secondary">No trades yet</p>
          </div>
        )}
      </div>

      {/* My offers */}
      <div>
        <p className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2 px-1">My offers</p>
        {offersLoading ? (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={3} variant="token" />
          </div>
        ) : offers && offers.length > 0 ? (
          <div className="space-y-2">
            {offers.map((o) => (
              <div key={o.offerId} className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-heading font-semibold text-suwappu-text">
                    {o.offerType === 'sell_crypto' ? 'Selling' : 'Buying'} {o.cryptoAsset}
                  </span>
                  <span className="text-sm font-heading font-semibold text-suwappu-text">
                    {o.pricePerUnit === 0 ? 'Live rate' : formatPrice(o.pricePerUnit, o.fiatCurrency)}
                  </span>
                </div>
                <p className="text-[11px] text-suwappu-text-secondary mt-1">
                  {formatFiat(o.minFiatAmount, o.fiatCurrency)} –{' '}
                  {formatFiat(o.maxFiatAmount, o.fiatCurrency)} · {o.region}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
            <span className="text-3xl block mb-1">📝</span>
            <p className="text-xs text-suwappu-text-secondary">No offers yet</p>
          </div>
        )}
      </div>
    </div>
  )
}

// === Page ===

export function P2P() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'browse' | 'mine'>('browse')
  const [side, setSide] = useState<UserSide>('buy')
  const [fiatCurrency, setFiatCurrency] = useState<string>('USD')
  const [cryptoAsset, setCryptoAsset] = useState<string>('USDC')
  const [amount, setAmount] = useState('')
  const [selected, setSelected] = useState<P2POffer | null>(null)

  const query = useMemo(
    () => ({
      fiatCurrency,
      cryptoAsset,
      offerType: sideToOfferType(side),
      fiatAmount: amount ? Number(amount) : undefined,
    }),
    [fiatCurrency, cryptoAsset, side, amount]
  )

  const { data: offers, isLoading, error } = useP2POffers(query)

  function refreshTrades() {
    queryClient.invalidateQueries({ queryKey: ['p2p', 'trades'] })
  }

  return (
    <AppLayout
      header={<AppHeader title="P2P Marketplace" showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-20 space-y-3">
        {/* Top tabs */}
        <div className="flex bg-white rounded-suwappu-pill shadow-suwappu-1 p-1">
          <button
            onClick={() => setTab('browse')}
            className={`flex-1 py-2 text-sm font-heading font-semibold rounded-suwappu-pill transition-colors ${
              tab === 'browse' ? 'bg-suwappu-gradient text-white' : 'text-suwappu-text-secondary'
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => setTab('mine')}
            className={`flex-1 py-2 text-sm font-heading font-semibold rounded-suwappu-pill transition-colors ${
              tab === 'mine' ? 'bg-suwappu-gradient text-white' : 'text-suwappu-text-secondary'
            }`}
          >
            My activity
          </button>
        </div>

        {tab === 'browse' ? (
          <>
            {/* Buy / Sell toggle */}
            <div className="flex bg-white rounded-suwappu-pill shadow-suwappu-1 p-1">
              <button
                onClick={() => setSide('buy')}
                className={`flex-1 py-2 text-sm font-heading font-semibold rounded-suwappu-pill transition-colors ${
                  side === 'buy' ? 'bg-suwappu-success text-white' : 'text-suwappu-text-secondary'
                }`}
              >
                Buy crypto
              </button>
              <button
                onClick={() => setSide('sell')}
                className={`flex-1 py-2 text-sm font-heading font-semibold rounded-suwappu-pill transition-colors ${
                  side === 'sell' ? 'bg-suwappu-error text-white' : 'text-suwappu-text-secondary'
                }`}
              >
                Sell crypto
              </button>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-suwappu-text-secondary mb-1">
                    Fiat
                  </label>
                  <select
                    value={fiatCurrency}
                    onChange={(e) => setFiatCurrency(e.target.value)}
                    className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none"
                  >
                    {FIAT_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-suwappu-text-secondary mb-1">
                    Crypto
                  </label>
                  <select
                    value={cryptoAsset}
                    onChange={(e) => setCryptoAsset(e.target.value)}
                    className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none"
                  >
                    {CRYPTO_ASSETS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-suwappu-text-secondary mb-1">
                  Amount ({fiatCurrency}) — optional
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Any amount"
                  className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none placeholder:text-suwappu-text-secondary"
                />
              </div>
            </div>

            {/* Loading */}
            {isLoading && (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
                <SkeletonCard rows={5} variant="token" />
              </div>
            )}

            {/* Error */}
            {!isLoading && error && (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
                <span className="text-4xl block mb-2">⚠️</span>
                <p className="font-heading font-semibold text-suwappu-text mb-1">
                  Couldn't load offers
                </p>
                <p className="text-xs text-suwappu-text-secondary">Pull to refresh or try again.</p>
              </div>
            )}

            {/* Offers */}
            {!isLoading && !error && offers && offers.length > 0 && (
              <div className="space-y-2">
                {offers.map((offer) => (
                  <OfferCard key={`${offer.source}-${offer.offerId}`} offer={offer} onSelect={setSelected} />
                ))}
              </div>
            )}

            {/* Empty */}
            {!isLoading && !error && (!offers || offers.length === 0) && (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
                <span className="text-4xl block mb-2">🪙</span>
                <p className="font-heading font-semibold text-suwappu-text mb-1">No offers found</p>
                <p className="text-xs text-suwappu-text-secondary">
                  Try a different currency, asset, or amount.
                </p>
              </div>
            )}

            {/* Info */}
            <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
              <p className="text-xs text-suwappu-text-secondary">
                Offers are aggregated from Suwappu on-chain escrow, NoOnes, and P2P.me. Suwappu trades
                settle in-app; NoOnes and P2P.me trades continue on the provider.
              </p>
            </div>
          </>
        ) : (
          <MyActivity />
        )}
      </div>

      {/* Detail sheet */}
      {selected && (
        <OfferSheet
          offer={selected}
          side={side}
          onClose={() => setSelected(null)}
          onTraded={refreshTrades}
        />
      )}
    </AppLayout>
  )
}
