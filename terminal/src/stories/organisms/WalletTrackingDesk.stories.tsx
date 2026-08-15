import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  TerminalMetricCard,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
} from "../../components/foundation/TerminalPrimitives";
import {
  TerminalWalletOperatorSurface,
  type TerminalWalletOperatorMode,
} from "../../components/tracker/TerminalWalletOperatorSurface";
import {
  trackedWallet,
  trackedWallets,
  walletActivities,
  walletStatsMap,
} from "../_fixtures/terminal";

function WalletTrackingDesk() {
  const [mode, setMode] = useState<TerminalWalletOperatorMode>("focused");
  const [query, setQuery] = useState("");
  const [selectedAddress, setSelectedAddress] = useState(trackedWallet.address);
  const [lastAction, setLastAction] = useState("No action triggered yet");

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={
              <TerminalStatusPill tone="warm">wallet slice</TerminalStatusPill>
            }
            title="Terminal wallet operator surface"
            description="A provider-free rebuild of wallet selection, holdings posture, and activity tape on the shared terminal theme layer."
            meta={
              <TerminalMetricCard
                label="Mode"
                value={mode}
                tone={mode === "market" ? "warm" : "sky"}
              />
            }
          />

          <div className="grid gap-4">
            <TerminalWalletOperatorSurface
              wallets={trackedWallets}
              statsMap={walletStatsMap}
              activities={walletActivities}
              selectedAddress={selectedAddress}
              onSelectAddress={setSelectedAddress}
              mode={mode}
              onModeChange={(value) => setMode(value)}
              query={query}
              onQueryChange={setQuery}
              onPrimaryAction={(wallet) =>
                setLastAction(
                  `stage action for ${wallet.label || wallet.address}`,
                )
              }
              onSecondaryAction={(wallet) =>
                setLastAction(`open tape for ${wallet.label || wallet.address}`)
              }
            />

            <div className="grid gap-3 md:grid-cols-3">
              <TerminalMetricCard
                label="What changed"
                value="list + profile + tape"
                detail="The wallet slice now composes selection, posture, and activity as one desk."
              />
              <TerminalMetricCard
                label="Port target"
                value="WalletTrackerPanel shell"
                detail="Back-port this surface after the live hooks are separated from presentation."
                tone="warm"
              />
              <TerminalMetricCard
                label="Last action"
                value={lastAction}
                detail="Useful for tightening wallet action language before wiring to the live app."
                tone="sky"
              />
            </div>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  );
}

const meta = {
  title: "Organisms/Wallet Tracking Desk",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  render: () => <WalletTrackingDesk />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
