import { TerminalInset, TerminalKeyValueRow, TerminalStatusPill } from "../foundation";
import type { BridgeTransfer } from "../../types/bridge";
import { CustodyTimeline } from "./CustodyTimeline";
import { STATE_COPY, TRUST_COPY, formatDuration } from "./custody";

/**
 * One in-flight or finished transfer.
 *
 * The design job here is to be trustworthy while the news is bad. During the
 * transit window the user's funds are on neither chain, and a spinner labelled
 * "processing" is not an honest description of that. So the state line says
 * where the value actually is, and when something is stuck it says whether the
 * system will recover on its own or whether a person has to act.
 */

interface Props {
  transfer: BridgeTransfer;
  /** Called for a terminal failure, where the user cannot do anything alone. */
  onContactSupport?: (transfer: BridgeTransfer) => void;
}

export function BridgeTransferCard({ transfer, onContactSupport }: Props) {
  const stateCopy = STATE_COPY[transfer.state];
  const trust = TRUST_COPY[transfer.trustModel];

  const elapsedSeconds = Math.max(
    0,
    (Date.parse(transfer.updatedAt) - Date.parse(transfer.startedAt)) / 1000,
  );
  const isOverdue =
    !stateCopy.settled && elapsedSeconds > transfer.estimatedTime * 2;

  return (
    <TerminalInset className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-terminal-text">
            {transfer.amountHuman.toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}{" "}
            {transfer.token}
          </div>
          <div className="mt-0.5 text-[11px] text-terminal-text-secondary">
            {transfer.fromChain} → {transfer.toChain} · {transfer.provider}
          </div>
        </div>
        <TerminalStatusPill tone={stateCopy.tone}>
          {stateCopy.label}
        </TerminalStatusPill>
      </div>

      <CustodyTimeline
        state={transfer.state}
        settlement={transfer.settlement}
        trustModel={transfer.trustModel}
        fromChain={transfer.fromChain}
        toChain={transfer.toChain}
      />

      {/* Deposit-address rails: the address IS the action, so it leads. */}
      {transfer.state === "awaiting_deposit" && transfer.depositAddress ? (
        <div className="hairline rounded-[var(--terminal-radius-card)] bg-terminal-bg px-3 py-2.5">
          <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
            Send {transfer.token} on {transfer.fromChain} to
          </div>
          <div className="mt-1 break-all font-mono text-[12px] text-terminal-text">
            {transfer.depositAddress}
          </div>
          <p className="mt-1.5 text-[11px] leading-[1.45] text-terminal-text-secondary">
            This address is for this transfer only. Send the exact amount —
            anything else may not be filled.
          </p>
        </div>
      ) : null}

      {/* Only surface the detail line when it adds something the timeline
          didn't already say. */}
      {transfer.statusDetail ? (
        <p className="text-[11px] leading-[1.45] text-terminal-text-secondary">
          {transfer.statusDetail}
        </p>
      ) : null}

      <div className="space-y-1">
        <TerminalKeyValueRow label="Trusting" value={trust.label} />
        <TerminalKeyValueRow
          label={stateCopy.settled ? "Took" : "Elapsed"}
          value={formatDuration(elapsedSeconds)}
        />
        {!stateCopy.settled ? (
          <TerminalKeyValueRow
            label="Expected"
            value={formatDuration(transfer.estimatedTime)}
          />
        ) : null}
      </div>

      {/* Taking much longer than quoted is worth saying out loud, without
          implying the funds are lost — they usually are not. */}
      {isOverdue ? (
        <p className="text-[11px] leading-[1.45] text-terminal-text">
          This is taking longer than the {formatDuration(transfer.estimatedTime)}{" "}
          estimate. Transfers in this state normally still complete.
        </p>
      ) : null}

      {transfer.state === "failed" && onContactSupport ? (
        <button
          type="button"
          onClick={() => onContactSupport(transfer)}
          className="text-[11px] font-medium text-terminal-accent underline decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terminal-accent"
        >
          Get help with this transfer
        </button>
      ) : null}
    </TerminalInset>
  );
}
