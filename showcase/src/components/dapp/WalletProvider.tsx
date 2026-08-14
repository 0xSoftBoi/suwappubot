'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Address, type WalletClient, createWalletClient, custom, getAddress } from 'viem';
import { CHAIN, CHAIN_ID_HEX, RPC_URLS, setWalletTransport } from '@/lib/dapp/config';
import { supportsAtomicBatch } from '@/lib/dapp/eip5792';

/** EIP-1193 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}

/** EIP-6963 announced provider */
export interface WalletDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

interface WalletState {
  wallets: WalletDetail[];
  account: Address | null;
  chainId: number | null;
  connecting: boolean;
  activeRdns: string | null;
  isWrongNetwork: boolean;
  /** Wallet supports EIP-5792 atomic batching (approve + action in one signature). */
  atomicBatch: boolean;
  connect: (w: WalletDetail) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  getWalletClient: () => WalletClient;
  getProvider: () => Eip1193Provider | null;
}

const Ctx = createContext<WalletState | null>(null);
const LAST_WALLET_KEY = 'suwappu.wallet.rdns';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<WalletDetail[]>([]);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [activeRdns, setActiveRdns] = useState<string | null>(null);
  const [atomicBatch, setAtomicBatch] = useState(false);
  const providerRef = useRef<Eip1193Provider | null>(null);

  // ── EIP-6963 discovery ────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<WalletDetail>).detail;
      if (!detail?.info?.rdns) return;
      setWallets((prev) =>
        prev.some((w) => w.info.rdns === detail.info.rdns) ? prev : [...prev, detail],
      );
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Fallback for wallets that never implemented EIP-6963.
    const legacy = (window as any).ethereum as Eip1193Provider | undefined;
    if (legacy) {
      setWallets((prev) =>
        prev.length
          ? prev
          : [
              {
                info: {
                  uuid: 'legacy-injected',
                  name: 'Browser Wallet',
                  icon: '',
                  rdns: 'legacy.injected',
                },
                provider: legacy,
              },
            ],
      );
    }
    return () =>
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
  }, []);

  const bindEvents = useCallback((provider: Eip1193Provider) => {
    const onAccounts = (accts: string[]) => {
      if (!accts?.length) {
        setAccount(null);
        setActiveRdns(null);
        providerRef.current = null;
        try {
          localStorage.removeItem(LAST_WALLET_KEY);
        } catch {}
      } else {
        setAccount(getAddress(accts[0]));
      }
    };
    const onChain = (id: string) => setChainId(Number.parseInt(id, 16));
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, []);

  const activate = useCallback(
    async (w: WalletDetail, requestAccounts: boolean) => {
      const p = w.provider;
      const accounts = (await p.request({
        method: requestAccounts ? 'eth_requestAccounts' : 'eth_accounts',
      })) as string[];
      if (!accounts?.length) return false;
      const id = (await p.request({ method: 'eth_chainId' })) as string;
      const addr = getAddress(accounts[0]);
      providerRef.current = p;
      setAccount(addr);
      setChainId(Number.parseInt(id, 16));
      setActiveRdns(w.info.rdns);
      // Read through the wallet from here on — no RPC infrastructure needed.
      setWalletTransport(p);
      // Feature-detect atomic batching (EIP-5792).
      void supportsAtomicBatch(p, addr)
        .then(setAtomicBatch)
        .catch(() => setAtomicBatch(false));
      try {
        localStorage.setItem(LAST_WALLET_KEY, w.info.rdns);
      } catch {}
      bindEvents(p);
      return true;
    },
    [bindEvents],
  );

  // ── silent reconnect ──────────────────────────────────────────────────────
  useEffect(() => {
    if (account || !wallets.length) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET_KEY);
    } catch {}
    if (!last) return;
    const w = wallets.find((x) => x.info.rdns === last);
    if (w) void activate(w, false).catch(() => {});
  }, [wallets, account, activate]);

  const connect = useCallback(
    async (w: WalletDetail) => {
      setConnecting(true);
      try {
        await activate(w, true);
      } finally {
        setConnecting(false);
      }
    },
    [activate],
  );

  const disconnect = useCallback(() => {
    setAccount(null);
    setActiveRdns(null);
    setAtomicBatch(false);
    providerRef.current = null;
    setWalletTransport(undefined); // back to the public endpoints
    try {
      localStorage.removeItem(LAST_WALLET_KEY);
    } catch {}
  }, []);

  const switchNetwork = useCallback(async () => {
    const p = providerRef.current;
    if (!p) return;
    try {
      await p.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch (err) {
      // 4902 = chain unknown to the wallet → add it.
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.nativeCurrency,
            rpcUrls: RPC_URLS,
            blockExplorerUrls: [CHAIN.blockExplorers?.default.url],
          },
        ],
      });
    }
  }, []);

  const getWalletClient = useCallback((): WalletClient => {
    const p = providerRef.current;
    if (!p) throw new Error('Wallet not connected.');
    if (!account) throw new Error('No account selected.');
    return createWalletClient({ account, chain: CHAIN, transport: custom(p as any) });
  }, [account]);

  const getProvider = useCallback(() => providerRef.current, []);

  const value = useMemo<WalletState>(
    () => ({
      wallets,
      account,
      chainId,
      connecting,
      activeRdns,
      atomicBatch,
      isWrongNetwork: account !== null && chainId !== null && chainId !== CHAIN.id,
      connect,
      disconnect,
      switchNetwork,
      getWalletClient,
      getProvider,
    }),
    [
      wallets, account, chainId, connecting, activeRdns, atomicBatch,
      connect, disconnect, switchNetwork, getWalletClient, getProvider,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used inside <WalletProvider>');
  return v;
}
