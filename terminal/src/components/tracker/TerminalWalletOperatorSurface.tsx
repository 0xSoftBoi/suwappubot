import type {
  TrackedWallet,
  WalletActivity,
  WalletStats,
} from "../../types/api";
import {
  TerminalButton,
  TerminalSegmentedTabs,
  TerminalTextField,
  TerminalTokenPill,
} from "../foundation/TerminalControls";
import {
  TerminalChainBadge,
  TerminalKeyValueRow,
} from "../foundation/TerminalDataDisplay";
import {
  TerminalEmptyState,
  TerminalInset,
  TerminalMetricCard,
  TerminalStatusPill,
} from "../foundation/TerminalPrimitives";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatSignedUsd(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatUsd(value)}`;
}

function timeAgo(timestamp: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 1000,
  );

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function qualityTone(stats?: WalletStats): "neutral" | "warm" | "sky" {
  if (!stats) return "neutral";
  if (stats.pnl7d >= 0 && stats.winRate >= 60) return "sky";
  if (stats.pnl7d < 0) return "warm";
  return "neutral";
}

function activityTone(activity: WalletActivity): "warm" | "sky" {
  return activity.action === "buy" ? "sky" : "warm";
}

export type TerminalWalletOperatorMode = "focused" | "market";

type TerminalWalletOperatorSurfaceProps = {
  wallets: TrackedWallet[];
  statsMap: Record<string, WalletStats | undefined>;
  activities: WalletActivity[];
  selectedAddress: string;
  onSelectAddress: (address: string) => void;
  mode: TerminalWalletOperatorMode;
  onModeChange: (mode: TerminalWalletOperatorMode) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onPrimaryAction?: (wallet: TrackedWallet) => void;
  onSecondaryAction?: (wallet: TrackedWallet) => void;
};

export function TerminalWalletOperatorSurface({
  wallets,
  statsMap,
  activities,
  selectedAddress,
  onSelectAddress,
  mode,
  onModeChange,
  query,
  onQueryChange,
  onPrimaryAction,
  onSecondaryAction,
}: TerminalWalletOperatorSurfaceProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredWallets = wallets.filter((wallet) => {
    if (!normalizedQuery) return true;

    return (
      wallet.label?.toLowerCase().includes(normalizedQuery) ||
      wallet.address.toLowerCase().includes(normalizedQuery) ||
      wallet.chain.toLowerCase().includes(normalizedQuery)
    );
  });

  const selectedWallet =
    filteredWallets.find((wallet) => wallet.address === selectedAddress) ??
    wallets.find((wallet) => wallet.address === selectedAddress) ??
    filteredWallets[0] ??
    wallets[0];
  const selectedStats = selectedWallet
    ? statsMap[selectedWallet.address]
    : undefined;

  const visibleActivities = [...activities]
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() -
        new Date(left.timestamp).getTime(),
    )
    .filter((activity) =>
      mode === "market" || !selectedWallet
        ? true
        : activity.walletAddress === selectedWallet.address,
    )
    .slice(0, 7);

  if (!selectedWallet) {
    return (
      <TerminalEmptyState
        title="No tracked wallets"
        description="Add a wallet seed to the fixture pack before composing the operator surface."
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.78fr_1.22fr]">
      <TerminalInset className="grid gap-3 self-start">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
              Wallet queue
            </div>
            <div className="mt-1 text-sm font-semibold text-terminal-text">
              Operator shortlist
            </div>
          </div>
          <TerminalStatusPill tone={mode === "market" ? "warm" : "sky"}>
            {mode === "market" ? "market tape" : "focused view"}
          </TerminalStatusPill>
        </div>

        <TerminalSegmentedTabs
          activeId={mode}
          onChange={(value) =>
            onModeChange(value as TerminalWalletOperatorMode)
          }
          options={[
            { id: "focused", label: "Focused", meta: "selected wallet" },
            { id: "market", label: "Market", meta: "all activity" },
          ]}
        />

        <TerminalTextField
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search wallet, chain, or address"
        />

        <div className="grid gap-2">
          {filteredWallets.length > 0 ? (
            filteredWallets.map((wallet) => {
              const stats = statsMap[wallet.address];
              const active = wallet.address === selectedWallet.address;

              return (
                <button
                  key={wallet.address}
                  onClick={() => onSelectAddress(wallet.address)}
                  className={joinClasses(
                    "terminal-theme-card px-[var(--terminal-space-card)] py-[var(--terminal-space-card)] text-left transition-all duration-150",
                    active
                      ? "border-terminal-border-active bg-white [box-shadow:var(--terminal-shadow-raised)]"
                      : "hover:border-terminal-border-active hover:[box-shadow:var(--terminal-shadow-raised)]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-terminal-text">
                        {wallet.label || truncateAddress(wallet.address)}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-terminal-text-muted">
                        {truncateAddress(wallet.address)}
                      </div>
                    </div>
                    <TerminalChainBadge chain={wallet.chain} />
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                        7d
                      </div>
                      <div
                        className={joinClasses(
                          "mt-1 font-mono font-semibold",
                          stats && stats.pnl7d >= 0 ? "text-bull" : "text-bear",
                        )}
                      >
                        {stats ? formatSignedUsd(stats.pnl7d) : "--"}
                      </div>
                    </div>
                    <div>
                      <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                        Win
                      </div>
                      <div className="mt-1 font-mono font-semibold text-terminal-text">
                        {stats ? `${stats.winRate}%` : "--"}
                      </div>
                    </div>
                    <div>
                      <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                        Trades
                      </div>
                      <div className="mt-1 font-mono font-semibold text-terminal-text">
                        {stats ? stats.totalTrades : "--"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <TerminalEmptyState
              title="No wallets match"
              description="Try a label, chain, or address fragment to pull a wallet back into the operator queue."
            />
          )}
        </div>
      </TerminalInset>

      <div className="grid gap-4">
        <TerminalInset className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                Wallet operator
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="terminal-theme-heading text-2xl font-semibold text-terminal-text">
                  {selectedWallet.label || "Selected wallet"}
                </h3>
                <TerminalChainBadge chain={selectedWallet.chain} />
                <span className="terminal-theme-japanese terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                  監視中
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-terminal-text-secondary">
                <span className="font-mono">
                  {truncateAddress(selectedWallet.address)}
                </span>
                <span className="h-1 w-1 rounded-full bg-terminal-border-active" />
                <span>Added {timeAgo(selectedWallet.addedAt)}</span>
                <span className="h-1 w-1 rounded-full bg-terminal-border-active" />
                <span>
                  {mode === "market"
                    ? "watching global flow"
                    : "focused monitoring"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <TerminalButton
                variant="secondary"
                size="sm"
                onClick={() => onSecondaryAction?.(selectedWallet)}
              >
                Open tape
              </TerminalButton>
              <TerminalButton
                size="sm"
                onClick={() => onPrimaryAction?.(selectedWallet)}
              >
                Stage action
              </TerminalButton>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <TerminalMetricCard
              label="7d pnl"
              value={
                selectedStats ? formatSignedUsd(selectedStats.pnl7d) : "--"
              }
              detail="recent operator edge"
              tone={qualityTone(selectedStats)}
            />
            <TerminalMetricCard
              label="30d pnl"
              value={
                selectedStats ? formatSignedUsd(selectedStats.pnl30d) : "--"
              }
              detail="sustained result"
              tone={qualityTone(selectedStats)}
            />
            <TerminalMetricCard
              label="Win rate"
              value={selectedStats ? `${selectedStats.winRate}%` : "--"}
              detail="closed trade accuracy"
              tone="neutral"
            />
            <TerminalMetricCard
              label="Trades"
              value={selectedStats ? `${selectedStats.totalTrades}` : "--"}
              detail="tracked executions"
              tone="sky"
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
            <TerminalInset className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                  Holdings stack
                </div>
                <TerminalStatusPill tone={qualityTone(selectedStats)}>
                  {selectedStats && selectedStats.pnl7d >= 0
                    ? "capital live"
                    : "monitor"}
                </TerminalStatusPill>
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedStats?.topHoldings.map((holding) => (
                  <TerminalTokenPill
                    key={`${selectedWallet.address}-${holding.symbol}`}
                    symbol={holding.symbol}
                    label={formatUsd(holding.valueUsd)}
                    tone={holding.symbol === "USDC" ? "sky" : "neutral"}
                  />
                ))}
              </div>

              <TerminalKeyValueRow
                label="Primary posture"
                value={
                  selectedStats && selectedStats.winRate >= 60
                    ? "size ready"
                    : "monitor first"
                }
                detail="This row translates wallet behavior into an operator recommendation."
              />
              <TerminalKeyValueRow
                label="Dry powder"
                value={
                  selectedStats?.topHoldings.find(
                    (holding) => holding.symbol === "USDC",
                  )
                    ? "stablecoin reserve"
                    : "risk-heavy"
                }
                detail="The wallet slice should surface deployment posture, not just balances."
              />
            </TerminalInset>

            <TerminalInset className="grid gap-2">
              <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                Operator notes
              </div>
              <TerminalKeyValueRow
                label="Most active lane"
                value={selectedWallet.chain}
                detail="The chain badge and lane summary should stay visible during selection changes."
              />
              <TerminalKeyValueRow
                label="Review cadence"
                value={mode === "market" ? "cross-wallet" : "single wallet"}
                detail="Switching between focused and market views should feel like one desk, not two different screens."
              />
              <TerminalKeyValueRow
                label="Suggested next move"
                value={
                  selectedStats && selectedStats.pnl7d >= 0
                    ? "clone best setup"
                    : "tighten risk"
                }
                detail="This is the kind of recommendation we can later hand to copilot and execution."
              />
            </TerminalInset>
          </div>
        </TerminalInset>

        <TerminalInset className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                Activity tape
              </div>
              <div className="mt-1 text-sm font-semibold text-terminal-text">
                {mode === "market"
                  ? "Cross-wallet flow"
                  : "Selected wallet flow"}
              </div>
            </div>
            <TerminalStatusPill tone="neutral">
              {visibleActivities.length} prints
            </TerminalStatusPill>
          </div>

          <div className="grid gap-2">
            {visibleActivities.map((activity) => (
              <div
                key={activity.id}
                className="terminal-theme-card grid gap-2 px-[var(--terminal-space-card)] py-[var(--terminal-space-card)] md:grid-cols-[1.1fr_0.75fr_0.75fr]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <TerminalStatusPill tone={activityTone(activity)}>
                      {activity.action}
                    </TerminalStatusPill>
                    <span className="truncate text-sm font-semibold text-terminal-text">
                      {activity.walletLabel ||
                        truncateAddress(activity.walletAddress)}
                    </span>
                    <TerminalChainBadge chain={activity.chain} />
                  </div>
                  <div className="mt-1 text-xs text-terminal-text-secondary">
                    {activity.tokenSymbol} at {timeAgo(activity.timestamp)}
                  </div>
                </div>

                <div>
                  <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                    Notional
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-terminal-text">
                    {formatUsd(activity.amount)}
                  </div>
                </div>

                <div>
                  <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                    Price
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-terminal-text">
                    $
                    {activity.priceUsd.toFixed(activity.priceUsd >= 10 ? 2 : 3)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TerminalInset>
      </div>
    </div>
  );
}
