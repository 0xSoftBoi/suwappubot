/**
 * Real on-chain execution UI for a P2P.me-sourced offer.
 *
 * Reads (LIVE on-chain price, tx limits, USDC balance) work for everyone via
 * the SDK's publicClient. Writes (placeOrder / approveUsdc) require a viem
 * WalletClient. The webapp already exposes a viem `LocalAccount` backed by the
 * user's Turnkey passkey (`useTurnkeyAccount`); we pair it with
 * `createWalletClient` to get a real, signing WalletClient. When no Turnkey
 * account is available (no passkey session / no EVM wallet), we fall back to the
 * P2P.me deeplink so the user can finish the trade on p2p.me.
 */

import { useMemo, useState } from 'react'
import { createWalletClient, http, type WalletClient } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { usePrices, useProfile, useOrders } from '@p2pdotme/sdk/react'
import { getContractErrorMessage, parseContractError } from '@p2pdotme/sdk/orders'
import { useTurnkeyAccount } from '../../hooks/useTurnkeyAccount'
import { openExternalLink } from '../../lib/telegram'
import { a11yToast } from '../../lib/a11yToast'
import {
  getP2PMeConfig,
  getDefaultP2PMeNetwork,
  getRail,
  toP2PMeCurrency,
  toUnits6,
  fromUnits6,
  p2pMeDeeplink,
  P2PME_ORDER_TYPE,
  type P2PMeNetwork,
} from '../../config/p2pme'
import type { P2POffer } from '../../types/p2p'

type UserSide = 'buy' | 'sell'

interface P2PMePanelProps {
  offer: P2POffer
  /** From the user's perspective: 'buy' crypto or 'sell' crypto. */
  side: UserSide
  network?: P2PMeNetwork
  onClose: () => void
}

export function P2PMePanel({ offer, side, network, onClose }: P2PMePanelProps) {
  const net = network ?? getDefaultP2PMeNetwork()
  const cfg = useMemo(() => getP2PMeConfig(net), [net])

  // Resolve the on-chain currency code (P2P.me uses MEX/VEN, not MXN/VES).
  const currency = useMemo(() => toP2PMeCurrency(offer.fiatCurrency), [offer.fiatCurrency])

  const prices = usePrices()
  const profile = useProfile()
  const orders = useOrders()
  const { account, address } = useTurnkeyAccount()

  const rail = currency ? getRail(currency) : null

  const [fiatAmount, setFiatAmount] = useState('')
  const [paymentAddress, setPaymentAddress] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Live on-chain pricing.
  const [buyPrice, setBuyPrice] = useState<bigint | null>(null)
  const [sellPrice, setSellPrice] = useState<bigint | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)

  // Limits + balance.
  const [buyLimit, setBuyLimit] = useState<number | null>(null)
  const [sellLimit, setSellLimit] = useState<number | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)

  // Load price config (no wallet needed).
  useMemo(() => {
    if (!currency) return
    let cancelled = false
    setPriceLoading(true)
    prices
      .getPriceConfig({ currency })
      .match(
        (pc) => {
          if (cancelled) return
          setBuyPrice(pc.buyPrice)
          setSellPrice(pc.sellPrice)
          setPriceLoading(false)
        },
        () => {
          if (cancelled) return
          setPriceLoading(false)
        }
      )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency])

  // Load limits + balance once we know the address.
  useMemo(() => {
    if (!currency || !address) return
    profile.getTxLimits({ address, currency }).match(
      (l) => {
        setBuyLimit(l.buyLimit)
        setSellLimit(l.sellLimit)
      },
      () => {
        /* limits unavailable — leave null */
      }
    )
    profile.getUsdcBalance({ address }).match(
      (b) => setUsdcBalance(b),
      () => {
        /* balance unavailable — leave null */
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, address])

  const livePrice = side === 'buy' ? buyPrice : sellPrice
  const activeLimit = side === 'buy' ? buyLimit : sellLimit

  /** Build a signing WalletClient from the Turnkey LocalAccount, if present. */
  function getWalletClient(): WalletClient | null {
    if (!account) return null
    const chain = net === 'baseSepolia' ? baseSepolia : base
    return createWalletClient({ account, chain, transport: http(cfg.rpc) })
  }

  function deeplinkFallback() {
    if (!currency) {
      a11yToast.warning('P2P.me does not support this currency.')
      return
    }
    openExternalLink(p2pMeDeeplink(side, currency))
    a11yToast.info('Finishing on P2P.me — complete the trade there, then return.')
    onClose()
  }

  async function handleSubmit() {
    if (!currency) {
      a11yToast.warning('P2P.me does not support this currency.')
      return
    }
    const fiat = Number(fiatAmount)
    if (!fiat || fiat <= 0) {
      a11yToast.warning('Enter a fiat amount.')
      return
    }
    if (activeLimit != null && fiat > activeLimit) {
      a11yToast.warning(`Above your on-chain limit of ${activeLimit} ${currency}.`)
      return
    }
    if (side === 'sell' && rail && !paymentAddress.trim()) {
      a11yToast.warning(`Enter your ${rail.label} payment address to receive fiat.`)
      return
    }

    const walletClient = getWalletClient()
    if (!walletClient || !address) {
      // No in-app signer — hand off to P2P.me. (SDK writes below are fully
      // wired and will run automatically once a walletClient is available.)
      deeplinkFallback()
      return
    }

    setSubmitting(true)
    try {
      const fiatUnits = toUnits6(fiat)
      // USDC amount: derive from fiat / price. price is 6dp; result 6dp.
      const priceUnits = livePrice ?? 0n
      const usdcUnits =
        priceUnits > 0n ? (fiatUnits * 1_000_000n) / priceUnits : 0n

      const orderType =
        side === 'buy' ? P2PME_ORDER_TYPE.BUY : P2PME_ORDER_TYPE.SELL

      // SELL locks USDC into the diamond — approve first.
      if (orderType === P2PME_ORDER_TYPE.SELL) {
        if (usdcBalance != null && usdcUnits > usdcBalance) {
          a11yToast.warning('Not enough USDC for this sell.')
          setSubmitting(false)
          return
        }
        const approveRes = await orders.approveUsdc.execute({
          walletClient,
          amount: usdcUnits,
          waitForReceipt: true,
        })
        const approveOk = approveRes.match(
          () => true,
          (err) => {
            const code = parseContractError(err)
            a11yToast.error(getContractErrorMessage(code, 'USDC approval failed.'))
            return false
          }
        )
        if (!approveOk) {
          setSubmitting(false)
          return
        }
      }

      const res = await orders.placeOrder.execute({
        walletClient,
        waitForReceipt: true,
        orderType,
        currency,
        user: address,
        recipientAddr: address,
        amount: usdcUnits,
        fiatAmount: fiatUnits,
      })

      res.match(
        (ok) => {
          const orderId = ok.meta?.orderId
          a11yToast.success(
            orderId != null
              ? `Order placed on P2P.me. Order #${orderId.toString()}.`
              : 'Order placed on P2P.me.'
          )
          onClose()
        },
        (err) => {
          const code = parseContractError(err)
          a11yToast.error(
            getContractErrorMessage(code, 'Could not place the order. Please try again.')
          )
        }
      )
    } catch {
      a11yToast.error('Something went wrong placing the order.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none placeholder:text-suwappu-text-secondary'

  if (!currency) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-suwappu-text-secondary">
          P2P.me does not support {offer.fiatCurrency} on-chain yet.
        </p>
        <button
          onClick={onClose}
          className="w-full py-3 bg-suwappu-sakura-light/40 text-suwappu-text font-heading font-semibold rounded-suwappu-pill"
        >
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Live on-chain rate */}
      <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-suwappu-text-secondary">Live on-chain rate</span>
          <span className="font-heading font-semibold text-suwappu-text">
            {priceLoading
              ? 'Loading…'
              : livePrice != null
                ? `${fromUnits6(livePrice, 4)} ${currency} / USDC`
                : 'Unavailable'}
          </span>
        </div>
        {activeLimit != null && (
          <div className="flex justify-between text-sm">
            <span className="text-suwappu-text-secondary">Your {side} limit</span>
            <span className="text-suwappu-text">
              {activeLimit} {currency}
            </span>
          </div>
        )}
        {usdcBalance != null && (
          <div className="flex justify-between text-sm">
            <span className="text-suwappu-text-secondary">USDC balance</span>
            <span className="text-suwappu-text">{fromUnits6(usdcBalance, 2)} USDC</span>
          </div>
        )}
        <div className="flex justify-between text-[11px] pt-1">
          <span className="text-suwappu-text-secondary">Network</span>
          <span className="text-suwappu-text-secondary">
            {net === 'baseSepolia' ? 'Base Sepolia (testnet)' : 'Base'}
          </span>
        </div>
      </div>

      {/* Fiat amount */}
      <div>
        <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">
          {side === 'buy' ? 'Fiat to spend' : 'Fiat to receive'} ({currency})
        </label>
        <input
          type="number"
          inputMode="decimal"
          value={fiatAmount}
          onChange={(e) => setFiatAmount(e.target.value)}
          placeholder={activeLimit != null ? `up to ${activeLimit}` : 'Amount'}
          className={inputClass}
        />
      </div>

      {/* Payment address for SELL via the local rail */}
      {side === 'sell' && rail && (
        <div>
          <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">
            {rail.label} payment address (where you receive fiat)
          </label>
          <input
            type="text"
            value={paymentAddress}
            onChange={(e) => setPaymentAddress(e.target.value)}
            placeholder={rail.placeholder}
            className={inputClass}
          />
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50"
      >
        {submitting
          ? 'Placing order…'
          : account
            ? side === 'buy'
              ? 'Buy USDC on-chain'
              : 'Sell USDC on-chain'
            : 'Continue on P2P.me ↗'}
      </button>

      <p className="text-[10px] text-suwappu-text-secondary text-center">
        {account
          ? 'Settles on-chain via the P2P.me Diamond on Base. Signed with your passkey wallet.'
          : 'No in-app wallet connected — this opens P2P.me to finish the trade (self-custody).'}
      </p>
    </div>
  )
}
