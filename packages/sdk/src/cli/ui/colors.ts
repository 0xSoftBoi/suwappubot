import chalk from "chalk";

export const theme = {
  gain: chalk.green,
  loss: chalk.red,
  header: chalk.bold.cyan,
  muted: chalk.gray,
  amount: chalk.yellow,
  active: chalk.green,
  degraded: chalk.yellow,
  down: chalk.red,
  label: chalk.bold,
  error: chalk.red.bold,
  success: chalk.green.bold,
};

export function statusColor(status: string): (s: string) => string {
  switch (status) {
    case "active":
    case "confirmed":
      return theme.active;
    case "degraded":
    case "pending":
      return theme.degraded;
    case "down":
    case "failed":
      return theme.down;
    default:
      return theme.muted;
  }
}

export function changeColor(value: number): (s: string) => string {
  return value >= 0 ? theme.gain : theme.loss;
}
