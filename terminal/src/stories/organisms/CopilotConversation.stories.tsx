import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessage } from "../../components/copilot/ChatMessage";
import { SuggestedCommands } from "../../components/copilot/SuggestedCommands";
import {
  SummerBreezeStoryFrame,
  SummerBreezeSurface,
} from "../_components/SummerBreezeStoryFrame";
import {
  copilotQuoteCardData,
  portfolioSummaryData,
} from "../_fixtures/terminal";

type Focus = "quote" | "portfolio" | "mixed";

function messagesForFocus(focus: Focus) {
  const base = [
    {
      role: "user" as const,
      type: "text" as const,
      content: "Route 0.75 ETH into USDC with low slippage.",
      timestamp: Date.now() - 1000 * 60 * 4,
    },
    {
      role: "assistant" as const,
      type: "quote" as const,
      content:
        "Best route found through the terminal stack. Execution quality looks clean.",
      data: copilotQuoteCardData,
      timestamp: Date.now() - 1000 * 60 * 3,
    },
  ];

  if (focus === "quote") return base;

  const portfolioMessages = [
    {
      role: "user" as const,
      type: "text" as const,
      content: "Show my portfolio concentration.",
      timestamp: Date.now() - 1000 * 60 * 2,
    },
    {
      role: "assistant" as const,
      type: "portfolio" as const,
      content:
        "Your wallet is still ETH-heavy, with stablecoin depth available for routing and alerts.",
      data: portfolioSummaryData,
      timestamp: Date.now() - 1000 * 60,
    },
  ];

  return focus === "portfolio"
    ? portfolioMessages
    : [...base, ...portfolioMessages];
}

function ConversationBoard({ focus }: { focus: Focus }) {
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const messages = messagesForFocus(focus);

  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal organism"
      title="Copilot conversation staging without booting the full agent panel"
      description="This story isolates the message rail, embedded cards, and suggestion chips. It is the fastest place to adjust spacing, tone, and card density for terminal copilot flows."
      metricLabel="Focus"
      metricValue={focus}
    >
      <div className="grid gap-4 xl:grid-cols-[1.5fr_320px]">
        <SummerBreezeSurface
          title="Conversation"
          description="A mixed feed of user prompts, quote responses, and portfolio summaries."
          meta={`${messages.length} messages`}
        >
          <div className="terminal-theme-inset p-[var(--terminal-space-inset)]">
            {messages.map((message, index) => (
              <ChatMessage
                key={`${message.role}-${message.type}-${index}`}
                role={message.role}
                type={message.type}
                content={message.content}
                data={message.data}
                timestamp={message.timestamp}
              />
            ))}
          </div>
        </SummerBreezeSurface>

        <SummerBreezeSurface
          title="Prompt starters"
          description="Tap a command to preview which shortcut language feels right."
          meta={selectedCommand ? "selected" : "idle"}
        >
          <div className="terminal-theme-inset p-[var(--terminal-space-inset)]">
            <SuggestedCommands onSelect={setSelectedCommand} />
          </div>
          <div className="mt-3 rounded-2xl border border-[#ECE0CB] bg-[#FFF9F0] px-3 py-2 text-xs text-[#6E5B49]">
            {selectedCommand
              ? `Selected: ${selectedCommand}`
              : "Choose a suggestion to test the command vocabulary in Storybook."}
          </div>
        </SummerBreezeSurface>
      </div>
    </SummerBreezeStoryFrame>
  );
}

const meta = {
  title: "Organisms/Copilot Conversation",
  tags: ["autodocs"],
  args: {
    focus: "mixed" as Focus,
  },
  render: ({ focus }) => <ConversationBoard focus={focus} />,
} satisfies Meta<{ focus: Focus }>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};

export const QuoteAssist: Story = {
  args: {
    focus: "quote",
  },
};

export const PortfolioAssist: Story = {
  args: {
    focus: "portfolio",
  },
};
