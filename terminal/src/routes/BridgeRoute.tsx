import { useState } from "react";
import { BridgePanel } from "../components/bridge/BridgePanel";
import { BridgeTransferCard } from "../components/bridge/BridgeTransferCard";
import {
  TerminalEmptyState,
  TerminalPanel,
  TerminalPanelHeader,
} from "../components/foundation";
import { useBridgeExecute } from "../hooks/useBridgeExecute";
import { useBridgeTransfer } from "../hooks/useBridgeRoutes";

/**
 * Bridge workspace: choose a route on the left, watch the hand-off on the right.
 *
 * Side by side rather than sequential steps. A transfer can take minutes, and
 * the user should be able to look at the next one without losing sight of the
 * one in flight — the in-flight window is the part that goes wrong.
 */
export function BridgeRoute() {
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);
  const execute = useBridgeExecute();
  const { data: transfer } = useBridgeTransfer(activeTransferId);

  const failure = execute.error as { detail?: string } | null;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:gap-2">
      <BridgePanel
        isSubmitting={execute.isPending}
        onConfirm={(route) => {
          execute.mutate(route, {
            onSuccess: (result) => setActiveTransferId(String(result.transferId)),
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
          {failure ? (
            <p
              role="alert"
              className="hairline rounded-[var(--terminal-radius-card)] bg-terminal-bg px-3 py-2.5 text-[11px] leading-[1.45] text-terminal-text"
            >
              {failure.detail ??
                "The transfer could not be started. Nothing was sent — try again."}
            </p>
          ) : null}

          {transfer ? (
            <BridgeTransferCard transfer={transfer} />
          ) : !failure ? (
            <TerminalEmptyState
              title="Nothing in flight"
              description="Start a transfer and it will appear here, tracked until the funds arrive."
            />
          ) : null}
        </div>
      </TerminalPanel>
    </div>
  );
}
