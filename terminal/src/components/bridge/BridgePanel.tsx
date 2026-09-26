import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  TerminalButton,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalTextField,
} from "../foundation";
import { useAuth } from "../../contexts/AuthContext";
import { useBridgeRoutes } from "../../hooks/useBridgeRoutes";
import type { BridgeRoute } from "../../types/bridge";
import { BridgeRouteList } from "./BridgeRouteList";
import {
  SETTLEMENT_COPY,
  TRUST_COPY,
  chainLabel,
  guaranteedShortfall,
} from "./custody";

/**
 * The bridge flow.
 *
 * Deliberately not a swap panel with an extra chain dropdown. A swap resolves
 * in one transaction; a bridge has a middle — a window where the value is on
 * neither chain — and the whole layout is organised around making that window
 * legible before the user commits, and then visible while they wait.
 */

/** Chains with a verified cross-chain rail. Kept explicit rather than derived
 *  from a chain registry: offering a pair we cannot actually route is worse
 *  than offering fewer pairs. */
const BRIDGE_CHAINS = [
  "ethereum",
  "arbitrum",
  "base",
  "optimism",
  "polygon",
  "avalanche",
  "plasma",
  "hyperevm",
] as const;

const BRIDGE_TOKENS = ["USDC", "USDT"] as const;

interface Props {
  /** Spot price of the selected token, for ranking on net value. */
  tokenPriceUsd?: number;
  /** Hand off the chosen route to whatever performs signing. */
  onConfirm?: (route: BridgeRoute) => void;
  /** True while the wallet is being prompted / the transfer is starting. */
  isSubmitting?: boolean;
  /** Why the last attempt failed, rendered next to the button that caused it. */
  failureDetail?: string | null;
}

export function BridgePanel({
  tokenPriceUsd = 1,
  onConfirm,
  isSubmitting = false,
  failureDetail = null,
}: Props) {
  const [fromChain, setFromChain] = useState<string>("arbitrum");
  const [toChain, setToChain] = useState<string>("base");
  const [token, setToken] = useState<string>("USDC");
  const [amount, setAmount] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  // The quote endpoint validates from_address against the destination chain's
  // format and rejects the request when it's absent — omitting it here is what
  // made every routes request come back empty ("can't bridge"). Send the
  // connected wallet's address; the server quotes with a sentinel when no
  // wallet is connected yet.
  const { address } = useAccount();
  const { signInWithWallet } = useAuth();

  const request = useMemo(
    () => ({ fromChain, toChain, token, amount, fromAddress: address }),
    [fromChain, toChain, token, amount, address],
  );

  const { data, isFetching, error } = useBridgeRoutes(request);
  const routes = data?.routes ?? [];

  const selected = routes.find((route) => route.provider === selectedProvider) ?? null;

  const swapDirection = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setSelectedProvider(null);
  };

  const sameChain = fromChain === toChain;

  return (
    <TerminalPanel className="flex h-full min-h-0 flex-col">
      <TerminalPanelHeader
        eyebrow="Cross-chain"
        title="Bridge"
        description="Move a token between chains. Routes differ in who holds your funds in transit, not just in price."
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <ChainSelect
            label="From"
            value={fromChain}
            onChange={(next) => {
              setFromChain(next);
              setSelectedProvider(null);
            }}
          />
          <TerminalButton
            variant="ghost"
            size="sm"
            onClick={swapDirection}
            aria-label="Reverse direction"
            title="Reverse direction"
            className="mb-0.5"
          >
            ⇄
          </TerminalButton>
          <ChainSelect
            label="To"
            value={toChain}
            onChange={(next) => {
              setToChain(next);
              setSelectedProvider(null);
            }}
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <TerminalTextField
            label="Amount"
            mono
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setSelectedProvider(null);
            }}
          />
          <TokenSelect
            value={token}
            onChange={(next) => {
              setToken(next);
              setSelectedProvider(null);
            }}
          />
        </div>

        {sameChain ? (
          <p className="text-[11px] leading-[1.45] text-terminal-text-secondary">
            Pick two different chains. To trade within one chain, use swap.
          </p>
        ) : null}

        {error ? (
          <p className="text-[11px] leading-[1.45] text-terminal-text">
            Could not load routes. Check your connection and try again.
          </p>
        ) : null}

        {!sameChain && amount ? (
          <section aria-label="Available routes" className="space-y-2">
            <h3 className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Routes
            </h3>
            <BridgeRouteList
              routes={routes}
              selectedProvider={selectedProvider}
              onSelect={(route) => setSelectedProvider(route.provider)}
              tokenPriceUsd={tokenPriceUsd}
              isLoading={isFetching && routes.length === 0}
            />
          </section>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-3 space-y-2 border-t border-terminal-border pt-3">
          {/* Restate the whole trade at the moment of commitment: what leaves,
              what is guaranteed to arrive, and where. The route row said it
              once, but the button is where the user actually decides. */}
          <ConfirmSummary route={selected} amount={amount} />
          {/* The rows carry the category; the explanation lands once, here,
              for the route actually chosen. */}
          <p className="text-[11px] leading-[1.45] text-terminal-text-secondary">
            {TRUST_COPY[selected.trustModel].summary}{" "}
            {SETTLEMENT_COPY[selected.settlement]}
          </p>
          {address ? (
            <TerminalButton
              className="w-full"
              onClick={() => onConfirm?.(selected)}
              disabled={!onConfirm || isSubmitting}
            >
              {isSubmitting
                ? "Confirm in your wallet…"
                : selected.settlement === "deposit_address"
                  ? "Get deposit address"
                  : `Bridge to ${chainLabel(selected.toChain)}`}
            </TerminalButton>
          ) : (
            // Say what is missing instead of failing after the click. The
            // route list stays browsable without a wallet; only the commit
            // needs one.
            <TerminalButton
              className="w-full"
              onClick={() => void signInWithWallet()}
            >
              Connect wallet to bridge
            </TerminalButton>
          )}
          {failureDetail ? (
            <p
              role="alert"
              className="text-[11px] leading-[1.45] text-terminal-text"
            >
              {failureDetail}
            </p>
          ) : null}
          {/* Two signatures on rails that lock rather than mint — say so before
              the first prompt, not between them. */}
          {address && selected.settlement !== "deposit_address" ? (
            <p className="text-[10px] leading-[1.4] text-terminal-text-muted">
              You may be asked to approve the token first, then to confirm the
              transfer.
            </p>
          ) : null}
        </div>
      ) : null}
    </TerminalPanel>
  );
}

function ConfirmSummary({
  route,
  amount,
}: {
  route: BridgeRoute;
  amount: string;
}) {
  const shortfall = guaranteedShortfall(route);
  const minHuman =
    shortfall > 0 ? route.toAmountHuman * (1 - shortfall) : route.toAmountHuman;
  const format = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 6 });

  return (
    <p className="text-[12px] leading-[1.5] text-terminal-text">
      Send{" "}
      <span className="tnum font-mono">
        {amount} {route.token}
      </span>{" "}
      on {chainLabel(route.fromChain)} →{" "}
      {shortfall > 0 ? "at least " : ""}
      <span className="tnum font-mono">
        {format(minHuman)} {route.token}
      </span>{" "}
      on {chainLabel(route.toChain)}.
    </p>
  );
}

function ChainSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-0.5">
      <span className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="terminal-theme-control w-full bg-transparent px-2.5 py-1.5 text-[13px] text-terminal-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terminal-accent"
      >
        {BRIDGE_CHAINS.map((chain) => (
          <option key={chain} value={chain}>
            {chainLabel(chain)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TokenSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-0.5">
      <span className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
        Token
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="terminal-theme-control bg-transparent px-2.5 py-1.5 text-[13px] text-terminal-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terminal-accent"
      >
        {BRIDGE_TOKENS.map((symbol) => (
          <option key={symbol} value={symbol}>
            {symbol}
          </option>
        ))}
      </select>
    </label>
  );
}
