import { BridgePanel } from "../components/bridge/BridgePanel";
import { BridgeTransferCard } from "../components/bridge/BridgeTransferCard";
import { STATE_COPY } from "../components/bridge/custody";
import {
  TerminalEmptyState,
  TerminalPanel,
  TerminalPanelHeader,
} from "../components/foundation";
import { useBridgeExecute } from "../hooks/useBridgeExecute";
import { useBridgeTransfer } from "../hooks/useBridgeRoutes";
import { usePersistentState } from "../lib/persist";

/**
 * Bridge workspace: choose a route on the left, watch the hand-off on the right.
 *
 * Side by side rather than sequential steps. A transfer can take minutes, and
 * the user should be able to look at the next one without losing sight of the
 * one in flight — the in-flight window is the part that goes wrong.
 */

/** Recent transfers worth keeping on screen. Old settled ones age out. */
const MAX_TRACKED = 3;

export function BridgeRoute() {
  // Persisted, not component state: a reload mid-transfer — exactly the moment
  // the user's funds are on neither chain — must not lose the tracker.
  const [trackedIds, setTrackedIds] = usePersistentState<string[]>(
    "bridge:transfers",
    [],
  );
  const execute = useBridgeExecute();

  const failure = execute.error as { detail?: string } | null;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:gap-2">
      <BridgePanel
        isSubmitting={execute.isPending}
        failureDetail={
          failure
            ? (failure.detail ??
              "The transfer could not be started. Nothing was sent — try again.")
            : null
        }
        onConfirm={(route) => {
          execute.mutate(route, {
            onSuccess: (result) => {
              const id = String(result.transferId);
              setTrackedIds((ids) =>
                [id, ...ids.filter((known) => known !== id)].slice(
                  0,
                  MAX_TRACKED,
                ),
              );
            },
          });
        }}
      />

      <TerminalPanel className="flex h-full min-h-0 flex-col">
        <TerminalPanelHeader
          eyebrow="In flight"
          title="Transfers"
          description="Where your funds are right now, and who is holding them until they land."
        />
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {trackedIds.length > 0 ? (
            trackedIds.map((id) => (
              <TrackedTransfer
                key={id}
                transferId={id}
                onDismiss={() =>
                  setTrackedIds((ids) => ids.filter((known) => known !== id))
                }
              />
            ))
          ) : (
            <TerminalEmptyState
              title="Nothing in flight"
              description="Start a transfer and it will appear here, tracked until the funds arrive."
            />
          )}
        </div>
      </TerminalPanel>
    </div>
  );
}

/** One polled transfer. A component per id so each gets its own query. */
function TrackedTransfer({
  transferId,
  onDismiss,
}: {
  transferId: string;
  onDismiss: () => void;
}) {
  const { data: transfer, isError } = useBridgeTransfer(transferId);

  // A tracked id the server no longer knows (expired, wiped in dev) would
  // otherwise sit as a permanent blank slot. Let the user clear it.
  if (isError) {
    return (
      <div className="hairline flex items-center justify-between gap-3 rounded-[var(--terminal-radius-card)] bg-terminal-bg px-3 py-2.5">
        <p className="text-[11px] leading-[1.45] text-terminal-text-secondary">
          Could not load transfer #{transferId}.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] text-terminal-text-muted underline decoration-dotted underline-offset-2 hover:text-terminal-text"
        >
          Remove
        </button>
      </div>
    );
  }

  if (!transfer) return null;

  // Dismiss only once the money has landed (or terminally failed): hiding an
  // in-flight transfer is never what the user means.
  const settled = STATE_COPY[transfer.state].settled;
  return (
    <BridgeTransferCard
      transfer={transfer}
      onDismiss={settled ? onDismiss : undefined}
    />
  );
}
