import type { BridgeSettlement, BridgeTransferState, BridgeTrustModel } from "../../types/bridge";
import {
  STATE_COPY,
  TRUST_COPY,
  chainLabel,
  custodySteps,
  stepForState,
} from "./custody";

/**
 * The spine of the bridge flow: where the value is, right now.
 *
 * A bridge is a custody hand-off, and the interesting part is the gap in the
 * middle — the window where funds have left one chain and have not arrived on
 * the other. So the gap is drawn as a real span rather than an arrow between
 * two dots, and the trust model is labelled inside it. That is the question
 * the component exists to answer: while my money is nowhere, who is holding it?
 *
 * Non-interactive. It reports; it never offers an action.
 */

interface Props {
  state: BridgeTransferState;
  settlement: BridgeSettlement;
  trustModel: BridgeTrustModel;
  fromChain: string;
  toChain: string;
  /** Compact drops the per-step labels — for use inside a dense route row. */
  compact?: boolean;
}

export function CustodyTimeline({
  state,
  settlement,
  trustModel,
  fromChain,
  toChain,
  compact = false,
}: Props) {
  const steps = custodySteps(settlement);
  const activeKey = stepForState(state);
  const activeIndex = steps.findIndex((step) => step.key === activeKey);
  const stateCopy = STATE_COPY[state];
  const trust = TRUST_COPY[trustModel];

  const chainFor = (key: string) => {
    if (key === "deposit") return "You";
    if (key === "source") return chainLabel(fromChain);
    if (key === "destination") return chainLabel(toChain);
    return null;
  };

  return (
    <div
      className="w-full"
      role="group"
      aria-label={`Transfer position: ${stateCopy.label}`}
    >
      <ol className="flex items-stretch gap-0" role="list">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isDone = index < activeIndex;
          const isTransit = step.key === "transit";
          const chain = chainFor(step.key);

          return (
            <li
              key={step.key}
              className={joinClasses(
                "min-w-0 flex-1",
                isTransit ? "flex-[1.4]" : "",
              )}
              aria-current={isActive ? "step" : undefined}
            >
              {/* The bar. Transit is dashed because it is the span where the
                  value is in neither place — a solid rule would imply the
                  same certainty as being settled on a chain. */}
              <div
                className={joinClasses(
                  "h-[3px] w-full rounded-full",
                  isTransit && !isDone
                    ? "bg-[repeating-linear-gradient(90deg,rgb(var(--terminal-c-accent))_0_6px,transparent_6px_12px)] opacity-70"
                    : "",
                  !isTransit && (isDone || isActive)
                    ? "bg-terminal-accent"
                    : "",
                  !isDone && !isActive && !isTransit ? "bg-terminal-border" : "",
                  isTransit && isDone ? "bg-terminal-accent" : "",
                )}
              />

              {!compact ? (
                <div className="mt-1.5 pr-3">
                  <div
                    className={joinClasses(
                      "terminal-theme-caption text-[9px] uppercase",
                      isActive
                        ? "text-terminal-accent"
                        : "text-terminal-text-secondary",
                    )}
                  >
                    {step.label}
                  </div>
                  {chain ? (
                    <div className="mt-0.5 truncate text-[11px] text-terminal-text">
                      {chain}
                    </div>
                  ) : (
                    <div className="mt-0.5 truncate text-[11px] text-terminal-text-secondary">
                      {trust.label}
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Detail only — the card header already carries the state pill, and
          repeating it here read as two different statuses. */}
      {!compact ? (
        <p
          className="mt-3 max-w-[52ch] text-[12px] leading-[1.5] text-terminal-text"
          aria-live="polite"
        >
          {stateCopy.detail}
        </p>
      ) : null}
    </div>
  );
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
