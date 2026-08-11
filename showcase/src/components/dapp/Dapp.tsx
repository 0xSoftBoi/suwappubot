'use client';

import { maxUint256 } from 'viem';
import { erc20Abi } from '@/lib/dapp/abis';
import { CHAIN, CONTRACTS, addressUrl } from '@/lib/dapp/config';
import { fmt, parseAmount } from '@/lib/dapp/format';
import { useAccountData, useBlockSync } from '@/hooks/useProtocol';
import { ConnectButton } from './ConnectButton';
import { CreditPanel } from './CreditPanel';
import { CurvePanel } from './CurvePanel';
import { SettingsPopover } from './SettingsProvider';
import { useTx } from './TxProvider';
import { Button } from './ui';
import { VaultPanel } from './VaultPanel';
import { useWallet } from './WalletProvider';

export function Dapp() {
  useBlockSync();
  const { account, isWrongNetwork, switchNetwork } = useWallet();

  return (
    <main className="min-h-screen bg-suwappu-bg text-suwappu-text font-body">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-6">
          <a href="/" className="text-sm text-suwappu-magenta hover:underline">
            ← suwappu
          </a>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-3xl font-bold gradient-text sm:text-4xl">
                Primitives
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-suwappu-text-secondary">
                Three immutable, oracle-free money legos on {CHAIN.name}. No owner, no pause, no
                upgrade path.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SettingsPopover />
              <ConnectButton />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-suwappu-pill bg-suwappu-warning/50 px-3 py-1 text-xs font-semibold text-suwappu-magenta-mid">
              ⚠ Testnet · unaudited immutable contracts · not for real funds
            </span>
            <Faucet />
          </div>

          {isWrongNetwork && (
            <div
              role="alert"
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-suwappu-xl border border-red-300 bg-red-50 px-4 py-3"
            >
              <span className="text-sm font-semibold text-red-700">
                Wrong network — switch to {CHAIN.name} to transact.
              </span>
              <Button variant="danger" onClick={switchNetwork}>
                Switch network
              </Button>
            </div>
          )}
        </header>

        <div className="grid gap-5">
          <CurvePanel />
          <VaultPanel />
          <CreditPanel />
        </div>

        <footer className="mt-10 border-t border-suwappu-sakura-light pt-4 text-xs text-suwappu-text-secondary">
          <p className="mb-2 font-semibold">Deployed contracts ({CHAIN.name})</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {(
              [
                ['Time curve', CONTRACTS.timeCurve],
                ['Amortizing vault', CONTRACTS.amortizingVault],
                ['Mutual credit', CONTRACTS.mutualCredit],
                ['Test USDC', CONTRACTS.reserveAsset],
                ['Yield vault (ERC-4626)', CONTRACTS.collateralVault],
              ] as const
            ).map(([label, addr]) => (
              <li key={addr}>
                {label}:{' '}
                <a
                  href={addressUrl(addr)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-suwappu-magenta hover:underline"
                >
                  {addr.slice(0, 10)}…{addr.slice(-6)}
                </a>
              </li>
            ))}
          </ul>
        </footer>
      </div>
    </main>
  );
}

/** Test-token faucet — MockUSD exposes a public mint() on testnet. */
function Faucet() {
  const { account } = useWallet();
  const { data: acct } = useAccountData(account);
  const { send, busy } = useTx();
  if (!account) return null;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          send({
            label: 'Mint 10,000 test USDC',
            address: CONTRACTS.reserveAsset,
            abi: erc20Abi,
            functionName: 'mint',
            args: [account, parseAmount('10000') as bigint],
          })
        }
        className="rounded-suwappu-pill glass px-3 py-1 text-xs font-semibold disabled:opacity-50"
      >
        🚰 Get 10k test USDC
      </button>
      <span className="text-xs text-suwappu-text-secondary">
        Balance: <span className="font-mono">{fmt(acct?.usdc, 18, { compact: true })}</span> USDC ·{' '}
        <span className="font-mono">{fmt(acct?.eth, 18, { dp: 4 })}</span> ETH
      </span>
    </div>
  );
}
