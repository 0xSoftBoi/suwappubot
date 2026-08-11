'use client';

import { useState } from 'react';
import { maxUint256 } from 'viem';
import { curveAbi, erc20Abi } from '@/lib/dapp/abis';
import { CONTRACTS, applySlippage, deadlineFromNow } from '@/lib/dapp/config';
import { fmt, fmtPct, fmtSignedRateApr, parseAmount } from '@/lib/dapp/format';
import { useAccountData, useCurve, useCurveQuote } from '@/hooks/useProtocol';
import { useSettings } from './SettingsProvider';
import { useTx } from './TxProvider';
import { Button, Card, Disclosure, Stat, TokenInput } from './ui';
import { useWallet } from './WalletProvider';

export function CurvePanel() {
  const { account } = useWallet();
  const { data: curve, isLoading } = useCurve();
  const { data: acct } = useAccountData(account);
  const { send, busy } = useTx();
  const { slippageBps, deadlineMinutes } = useSettings();

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [input, setInput] = useState('');
  const amount = parseAmount(input);
  const { data: quote, isFetching: quoting, error: quoteError } = useCurveQuote(side, amount);

  const balance = side === 'buy' ? acct?.usdc : acct?.curveTokens;
  const needsApproval =
    side === 'buy' && quote !== undefined && (acct?.usdcAllowanceCurve ?? 0n) < quote;

  const insufficient =
    side === 'sell' && amount !== null && acct !== undefined && amount > acct.curveTokens;

  const validationError = input && amount === null ? 'Enter a valid amount' : insufficient ? `Not enough ${curve?.symbol ?? 'tokens'}` : null;

  async function approve() {
    await send({
      label: 'Approve USDC for curve',
      address: CONTRACTS.reserveAsset,
      abi: erc20Abi,
      functionName: 'approve',
      args: [CONTRACTS.timeCurve, maxUint256],
    });
  }

  async function trade() {
    if (amount === null || quote === undefined) return;
    const deadline = deadlineFromNow(deadlineMinutes);
    if (side === 'buy') {
      await send({
        label: `Buy ${input} ${curve?.symbol ?? ''}`.trim(),
        address: CONTRACTS.timeCurve,
        abi: curveAbi,
        functionName: 'buy',
        args: [amount, applySlippage(quote, slippageBps, 'up'), deadline],
      });
    } else {
      await send({
        label: `Sell ${input} ${curve?.symbol ?? ''}`.trim(),
        address: CONTRACTS.timeCurve,
        abi: curveAbi,
        functionName: 'sell',
        args: [amount, applySlippage(quote, slippageBps, 'down'), deadline],
      });
    }
    setInput('');
  }

  const limitLabel = side === 'buy' ? 'Maximum you pay' : 'Minimum you receive';
  const limitValue =
    quote === undefined ? '—' : `${fmt(applySlippage(quote, slippageBps, side === 'buy' ? 'up' : 'down'))} USDC`;

  return (
    <Card
      title="Time-Locked Bonding Curve"
      subtitle="Continuous two-way liquidity. Price is a pure function of time and supply — no oracle, no auction."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Spot price" value={`${fmt(curve?.spotPrice)} USDC`} loading={isLoading} />
        <Stat label="Supply" value={`${fmt(curve?.totalSupply, 18, { compact: true })} ${curve?.symbol ?? ''}`} loading={isLoading} />
        <Stat label="Reserve" value={`${fmt(curve?.reserveBalance, 18, { compact: true })} USDC`} loading={isLoading} />
        <Stat label="Sink taken" value={`${fmt(curve?.totalSunk)} USDC`} loading={isLoading} />
      </div>

      <div className="mt-4 rounded-suwappu-xl bg-white/60 p-4">
        <div className="mb-3 inline-flex rounded-suwappu-pill bg-suwappu-blush p-1">
          {(['buy', 'sell'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSide(s);
                setInput('');
              }}
              className={`rounded-suwappu-pill px-5 py-1.5 text-sm font-semibold capitalize transition ${
                side === s ? 'bg-white shadow-sm' : 'text-suwappu-text-secondary'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <TokenInput
          label={side === 'buy' ? 'Amount to buy' : 'Amount to sell'}
          value={input}
          onChange={setInput}
          balance={balance}
          symbol={curve?.symbol ?? 'sCRV'}
          error={validationError}
          disabled={busy}
        />

        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex justify-between">
            <dt className="text-suwappu-text-secondary">
              {side === 'buy' ? 'Estimated cost' : 'Estimated proceeds'}
            </dt>
            <dd className="font-mono font-semibold">
              {quoting ? 'quoting…' : quote === undefined ? '—' : `${fmt(quote)} USDC`}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-suwappu-text-secondary">
              {limitLabel} <span className="opacity-70">({(slippageBps / 100).toFixed(2)}% slippage)</span>
            </dt>
            <dd className="font-mono font-semibold">{limitValue}</dd>
          </div>
          {side === 'sell' && curve && (
            <div className="flex justify-between">
              <dt className="text-suwappu-text-secondary">Sink (kept by reserve)</dt>
              <dd className="font-mono">{fmtPct(curve.sinkRate)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-suwappu-text-secondary">Deadline</dt>
            <dd className="font-mono">{deadlineMinutes} min</dd>
          </div>
        </dl>

        {quoteError && (
          <p className="mt-2 text-xs text-red-500">
            No quote available for that size right now.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!account ? (
            <p className="text-sm text-suwappu-text-secondary">Connect a wallet to trade.</p>
          ) : needsApproval ? (
            <Button onClick={approve} disabled={busy}>
              Approve USDC
            </Button>
          ) : (
            <Button
              onClick={trade}
              disabled={busy || amount === null || quote === undefined || !!validationError}
            >
              {side === 'buy' ? 'Buy' : 'Sell'} {curve?.symbol ?? ''}
            </Button>
          )}
        </div>
      </div>

      <Disclosure summary="curve parameters">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Base price" value={fmt(curve?.basePrice)} />
          <Stat label="Slope / token" value={fmt(curve?.slope)} />
          <Stat label="Time decay" value={fmtSignedRateApr(curve?.rate)} />
          <Stat label="Multiplier m(t)" value={fmt(curve?.multiplier)} />
        </div>
        <p className="mt-2 text-xs text-suwappu-text-secondary">
          p(s,t) = m(t) × (basePrice + slope × supply). Decay-only schedules keep the reserve
          provably solvent; the sink is a flat haircut on sell value that cannot be split around.
        </p>
      </Disclosure>
    </Card>
  );
}
