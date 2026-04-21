import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";
import "../src/index.css";
import {
  TerminalThemeScope,
  type TerminalThemeMode,
} from "../src/theme/TerminalThemeScope";

const preview: Preview = {
  decorators: [
    (Story, context) =>
      createElement(
        TerminalThemeScope,
        { mode: context.globals.terminalTheme as TerminalThemeMode },
        createElement(Story),
      ),
  ],
  parameters: {
    layout: "padded",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "summer-breeze",
      values: [
        { name: "summer-breeze", value: "#FFFEFB" },
        { name: "studio", value: "#FFFEFB" },
        { name: "butter", value: "#FFF8EE" },
        { name: "spring-sky", value: "#EAF4FF" },
      ],
    },
    options: {
      storySort: {
        order: [
          "Workbench",
          [
            "Terminal Rebuild Lab",
            "Execution Desk Rebuild Lab",
            "Wallet Operator Rebuild Lab",
            "Order Book Rebuild Lab",
            "Token Inspector Rebuild Lab",
            "Copilot Rebuild Lab",
            "Terminal Header Lab",
            "Watchlist Rebuild Lab",
            "*",
          ],
          "Organisms",
          [
            "Terminal Execution Ticket",
            "Wallet Tracking Desk",
            "Terminal Copilot Surface",
            "Copilot Conversation",
            "Summer Breeze Workspaces",
            "Summer Breeze Variants",
            "*",
          ],
          "Molecules",
          [
            "Terminal Token Inspector",
            "Terminal Order Book Depth Row",
            "Terminal Watchlist Row",
            "Wallet Profile Card",
            "Quote Comparison",
            "Security Badge",
            "Add Wallet Form",
            "Create Alert Form",
            "Alert Card",
            "Watchlist Item",
            "*",
          ],
          "Atoms",
          [
            "Terminal Controls",
            "Chart Toolbar",
            "Slippage Control",
            "Status Badges",
            "*",
          ],
          "Foundations",
          [
            "Terminal Theme Modes",
            "Terminal Foundations",
            "Color Tokens",
            "State Maps",
            "Suwappu Mark Lab",
            "*",
          ],
          "Templates",
        ],
      },
    },
  },
  globalTypes: {
    terminalTheme: {
      name: "Terminal Theme",
      description: "Global rebuilt terminal theme",
      toolbar: {
        icon: "paintbrush",
        dynamicTitle: true,
        items: [
          { value: "summer-breeze", title: "Summer Breeze" },
          { value: "precision", title: "Precision" },
          { value: "desk", title: "Desk" },
          { value: "studio", title: "Studio" },
        ],
      },
    },
  },
  initialGlobals: {
    terminalTheme: "summer-breeze",
  },
};

export default preview;
