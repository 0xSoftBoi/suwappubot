import type { Meta, StoryObj } from "@storybook/react-vite";
import { SuwappuBotSiteReplacement } from "../../components/templates/SuwappuBotSiteReplacement";

const meta = {
  title: "Templates/Suwappu Bot Site Replacement",
  component: SuwappuBotSiteReplacement,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SuwappuBotSiteReplacement>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const Mobile: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
};
