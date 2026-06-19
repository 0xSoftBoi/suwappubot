/**
 * Tiny dependency-free ANSI color helpers for the CLI tables.
 */
type Colorizer = (s: string) => string;

const useColor =
  typeof process !== "undefined" && process.stdout?.isTTY && !process.env.NO_COLOR;

function wrap(code: number): Colorizer {
  return (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const theme = {
  amount: wrap(36), // cyan
  label: wrap(1), // bold
  muted: wrap(90), // bright black / gray
  gain: wrap(32), // green
  loss: wrap(31), // red
};

/** Green for positive change, red for negative, gray for zero/NaN. */
export function changeColor(value: number): Colorizer {
  if (Number.isNaN(value) || value === 0) return theme.muted;
  return value > 0 ? theme.gain : theme.loss;
}
