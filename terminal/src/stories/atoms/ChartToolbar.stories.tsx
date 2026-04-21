import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChartToolbar } from "../../components/chart/ChartToolbar";
import {
  SummerBreezeStoryFrame,
  SummerBreezeSurface,
} from "../_components/SummerBreezeStoryFrame";

type ChartType = "candle" | "line";

function ChartToolbarPlayground({
  initialInterval,
  initialChartType,
}: {
  initialInterval: string;
  initialChartType: ChartType;
}) {
  const [interval, setInterval] = useState(initialInterval);
  const [chartType, setChartType] = useState<ChartType>(initialChartType);

  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal atom"
      title="Chart timing controls for the trading rail"
      description="This toolbar is the main chart mode switch inside the terminal. Storybook now lets you tune cadence and display mode without booting the whole chart stack."
      metricLabel="Active view"
      metricValue={`${interval} · ${chartType}`}
    >
      <SummerBreezeSurface
        title="Chart toolbar"
        description="Swap between intraday intervals and candle or line mode."
        meta="keyboard hints"
      >
        <div className="terminal-theme-card p-[var(--terminal-space-card)]">
          <ChartToolbar
            interval={interval}
            onIntervalChange={setInterval}
            chartType={chartType}
            onChartTypeChange={setChartType}
          />
          <div className="terminal-theme-inset mt-2 flex h-36 items-center justify-center text-center">
            <div>
              <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
                Preview state
              </div>
              <div className="mt-2 font-mono text-xl text-terminal-text">
                {interval} / {chartType}
              </div>
              <div className="mt-1 text-[11px] text-terminal-text-secondary">
                Tune cadence before wiring it into `PriceChart`.
              </div>
            </div>
          </div>
        </div>
      </SummerBreezeSurface>
    </SummerBreezeStoryFrame>
  );
}

const meta = {
  title: "Atoms/Chart Toolbar",
  tags: ["autodocs"],
  args: {
    initialInterval: "15m",
    initialChartType: "candle" as ChartType,
  },
  render: ({ initialInterval, initialChartType }) => (
    <ChartToolbarPlayground
      initialInterval={initialInterval}
      initialChartType={initialChartType}
    />
  ),
} satisfies Meta<{
  initialInterval: string;
  initialChartType: ChartType;
}>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};

export const LineFocus: Story = {
  args: {
    initialInterval: "1h",
    initialChartType: "line",
  },
};

export const Intraday: Story = {
  args: {
    initialInterval: "1m",
    initialChartType: "candle",
  },
};
