import Table from "cli-table3";
import type {
  Chain,
  Token,
  TokenPrice,
  TokenBalance,
  PerpMarket,
  PerpPosition,
  Quote,
} from "@suwappu/openclaw";
import { theme, statusColor, changeColor } from "./colors.js";
import {
  formatUsd,
  formatPercent,
  formatAmount,
  formatSeconds,
} from "../utils/format.js";

export function chainTable(chains: Chain[]): string {
  const table = new Table({
    head: ["Chain", "Chain ID", "Status"],
    style: { head: ["cyan"] },
  });
  for (const c of chains) {
    table.push([c.name, c.chainId, statusColor(c.status)(c.status)]);
  }
  return table.toString();
}

export function tokenTable(tokens: Token[]): string {
  const table = new Table({
    head: ["Symbol", "Address", "Decimals", "Chain"],
    style: { head: ["cyan"] },
  });
  for (const t of tokens) {
    const addr =
      t.address.length > 14
        ? `${t.address.slice(0, 8)}...${t.address.slice(-6)}`
        : t.address;
    table.push([theme.amount(t.symbol), addr, t.decimals, t.chain]);
  }
  return table.toString();
}

export function priceTable(prices: TokenPrice[]): string {
  const table = new Table({
    head: ["Token", "Price", "24h Change"],
    style: { head: ["cyan"] },
  });
  for (const p of prices) {
    const change = parseFloat(p.change24h);
    const color = changeColor(change);
    table.push([
      theme.amount(p.token),
      formatUsd(p.priceUsd),
      color(formatPercent(change)),
    ]);
  }
  return table.toString();
}

export function portfolioTable(balances: TokenBalance[]): string {
  const table = new Table({
    head: ["Token", "Balance", "USD Value", "Chain"],
    style: { head: ["cyan"] },
  });
  let total = 0;
  for (const b of balances) {
    const usd = parseFloat(b.usdValue);
    total += isNaN(usd) ? 0 : usd;
    table.push([
      theme.amount(b.token),
      formatAmount(b.balance),
      formatUsd(b.usdValue),
      b.chain,
    ]);
  }
  table.push([
    { colSpan: 2, content: theme.label("Total"), hAlign: "right" },
    theme.label(formatUsd(total)),
    "",
  ]);
  return table.toString();
}

export function perpMarketTable(markets: PerpMarket[]): string {
  const table = new Table({
    head: ["Market", "Asset", "Mark Price", "Funding Rate", "Max Leverage"],
    style: { head: ["cyan"] },
  });
  for (const m of markets) {
    const fr = m.fundingRate;
    const frColor = changeColor(fr);
    table.push([
      m.name,
      theme.amount(m.asset),
      formatUsd(m.markPrice),
      frColor(formatPercent(fr * 100)),
      `${m.maxLeverage}x`,
    ]);
  }
  return table.toString();
}

export function perpPositionTable(positions: PerpPosition[]): string {
  const table = new Table({
    head: [
      "Market",
      "Side",
      "Size",
      "Entry",
      "Mark",
      "PnL",
      "Leverage",
      "Liq. Price",
    ],
    style: { head: ["cyan"] },
  });
  for (const p of positions) {
    const pnlColor = changeColor(p.unrealizedPnl);
    const sideColor = p.side === "long" ? theme.gain : theme.loss;
    table.push([
      p.market,
      sideColor(p.side.toUpperCase()),
      formatAmount(p.size),
      formatUsd(p.entryPrice),
      formatUsd(p.markPrice),
      pnlColor(formatUsd(p.unrealizedPnl)),
      `${p.leverage}x`,
      formatUsd(p.liquidationPrice),
    ]);
  }
  return table.toString();
}

export function quoteTable(q: Quote): string {
  const table = new Table({ style: { head: ["cyan"] } });
  table.push(
    { [theme.label("From")]: `${formatAmount(q.fromAmount)} ${q.fromToken}` },
    { [theme.label("To")]: `${theme.amount(formatAmount(q.toAmount))} ${q.toToken}` },
    { [theme.label("Rate")]: q.exchangeRate },
    { [theme.label("Price Impact")]: formatPercent(q.priceImpact) },
    { [theme.label("Slippage")]: formatPercent(q.slippage) },
    { [theme.label("Gas")]: formatUsd(q.gas) },
    { [theme.label("Fee")]: formatUsd(q.fee) },
    { [theme.label("DEX")]: q.dex || theme.muted("auto") },
    { [theme.label("Route")]: q.route || theme.muted("direct") },
    { [theme.label("Est. Time")]: formatSeconds(q.estimatedTimeSeconds) },
    { [theme.label("Chain")]: q.chain }
  );
  return table.toString();
}
