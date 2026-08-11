'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ADDR,
  type Source,
  connectWallet,
  creditAbi,
  curveAbi,
  erc20Abi,
  explorer,
  fmt,
  getInjected,
  parseUnits,
  publicClient,
  readBoth,
  txExplorer,
  vaultAbi,
  walletClient,
} from '@/lib/primitives';
import type { Address } from 'viem';
import { maxUint256 } from 'viem';

const MAX_DEADLINE = maxUint256;

type CurveState = {
  spotPrice: bigint;
  multiplier: bigint;
  reserveBalance: bigint;
  totalSupply: bigint;
  totalSunk: bigint;
  basePrice: bigint;
  slope: bigint;
  rate: bigint;
  sinkRate: bigint;
};

type VaultState = {
  cash: bigint;
  poolAssets: bigint;
  totalDebtAssets: bigint;
  nextPositionId: bigint;
  maxLtv: bigint;
  liqLtv: bigint;
  liqBonus: bigint;
  borrowRate: bigint;
};

export default function PrimitivesPage() {
  const [account, setAccount] = useState<Address | null>(null);
  const [walletErr, setWalletErr] = useState<string>('');

  const [curve, setCurve] = useState<CurveState | null>(null);
  const [curveSrc, setCurveSrc] = useState<Source>('chain');
  const [vault, setVault] = useState<VaultState | null>(null);
  const [vaultSrc, setVaultSrc] = useState<Source>('chain');

  const refresh = useCallback(async () => {
    const c = await readBoth<CurveState>(
      '/curve',
      (j) => ({
        spotPrice: BigInt(j.spotPrice),
        multiplier: BigInt(j.multiplier),
        reserveBalance: BigInt(j.reserveBalance),
        totalSupply: BigInt(j.totalSupply),
        totalSunk: BigInt(j.totalSunk),
        basePrice: BigInt(j.params.basePrice),
        slope: BigInt(j.params.slope),
        rate: BigInt(j.params.rate),
        sinkRate: BigInt(j.params.sinkRate),
      }),
      async () => {
        const a = { address: ADDR.timeCurve, abi: curveAbi } as const;
        const [spotPrice, multiplier, reserveBalance, totalSupply, totalSunk, basePrice, slope, rate, sinkRate] =
          await Promise.all([
            publicClient.readContract({ ...a, functionName: 'spotPrice' }),
            publicClient.readContract({ ...a, functionName: 'multiplier' }),
            publicClient.readContract({ ...a, functionName: 'reserveBalance' }),
            publicClient.readContract({ ...a, functionName: 'totalSupply' }),
            publicClient.readContract({ ...a, functionName: 'totalSunk' }),
            publicClient.readContract({ ...a, functionName: 'basePrice' }),
            publicClient.readContract({ ...a, functionName: 'slope' }),
            publicClient.readContract({ ...a, functionName: 'rate' }),
            publicClient.readContract({ ...a, functionName: 'sinkRate' }),
          ]);
        return { spotPrice, multiplier, reserveBalance, totalSupply, totalSunk, basePrice, slope, rate, sinkRate };
      },
    );
    setCurve(c.value);
    setCurveSrc(c.source);

    const v = await readBoth<VaultState>(
      '/vault',
      (j) => ({
        cash: BigInt(j.cash),
        poolAssets: BigInt(j.poolAssets),
        totalDebtAssets: BigInt(j.totalDebtAssets),
        nextPositionId: BigInt(j.nextPositionId),
        maxLtv: BigInt(j.params.maxLtv),
        liqLtv: BigInt(j.params.liqLtv),
        liqBonus: BigInt(j.params.liqBonus),
        borrowRate: BigInt(j.params.borrowRate),
      }),
      async () => {
        const a = { address: ADDR.amortizingVault, abi: vaultAbi } as const;
        const [cash, poolAssets, totalDebtAssets, nextPositionId, maxLtv, liqLtv, liqBonus, borrowRate] =
          await Promise.all([
            publicClient.readContract({ ...a, functionName: 'cash' }),
            publicClient.readContract({ ...a, functionName: 'poolAssets' }),
            publicClient.readContract({ ...a, functionName: 'totalDebtAssets' }),
            publicClient.readContract({ ...a, functionName: 'nextPositionId' }),
            publicClient.readContract({ ...a, functionName: 'maxLtv' }),
            publicClient.readContract({ ...a, functionName: 'liqLtv' }),
            publicClient.readContract({ ...a, functionName: 'liqBonus' }),
            publicClient.readContract({ ...a, functionName: 'borrowRate' }),
          ]);
        return { cash, poolAssets, totalDebtAssets, nextPositionId, maxLtv, liqLtv, liqBonus, borrowRate };
      },
    );
    setVault(v.value);
    setVaultSrc(v.source);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    const eth = getInjected();
    if (eth) {
      (eth.request({ method: 'eth_accounts' }) as Promise<string[]>)
        .then((a) => a?.[0] && setAccount(a[0] as Address))
        .catch(() => {});
    }
    return () => clearInterval(id);
  }, [refresh]);

  const connect = async () => {
    setWalletErr('');
    try {
      setAccount(await connectWallet());
    } catch (e) {
      setWalletErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="min-h-screen bg-suwappu-bg text-suwappu-text font-body">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <header className="mb-8">
          <a href="/" className="text-sm text-suwappu-magenta hover:underline">
            ← suwappu
          </a>
          <h1 className="mt-3 font-heading text-4xl font-bold gradient-text sm:text-5xl">Primitives Playground</h1>
          <p className="mt-2 max-w-2xl text-suwappu-text-secondary">
            Interact with the three immutable Suwappu on-chain primitives on{' '}
            <span className="font-semibold">Base Sepolia</span>. Reads come from the api-ts route when it&apos;s live,
            falling back to reading the chain directly. Writes go through your wallet.
          </p>
          <p className="mt-2 inline-block rounded-suwappu-pill bg-suwappu-warning/50 px-3 py-1 text-xs font-semibold text-suwappu-magenta-mid">
            ⚠ Testnet only · unaudited immutable contracts
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {account ? (
              <span className="rounded-suwappu-pill bg-suwappu-success/40 px-4 py-2 text-sm font-semibold">
                ● {account.slice(0, 6)}…{account.slice(-4)}
              </span>
            ) : (
              <button
                type="button"
                onClick={connect}
                className="rounded-suwappu-pill bg-suwappu-magenta px-5 py-2.5 text-sm font-semibold text-white shadow-suwappu-button transition hover:shadow-suwappu-button-hover"
              >
                Connect wallet
              </button>
            )}
            <button type="button" onClick={refresh} className="rounded-suwappu-pill glass px-4 py-2 text-sm font-semibold">
              ↻ Refresh
            </button>
            <Faucet account={account} onDone={refresh} />
          </div>
          {walletErr && <p className="mt-2 text-sm text-red-500">{walletErr}</p>}
        </header>

        <div className="grid gap-6">
          <CurveCard state={curve} source={curveSrc} account={account} onDone={refresh} />
          <VaultCard state={vault} source={vaultSrc} account={account} onDone={refresh} />
          <CreditCard account={account} onDone={refresh} />
        </div>

        <footer className="mt-10 text-center text-xs text-suwappu-text-secondary">
          Contracts:{' '}
          <a className="text-suwappu-magenta hover:underline" href={explorer(ADDR.timeCurve)} target="_blank" rel="noreferrer">
            TimeCurve
          </a>{' '}
          ·{' '}
          <a className="text-suwappu-magenta hover:underline" href={explorer(ADDR.amortizingVault)} target="_blank" rel="noreferrer">
            AmortizingVault
          </a>{' '}
          ·{' '}
          <a className="text-suwappu-magenta hover:underline" href={explorer(ADDR.mutualCredit)} target="_blank" rel="noreferrer">
            MutualCredit
          </a>
        </footer>
      </div>
    </main>
  );
}

// ── shared UI ──
function Card({ title, subtitle, source, children }: { title: string; subtitle: string; source?: Source; children: React.ReactNode }) {
  return (
    <section className="glass-card rounded-suwappu-xl p-6 shadow-suwappu-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">{title}</h2>
          <p className="text-sm text-suwappu-text-secondary">{subtitle}</p>
        </div>
        {source && <SourceBadge source={source} />}
      </div>
      {children}
    </section>
  );
}

function SourceBadge({ source }: { source: Source }) {
  return (
    <span
      className={`shrink-0 rounded-suwappu-pill px-3 py-1 text-xs font-semibold ${
        source === 'api' ? 'bg-suwappu-cyan/60 text-suwappu-navy' : 'bg-suwappu-sakura-light text-suwappu-magenta-mid'
      }`}
      title={source === 'api' ? 'Served by the api-ts /v1/primitives route' : 'Read directly from the chain (API unavailable)'}
    >
      {source === 'api' ? 'source: API' : 'source: on-chain'}
    </span>
  );
}

function Stat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-white/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-suwappu-text-secondary">{label}</div>
      <div className={`text-sm font-semibold ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function useTx(onDone: () => void) {
  const [status, setStatus] = useState<{ kind: 'idle' | 'pending' | 'ok' | 'err'; msg: string; hash?: string }>({
    kind: 'idle',
    msg: '',
  });
  const run = async (account: Address | null, fn: (acct: Address) => Promise<`0x${string}`>) => {
    if (!account) {
      setStatus({ kind: 'err', msg: 'Connect a wallet first.' });
      return;
    }
    setStatus({ kind: 'pending', msg: 'Submitting…' });
    try {
      const hash = await fn(account);
      setStatus({ kind: 'pending', msg: 'Waiting for confirmation…', hash });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: 'ok', msg: 'Confirmed', hash });
      onDone();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setStatus({ kind: 'err', msg: raw.split('\n')[0].slice(0, 160) });
    }
  };
  return { status, run };
}

function TxStatus({ status }: { status: ReturnType<typeof useTx>['status'] }) {
  if (status.kind === 'idle') return null;
  const color = status.kind === 'err' ? 'text-red-500' : status.kind === 'ok' ? 'text-green-600' : 'text-suwappu-text-secondary';
  return (
    <p className={`mt-2 text-xs ${color}`}>
      {status.msg}
      {status.hash && (
        <>
          {' '}
          <a className="underline" href={txExplorer(status.hash)} target="_blank" rel="noreferrer">
            view tx
          </a>
        </>
      )}
    </p>
  );
}

async function ensureAllowance(account: Address, spender: Address, needed: bigint) {
  const allowance = (await publicClient.readContract({
    address: ADDR.reserveAsset,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, spender],
  })) as bigint;
  if (allowance >= needed) return;
  const wc = walletClient(account);
  const hash = await wc.writeContract({
    address: ADDR.reserveAsset,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

// ── Faucet (MockUSD public mint) ──
function Faucet({ account, onDone }: { account: Address | null; onDone: () => void }) {
  const { status, run } = useTx(onDone);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          run(account, (acct) => walletClient(acct).writeContract({ address: ADDR.reserveAsset, abi: erc20Abi, functionName: 'mint', args: [acct, parseUnits('10000')] }))
        }
        className="rounded-suwappu-pill glass px-4 py-2 text-sm font-semibold"
        title="Mint 10,000 test USDC to your wallet"
      >
        🚰 Faucet 10k USDC
      </button>
      <span className="sr-only">
        <TxStatus status={status} />
      </span>
    </>
  );
}

// ── TimeCurve ──
function CurveCard({ state, source, account, onDone }: { state: CurveState | null; source: Source; account: Address | null; onDone: () => void }) {
  const [amount, setAmount] = useState('10');
  const [quote, setQuote] = useState<{ side: 'buy' | 'sell'; value: bigint } | null>(null);
  const { status, run } = useTx(onDone);

  const doQuote = async (side: 'buy' | 'sell') => {
    try {
      const amt = parseUnits(amount);
      const value = (await publicClient.readContract({
        address: ADDR.timeCurve,
        abi: curveAbi,
        functionName: side === 'buy' ? 'quoteBuy' : 'quoteSell',
        args: [amt],
      })) as bigint;
      setQuote({ side, value });
    } catch {
      setQuote(null);
    }
  };

  const buy = () =>
    run(account, async (acct) => {
      const amt = parseUnits(amount);
      const cost = (await publicClient.readContract({ address: ADDR.timeCurve, abi: curveAbi, functionName: 'quoteBuy', args: [amt] })) as bigint;
      await ensureAllowance(acct, ADDR.timeCurve, cost);
      return walletClient(acct).writeContract({ address: ADDR.timeCurve, abi: curveAbi, functionName: 'buy', args: [amt, (cost * 101n) / 100n, MAX_DEADLINE] });
    });

  const sell = () =>
    run(account, async (acct) => {
      const amt = parseUnits(amount);
      return walletClient(acct).writeContract({ address: ADDR.timeCurve, abi: curveAbi, functionName: 'sell', args: [amt, 0n, MAX_DEADLINE] });
    });

  return (
    <Card title="Time-Locked Bonding Curve" subtitle="Continuous mint/burn — price = a pure function of time + supply" source={source}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Spot price" value={`${fmt(state?.spotPrice)} USDC`} />
        <Stat label="Multiplier m(t)" value={fmt(state?.multiplier)} />
        <Stat label="Reserve" value={`${fmt(state?.reserveBalance)} USDC`} />
        <Stat label="Supply (sCRV)" value={fmt(state?.totalSupply)} />
        <Stat label="Base price" value={fmt(state?.basePrice)} />
        <Stat label="Slope" value={fmt(state?.slope)} />
        <Stat label="Sink" value={`${fmt((state?.sinkRate ?? 0n) * 100n)}%`} />
        <Stat label="Total sunk" value={`${fmt(state?.totalSunk)} USDC`} />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-suwappu-text-secondary">Amount (sCRV)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => doQuote('buy')} inputMode="decimal" className="w-32 rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono" />
        </label>
        <button type="button" onClick={buy} className="rounded-suwappu-pill bg-suwappu-magenta px-5 py-2.5 text-sm font-semibold text-white shadow-suwappu-button">
          Buy
        </button>
        <button type="button" onClick={sell} className="rounded-suwappu-pill bg-suwappu-purple px-5 py-2.5 text-sm font-semibold text-white shadow-suwappu-button">
          Sell
        </button>
        <button type="button" onClick={() => doQuote('buy')} className="rounded-suwappu-pill glass px-4 py-2 text-sm">
          Quote buy
        </button>
        <button type="button" onClick={() => doQuote('sell')} className="rounded-suwappu-pill glass px-4 py-2 text-sm">
          Quote sell
        </button>
      </div>
      {quote && (
        <p className="mt-2 text-sm text-suwappu-text-secondary">
          {quote.side === 'buy' ? 'Cost to buy' : 'Proceeds to sell'} {amount} sCRV ≈{' '}
          <span className="font-mono font-semibold">{fmt(quote.value)} USDC</span>
        </p>
      )}
      <TxStatus status={status} />
    </Card>
  );
}

// ── AmortizingVault ──
function VaultCard({ state, source, account, onDone }: { state: VaultState | null; source: Source; account: Address | null; onDone: () => void }) {
  const [supplyAmt, setSupplyAmt] = useState('1000');
  const [posId, setPosId] = useState('0');
  const [pos, setPos] = useState<{ owner: string; shares: bigint; debt: bigint; pending: bigint } | null>(null);
  const supplyTx = useTx(onDone);

  const lookup = async () => {
    try {
      const id = BigInt(posId);
      const a = { address: ADDR.amortizingVault, abi: vaultAbi } as const;
      const [p, debt, pending] = await Promise.all([
        publicClient.readContract({ ...a, functionName: 'positions', args: [id] }),
        publicClient.readContract({ ...a, functionName: 'debtOf', args: [id] }),
        publicClient.readContract({ ...a, functionName: 'pendingYield', args: [id] }),
      ]);
      const [owner, shares] = p as readonly [Address, bigint, bigint, bigint];
      setPos({ owner, shares, debt: debt as bigint, pending: pending as bigint });
    } catch {
      setPos(null);
    }
  };

  const supply = () =>
    supplyTx.run(account, async (acct) => {
      const amt = parseUnits(supplyAmt);
      await ensureAllowance(acct, ADDR.amortizingVault, amt);
      return walletClient(acct).writeContract({ address: ADDR.amortizingVault, abi: vaultAbi, functionName: 'supply', args: [amt] });
    });

  const pct = (x: bigint | undefined) => `${fmt((x ?? 0n) * 100n)}%`;

  return (
    <Card title="Self-Repaying Vault" subtitle="Lend USDC, or borrow against yield-bearing collateral that repays itself" source={source}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Pool assets" value={`${fmt(state?.poolAssets)} USDC`} />
        <Stat label="Idle cash" value={`${fmt(state?.cash)} USDC`} />
        <Stat label="Total debt" value={`${fmt(state?.totalDebtAssets)} USDC`} />
        <Stat label="Positions" value={state ? state.nextPositionId.toString() : '—'} mono />
        <Stat label="Max LTV" value={pct(state?.maxLtv)} />
        <Stat label="Liq. LTV" value={pct(state?.liqLtv)} />
        <Stat label="Liq. bonus" value={pct(state?.liqBonus)} />
        <Stat label="Borrow rate/s" value={fmt(state?.borrowRate, 18, 12)} />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-suwappu-text-secondary">Supply (USDC)</span>
          <input value={supplyAmt} onChange={(e) => setSupplyAmt(e.target.value)} inputMode="decimal" className="w-32 rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono" />
        </label>
        <button type="button" onClick={supply} className="rounded-suwappu-pill bg-suwappu-magenta px-5 py-2.5 text-sm font-semibold text-white shadow-suwappu-button">
          Supply as lender
        </button>
      </div>
      <TxStatus status={supplyTx.status} />

      <div className="mt-5 border-t border-suwappu-sakura-light pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-suwappu-text-secondary">Position id</span>
            <input value={posId} onChange={(e) => setPosId(e.target.value)} inputMode="numeric" className="w-24 rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono" />
          </label>
          <button type="button" onClick={lookup} className="rounded-suwappu-pill glass px-4 py-2 text-sm font-semibold">
            Look up position
          </button>
        </div>
        {pos && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Owner" value={pos.owner === '0x0000000000000000000000000000000000000000' ? '—' : `${pos.owner.slice(0, 6)}…${pos.owner.slice(-4)}`} />
            <Stat label="Collateral" value={`${fmt(pos.shares)} sh`} />
            <Stat label="Debt" value={`${fmt(pos.debt)} USDC`} />
            <Stat label="Pending yield" value={`${fmt(pos.pending)} USDC`} />
          </div>
        )}
      </div>
    </Card>
  );
}

// ── MutualCredit ──
function CreditCard({ account, onDone }: { account: Address | null; onDone: () => void }) {
  const [debtor, setDebtor] = useState('');
  const [creditor, setCreditor] = useState('');
  const [owed, setOwed] = useState<{ value: bigint; source: Source } | null>(null);
  const [payTo, setPayTo] = useState('');
  const [payAmt, setPayAmt] = useState('100');
  const payTx = useTx(onDone);

  useEffect(() => {
    if (account && !debtor) setDebtor(account);
  }, [account, debtor]);

  const lookup = async () => {
    if (!debtor || !creditor) return;
    const r = await readBoth<bigint>(
      `/credit/owed?debtor=${debtor}&creditor=${creditor}`,
      (j) => BigInt(j.owed),
      async () =>
        (await publicClient.readContract({
          address: ADDR.mutualCredit,
          abi: creditAbi,
          functionName: 'owedBy',
          args: [debtor as Address, creditor as Address, ADDR.reserveAsset],
        })) as bigint,
    );
    setOwed({ value: r.value, source: r.source });
  };

  const pay = () =>
    payTx.run(account, (acct) =>
      walletClient(acct).writeContract({ address: ADDR.mutualCredit, abi: creditAbi, functionName: 'pay', args: [payTo as Address, ADDR.reserveAsset, parseUnits(payAmt)] }),
    );

  return (
    <Card title="Mutual Credit Network" subtitle="Bilateral credit lines + multilateral netting — no collateral, no oracle">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-suwappu-text-secondary">Debtor</span>
          <input value={debtor} onChange={(e) => setDebtor(e.target.value)} placeholder="0x…" className="w-64 rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono text-xs" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-suwappu-text-secondary">Creditor</span>
          <input value={creditor} onChange={(e) => setCreditor(e.target.value)} placeholder="0x…" className="w-64 rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono text-xs" />
        </label>
        <button type="button" onClick={lookup} className="rounded-suwappu-pill glass px-4 py-2 text-sm font-semibold">
          Check owed
        </button>
      </div>
      {owed && (
        <p className="mt-2 text-sm">
          Owed: <span className="font-mono font-semibold">{fmt(owed.value)} USDC</span>{' '}
          <span className="ml-1 align-middle">
            <SourceBadge source={owed.source} />
          </span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-suwappu-sakura-light pt-4">
        <label className="text-sm">
          <span className="mb-1 block text-suwappu-text-secondary">Pay (via credit) to</span>
          <input value={payTo} onChange={(e) => setPayTo(e.target.value)} placeholder="0x… counterparty" className="w-64 rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono text-xs" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-suwappu-text-secondary">Amount</span>
          <input value={payAmt} onChange={(e) => setPayAmt(e.target.value)} inputMode="decimal" className="w-28 rounded-xl border border-suwappu-sakura-mid bg-white px-3 py-2 font-mono" />
        </label>
        <button type="button" onClick={pay} className="rounded-suwappu-pill bg-suwappu-magenta px-5 py-2.5 text-sm font-semibold text-white shadow-suwappu-button">
          Pay on line
        </button>
      </div>
      <p className="mt-1 text-xs text-suwappu-text-secondary">Requires an active line between you and the counterparty (propose → accept), within its limit.</p>
      <TxStatus status={payTx.status} />
    </Card>
  );
}
