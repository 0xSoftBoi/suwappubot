import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TerminalKeyValueRow } from "../../components/foundation/TerminalDataDisplay";
import {
  TerminalMetricCard,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
  TerminalInset,
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

function WalletOperatorLab() {
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
            title="Provider-free wallet operator rebuild lab"
            description="This is the wallet slice rebuilt on the shared theme layer. It is where we tighten selection density, holdings posture, and activity flow before touching the live tracker panel."
            meta={
              <TerminalMetricCard
                label="Mode"
                value={mode}
                tone={mode === "market" ? "warm" : "sky"}
              />
            }
          />

          <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
            <TerminalInset className="grid gap-2 self-start">
              <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                Port notes
              </div>
              <TerminalKeyValueRow
                label="Replace first"
                value="WalletTrackerPanel shell"
                detail="The live panel should reuse this presentation layer instead of the old split list/profile layout."
              />
              <TerminalKeyValueRow
                label="Keep isolated"
                value="selection + query"
                detail="Storybook should continue owning wallet selection and filtering state during visual iteration."
              />
              <TerminalKeyValueRow
                label="Most important shift"
                value="one operator desk"
                detail="Wallet queue, posture, and tape belong in one tabbed lane instead of a nested dark subsystem."
              />
              <TerminalMetricCard
                label="Last action"
                value={lastAction}
                detail="Test action wording here before wiring it to live routes or copilot."
                tone="sky"
              />
            </TerminalInset>

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
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  );
}

const meta = {
  title: "Workbench/Wallet Operator Rebuild Lab",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <WalletOperatorLab />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
