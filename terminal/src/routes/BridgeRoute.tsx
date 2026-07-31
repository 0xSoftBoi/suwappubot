import { useState } from "react";
import { BridgePanel } from "../components/bridge/BridgePanel";
import { BridgeTransferCard } from "../components/bridge/BridgeTransferCard";
import { TerminalEmptyState, TerminalPanel, TerminalPanelHeader } from "../components/foundation";
import { useBridgeTransfer } from "../hooks/useBridgeRoutes";

/**
 * Bridge workspace: choose a route on the left, watch the hand-off on the right.
 *
 * The two panels are deliberately side by side rather than sequential steps.
 * A transfer can take minutes, and during that time the user should be able to
 * start reading about the next one without losing sight of the one in flight —
 * the in-flight window is the part that goes wrong.
 */
export function BridgeRoute() {
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);
  const { data: transfer } = useBridgeTransfer(activeTransferId);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:gap-2">
      <BridgePanel
        onConfirm={(route) => {
          // Signing is handled by the wallet layer; this screen owns the
          // waiting. Until that hand-off exists the button stays inert rather
          // than pretending to have started something.
          void route;
          setActiveTransferId(null);
        }}
      />

      <TerminalPanel className="flex h-full min-h-0 flex-col">
        <TerminalPanelHeader
          eyebrow="In flight"
          title="Transfers"
          description="Where your funds are right now, and who is holding them until they land."
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {transfer ? (
            <BridgeTransferCard transfer={transfer} />
          ) : (
            <TerminalEmptyState
              title="Nothing in flight"
              description="Start a transfer and it will appear here, with its position tracked until the funds arrive."
            />
          )}
        </div>
      </TerminalPanel>
    </div>
  );
}
