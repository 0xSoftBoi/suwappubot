'use client';

import { useEffect, useState } from 'react';
import { CHAIN, addressUrl } from '@/lib/dapp/config';
import { shortAddress } from '@/lib/dapp/format';
import { Button } from './ui';
import { useWallet } from './WalletProvider';

export function ConnectButton() {
  const { wallets, account, connect, disconnect, connecting, isWrongNetwork, switchNetwork } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  // Close on Escape.
  useEffect(() => {
    if (!open && !menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setMenu(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, menu]);

  if (account) {
    return (
      <div className="relative flex items-center gap-2">
        {isWrongNetwork && (
          <Button variant="danger" onClick={switchNetwork}>
            Switch to {CHAIN.name}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setMenu((m) => !m)}>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-suwappu-success align-middle" />
          {shortAddress(account)}
        </Button>
        {menu && (
          <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-suwappu-xl border border-suwappu-sakura-mid bg-white p-2 shadow-suwappu-card">
            <a
              href={addressUrl(account)}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg px-3 py-2 text-sm hover:bg-suwappu-blush"
            >
              View on BaseScan ↗
            </a>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(account);
                setMenu(false);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-suwappu-blush"
            >
              Copy address
            </button>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setMenu(false);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={connecting}>
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Connect a wallet"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-suwappu-xl bg-white p-5 shadow-suwappu-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Connect a wallet</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-suwappu-text-secondary hover:text-suwappu-text"
              >
                ✕
              </button>
            </div>

            {wallets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-suwappu-sakura-mid p-4 text-sm text-suwappu-text-secondary">
                No browser wallet detected. Install{' '}
                <a
                  className="text-suwappu-magenta underline"
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noreferrer"
                >
                  MetaMask
                </a>{' '}
                (or Rabby / Coinbase Wallet) and reload.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {wallets.map((w) => (
                  <li key={w.info.rdns}>
                    <button
                      type="button"
                      onClick={async () => {
                        await connect(w);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-suwappu-sakura-mid px-3 py-2.5 text-left transition hover:bg-suwappu-blush"
                    >
                      {w.info.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={w.info.icon} alt="" className="h-6 w-6 rounded" />
                      ) : (
                        <span className="h-6 w-6 rounded bg-suwappu-sakura-light" />
                      )}
                      <span className="text-sm font-semibold">{w.info.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-suwappu-text-secondary">
              Connects to {CHAIN.name} (testnet). We never ask for your seed phrase.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
