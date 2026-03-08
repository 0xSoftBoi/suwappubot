import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Format utils ──────────────────────────────────────────
import {
  formatUsd,
  formatPercent,
  formatAmount,
  truncateAddress,
  formatSeconds,
} from "../cli/utils/format";

describe("format utils", () => {
  it("formatUsd formats dollar amounts", () => {
    expect(formatUsd("1234.5")).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd("not-a-number")).toBe("$0.00");
    expect(formatUsd(99.999)).toBe("$100.00");
  });

  it("formatPercent formats with sign", () => {
    expect(formatPercent(5.123)).toBe("+5.12%");
    expect(formatPercent(-3.7)).toBe("-3.70%");
    expect(formatPercent(0)).toBe("+0.00%");
    expect(formatPercent("invalid")).toBe("0.00%");
  });

  it("formatAmount handles decimals", () => {
    expect(formatAmount("1234567.123456789")).toContain("1,234,567");
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount("bad")).toBe("0");
  });

  it("truncateAddress shortens long addresses", () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    const truncated = truncateAddress(addr);
    expect(truncated).toContain("0x123456");
    expect(truncated).toContain("...");
    expect(truncated.length).toBeLessThan(addr.length);
    // Short address stays as-is
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });

  it("formatSeconds converts to human readable", () => {
    expect(formatSeconds(30)).toBe("30s");
    expect(formatSeconds(90)).toBe("1m 30s");
    expect(formatSeconds(120)).toBe("2m");
    expect(formatSeconds(0)).toBe("0s");
  });
});

// ── Config store ──────────────────────────────────────────
import { maskKey } from "../cli/utils/config-store";

describe("config-store", () => {
  it("maskKey masks API keys", () => {
    expect(maskKey("sk-1234567890abcdef")).toBe("sk-1...cdef");
    expect(maskKey("short")).toBe("****");
    expect(maskKey("12345678")).toBe("****");
    expect(maskKey("123456789")).toBe("1234...6789");
  });
});

// ── Colors ────────────────────────────────────────────────
import { statusColor, changeColor } from "../cli/ui/colors";

describe("colors", () => {
  it("statusColor returns a function for known statuses", () => {
    expect(typeof statusColor("active")).toBe("function");
    expect(typeof statusColor("degraded")).toBe("function");
    expect(typeof statusColor("down")).toBe("function");
    expect(typeof statusColor("unknown")).toBe("function");
  });

  it("changeColor returns a function for positive and negative", () => {
    const pos = changeColor(5);
    const neg = changeColor(-3);
    expect(typeof pos).toBe("function");
    expect(typeof neg).toBe("function");
    // Both should return strings when called
    expect(typeof pos("test")).toBe("string");
    expect(typeof neg("test")).toBe("string");
  });
});

// ── Table formatters ──────────────────────────────────────
import {
  chainTable,
  tokenTable,
  priceTable,
  portfolioTable,
  perpMarketTable,
  perpPositionTable,
  quoteTable,
} from "../cli/ui/table";

describe("table formatters", () => {
  it("chainTable renders chains", () => {
    const output = chainTable([
      { name: "Ethereum", chainId: 1, status: "active" },
      { name: "Arbitrum", chainId: 42161, status: "degraded" },
    ]);
    expect(output).toContain("Ethereum");
    expect(output).toContain("42161");
    expect(output).toContain("Arbitrum");
  });

  it("tokenTable renders tokens", () => {
    const output = tokenTable([
      { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, chain: "ethereum" },
      { symbol: "USDC", address: "0xa0b8", decimals: 6, chain: "ethereum" },
    ]);
    expect(output).toContain("ETH");
    expect(output).toContain("USDC");
    expect(output).toContain("18");
    expect(output).toContain("6");
  });

  it("priceTable renders prices with change", () => {
    const output = priceTable([
      { token: "ETH", priceUsd: "2847.50", change24h: "3.21" },
      { token: "BTC", priceUsd: "67000", change24h: "-1.5" },
    ]);
    expect(output).toContain("ETH");
    expect(output).toContain("BTC");
    expect(output).toContain("$2,847.50");
    expect(output).toContain("$67,000.00");
  });

  it("portfolioTable renders balances with total", () => {
    const output = portfolioTable([
      { token: "ETH", balance: "1.5", usdValue: "4271.25", chain: "ethereum" },
      { token: "USDC", balance: "1000", usdValue: "1000", chain: "ethereum" },
    ]);
    expect(output).toContain("ETH");
    expect(output).toContain("USDC");
    expect(output).toContain("Total");
    expect(output).toContain("$5,271.25");
  });

  it("perpMarketTable renders markets", () => {
    const output = perpMarketTable([
      { name: "ETH-USD", asset: "ETH", szDecimals: 3, maxLeverage: 50, markPrice: 2847.5, fundingRate: 0.0001 },
    ]);
    expect(output).toContain("ETH-USD");
    expect(output).toContain("50x");
    expect(output).toContain("$2,847.50");
  });

  it("perpPositionTable renders positions with PnL", () => {
    const output = perpPositionTable([
      {
        id: "1", market: "ETH-USD", side: "long", size: 1.5,
        leverage: 10, entryPrice: 2800, markPrice: 2850,
        margin: 420, unrealizedPnl: 75, liquidationPrice: 2540, fundingRate: 0.0001,
      },
    ]);
    expect(output).toContain("ETH-USD");
    expect(output).toContain("LONG");
    expect(output).toContain("10x");
    expect(output).toContain("$75.00");
  });

  it("quoteTable renders swap quote", () => {
    const output = quoteTable({
      id: "q1", fromToken: "ETH", toToken: "USDC",
      fromAmount: "1", toAmount: "2847.50",
      route: "uniswap-v3", gas: "2.50", fee: "0.10",
      chain: "ethereum", exchangeRate: "2847.50",
      priceImpact: "0.05", slippage: "0.5",
      estimatedTimeSeconds: 15, dex: "Uniswap V3",
    });
    expect(output).toContain("ETH");
    expect(output).toContain("USDC");
    expect(output).toContain("2847.50");
    expect(output).toContain("Uniswap V3");
    expect(output).toContain("15s");
  });
});

// ── Program structure ─────────────────────────────────────
import { createProgram } from "../cli/program";

describe("CLI program", () => {
  it("creates a program with correct name and version", () => {
    const program = createProgram();
    expect(program.name()).toBe("suwappu");
    expect(program.version()).toBe("0.3.0");
  });

  it("registers all expected commands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("chains");
    expect(commandNames).toContain("tokens");
    expect(commandNames).toContain("prices");
    expect(commandNames).toContain("portfolio");
    expect(commandNames).toContain("perps");
    expect(commandNames).toContain("swap");
    expect(commandNames).toContain("config");
  });

  it("swap command has required options", () => {
    const program = createProgram();
    const swap = program.commands.find((c) => c.name() === "swap")!;
    const optionNames = swap.options.map((o) => o.long);
    expect(optionNames).toContain("--chain");
    expect(optionNames).toContain("--slippage");
    expect(optionNames).toContain("--json");
  });

  it("perps has subcommands", () => {
    const program = createProgram();
    const perps = program.commands.find((c) => c.name() === "perps")!;
    const subNames = perps.commands.map((c) => c.name());
    expect(subNames).toContain("markets");
    expect(subNames).toContain("positions");
  });

  it("config has subcommands", () => {
    const program = createProgram();
    const config = program.commands.find((c) => c.name() === "config")!;
    const subNames = config.commands.map((c) => c.name());
    expect(subNames).toContain("set");
    expect(subNames).toContain("show");
  });
});
