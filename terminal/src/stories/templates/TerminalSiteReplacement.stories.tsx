import type { Meta, StoryObj } from "@storybook/react";
import { TerminalSiteReplacement } from "../../components/templates/TerminalSiteReplacement";

const meta = {
  title: "Templates/Terminal Site Replacement",
  component: TerminalSiteReplacement,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TerminalSiteReplacement>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const ProductionCandidate: Story = {};

export const Mobile: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
};
