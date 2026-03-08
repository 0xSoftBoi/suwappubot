# MCP Portfolio Advisor

This guide builds a custom MCP client from scratch that connects to Suwappu's MCP endpoint, discovers tools dynamically, fetches your portfolio and prices, then uses an AI model (or rule-based fallback) to analyze your holdings and recommend trades. It demonstrates full MCP protocol interaction: handshake, tool discovery, and multi-tool orchestration.

## What the Script Does

1. Loads your API key from environment variables
2. Builds an `McpClient` class that wraps `POST /mcp` with JSON-RPC 2.0
3. Performs the MCP `initialize` handshake
4. Discovers available tools via `tools/list` and prints their schemas
5. Calls `get_portfolio` to fetch wallet holdings
6. Calls `get_prices` to fetch current prices with 24h change
7. Calls `list_chains` to show supported networks
8. Formats data into an AI prompt (or applies rule-based analysis if no AI key is set)
9. Generates an advisory report: concentration risk, momentum signals, diversification score
10. Calls `get_quote` for any recommended trades to show real costs

## Python Version

```python
#!/usr/bin/env python3
"""
Suwappu MCP Portfolio Advisor — Python
Custom MCP client that discovers tools, fetches data, and generates investment advice.
"""

import os
import sys
import json
import requests

MCP_URL = "https://api.suwappu.bot/mcp"


class McpClient:
    """Minimal MCP client wrapping the Suwappu MCP HTTP endpoint."""

    def __init__(self, api_key):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self.request_id = 0
        self.tools = []

    def _next_id(self):
        self.request_id += 1
        return self.request_id

    def _send(self, method, params=None):
        """Send a JSON-RPC 2.0 request to the MCP endpoint."""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params or {},
        }
        response = requests.post(MCP_URL, headers=self.headers, json=payload)
        response.raise_for_status()
        data = response.json()

        if "error" in data:
            raise Exception(f"MCP error {data['error']['code']}: {data['error']['message']}")

        return data["result"]

    def initialize(self):
        """Perform the MCP handshake."""
        result = self._send("initialize")
        server = result["serverInfo"]
        print(f"Connected to {server['name']} v{server['version']}")
        print(f"Protocol: {result['protocolVersion']}")
        return result

    def list_tools(self):
        """Discover available tools and their schemas."""
        result = self._send("tools/list")
        self.tools = result.get("tools", [])
        return self.tools

    def call_tool(self, name, arguments=None):
        """Call a tool by name and return parsed result."""
        result = self._send("tools/call", {
            "name": name,
            "arguments": arguments or {},
        })
        # MCP returns content as array of parts with JSON strings
        content = result.get("content", [])
        for part in content:
            if part["type"] == "text":
                try:
                    return json.loads(part["text"])
                except json.JSONDecodeError:
                    return part["text"]
        return content


def analyze_with_ai(portfolio_data, price_data, chains_data):
    """Use OpenAI or Anthropic to analyze the portfolio. Falls back to rules."""
    openai_key = os.environ.get("OPENAI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    prompt = f"""You are a crypto portfolio advisor. Analyze this portfolio and provide actionable recommendations.

Portfolio Holdings:
{json.dumps(portfolio_data, indent=2)}

Current Prices (with 24h change):
{json.dumps(price_data, indent=2)}

Supported Chains:
{json.dumps(chains_data, indent=2)}

Analyze for:
1. Concentration risk (any single token >50% of portfolio?)
2. Momentum signals (tokens with >5% 24h change)
3. Diversification score (how many tokens, how spread across chains)
4. Stablecoin ratio (is there enough stable allocation for risk management?)

Provide 2-3 specific trade recommendations with reasoning. Format as a clear report."""

    if openai_key:
        return _call_openai(openai_key, prompt)
    elif anthropic_key:
        return _call_anthropic(anthropic_key, prompt)
    else:
        return None


def _call_openai(api_key, prompt):
    """Call OpenAI API for analysis."""
    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
        },
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _call_anthropic(api_key, prompt):
    """Call Anthropic API for analysis."""
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        },
    )
    response.raise_for_status()
    return response.json()["content"][0]["text"]


def rule_based_analysis(portfolio_data, price_data):
    """Simple rule-based analysis when no AI key is available."""
    balances = portfolio_data.get("balances", [])
    total_usd = portfolio_data.get("total_usd", 0)
    recommendations = []

    if total_usd == 0:
        return "Portfolio is empty. Fund your wallet to get started."

    report = []
    report.append("=" * 55)
    report.append("  PORTFOLIO ADVISORY REPORT")
    report.append("=" * 55)

    # 1. Concentration risk
    report.append("\n  1. CONCENTRATION RISK")
    for bal in balances:
        pct = (bal["usd_value"] / total_usd) * 100 if total_usd > 0 else 0
        if pct > 50:
            report.append(f"     WARNING: {bal['symbol']} is {pct:.1f}% of portfolio (>50%)")
            recommendations.append({
                "action": "sell",
                "token": bal["symbol"],
                "reason": f"Over-concentrated at {pct:.1f}%",
                "target": "Reduce to <40% by selling into USDC or diversifying",
            })
        elif pct > 30:
            report.append(f"     WATCH: {bal['symbol']} at {pct:.1f}% — approaching concentration limit")
        else:
            report.append(f"     OK: {bal['symbol']} at {pct:.1f}%")

    # 2. Momentum signals
    report.append("\n  2. MOMENTUM SIGNALS (24h)")
    for symbol, data in price_data.items():
        change = data.get("change_24h", 0)
        if change > 5:
            report.append(f"     BULLISH: {symbol} +{change:.1f}% — consider taking profits")
        elif change < -5:
            report.append(f"     BEARISH: {symbol} {change:.1f}% — potential buying opportunity")
            # Check if we already hold it
            held = any(b["symbol"] == symbol for b in balances)
            if not held:
                recommendations.append({
                    "action": "buy",
                    "token": symbol,
                    "reason": f"Down {change:.1f}% — potential dip buy",
                })
        else:
            report.append(f"     NEUTRAL: {symbol} {change:+.1f}%")

    # 3. Diversification
    report.append("\n  3. DIVERSIFICATION")
    num_tokens = len(balances)
    chains = set(b["chain"] for b in balances)
    score = min(10, num_tokens * 2 + len(chains))
    report.append(f"     Tokens held: {num_tokens}")
    report.append(f"     Chains used: {len(chains)} ({', '.join(chains)})")
    report.append(f"     Score: {score}/10")
    if num_tokens < 3:
        report.append("     TIP: Consider diversifying into at least 3-5 tokens")

    # 4. Stablecoin ratio
    report.append("\n  4. STABLECOIN RATIO")
    stable_symbols = {"USDC", "USDT", "DAI"}
    stable_usd = sum(b["usd_value"] for b in balances if b["symbol"] in stable_symbols)
    stable_pct = (stable_usd / total_usd) * 100 if total_usd > 0 else 0
    report.append(f"     Stablecoins: ${stable_usd:,.2f} ({stable_pct:.1f}%)")
    if stable_pct < 10:
        report.append("     WARNING: Low stablecoin allocation (<10%). Consider increasing for risk management.")
        recommendations.append({
            "action": "rebalance",
            "token": "USDC",
            "reason": "Stablecoin allocation too low for risk management",
        })
    elif stable_pct > 60:
        report.append("     NOTE: High stablecoin ratio (>60%). Capital may be underdeployed.")

    # 5. Recommendations
    report.append("\n  5. RECOMMENDATIONS")
    if recommendations:
        for i, rec in enumerate(recommendations, 1):
            report.append(f"     {i}. {rec['action'].upper()} {rec['token']}: {rec['reason']}")
            if "target" in rec:
                report.append(f"        → {rec['target']}")
    else:
        report.append("     No immediate action needed. Portfolio looks balanced.")

    report.append("")
    return "\n".join(report), recommendations


def main():
    api_key = os.environ.get("SUWAPPU_API_KEY")
    if not api_key:
        print("Error: Set SUWAPPU_API_KEY environment variable.")
        print("  export SUWAPPU_API_KEY=suwappu_sk_your_api_key")
        sys.exit(1)

    wallet_address = os.environ.get("WALLET_ADDRESS")
    if not wallet_address:
        print("Error: Set WALLET_ADDRESS environment variable.")
        print("  export WALLET_ADDRESS=0xYourWalletAddress")
        sys.exit(1)

    # Step 1: Initialize MCP client
    print("Connecting to Suwappu MCP...")
    client = McpClient(api_key)
    client.initialize()

    # Step 2: Discover tools
    print("\nDiscovering tools...")
    tools = client.list_tools()
    print(f"Found {len(tools)} tools:")
    for tool in tools:
        desc = tool.get("description", "No description")
        print(f"  - {tool['name']}: {desc}")

    # Step 3: Fetch portfolio
    print(f"\nFetching portfolio for {wallet_address[:10]}...{wallet_address[-6:]}...")
    portfolio = client.call_tool("get_portfolio", {
        "wallet_address": wallet_address,
    })

    if not portfolio.get("balances"):
        print("Portfolio is empty. Fund your wallet first.")
        sys.exit(0)

    # Print holdings
    print(f"\nPortfolio value: ${portfolio['total_usd']:,.2f}")
    for bal in portfolio["balances"]:
        pct = (bal["usd_value"] / portfolio["total_usd"]) * 100
        print(f"  {bal['symbol']:>6} | {bal['balance']:>12} | ${bal['usd_value']:>10,.2f} | {pct:>5.1f}%")

    # Step 4: Fetch prices
    symbols = [b["symbol"] for b in portfolio["balances"]]
    print(f"\nFetching prices for {', '.join(symbols)}...")
    prices = client.call_tool("get_prices", {
        "symbols": ",".join(symbols),
    })
    price_data = prices.get("prices", prices)

    for symbol, data in price_data.items():
        change = data.get("change_24h", 0)
        arrow = "▲" if change > 0 else "▼" if change < 0 else "─"
        print(f"  {symbol}: ${data['usd']:,.2f} {arrow} {change:+.1f}%")

    # Step 5: Fetch supported chains
    print("\nFetching supported chains...")
    chains = client.call_tool("list_chains")

    # Step 6: Generate analysis
    print("\nAnalyzing portfolio...")
    ai_result = analyze_with_ai(portfolio, price_data, chains)

    if ai_result:
        print("\n" + ai_result)
        recommendations = []  # AI provides its own recommendations
    else:
        print("\n(No AI key found — using rule-based analysis)")
        report, recommendations = rule_based_analysis(portfolio, price_data)
        print(report)

    # Step 7: Get quotes for recommendations
    if recommendations:
        print("\nFetching quotes for recommended trades...")
        for rec in recommendations:
            if rec["action"] == "sell":
                # Show quote for selling some of the overweight token
                try:
                    quote = client.call_tool("get_quote", {
                        "from_token": rec["token"],
                        "to_token": "USDC",
                        "amount": "0.1",  # Small sample amount
                        "chain": "ethereum",
                    })
                    print(f"  Sample quote: 0.1 {rec['token']} → {quote.get('to_amount', quote.get('amount_out', '?'))} USDC")
                except Exception as e:
                    print(f"  Could not quote {rec['token']}: {e}")
            elif rec["action"] == "buy":
                try:
                    quote = client.call_tool("get_quote", {
                        "from_token": "USDC",
                        "to_token": rec["token"],
                        "amount": "100",  # $100 sample
                        "chain": "ethereum",
                    })
                    print(f"  Sample quote: 100 USDC → {quote.get('to_amount', quote.get('amount_out', '?'))} {rec['token']}")
                except Exception as e:
                    print(f"  Could not quote {rec['token']}: {e}")

    print("\nDone. This is not financial advice — always do your own research.")


if __name__ == "__main__":
    main()
```

### Running the Python Version

```bash
# Install dependencies
pip install requests

# Required
export SUWAPPU_API_KEY=suwappu_sk_your_api_key
export WALLET_ADDRESS=0xYourWalletAddress

# Optional: enable AI analysis (use one or neither)
export OPENAI_API_KEY=sk-your-openai-key
export ANTHROPIC_API_KEY=sk-ant-your-anthropic-key

# Run the advisor
python mcp_portfolio_advisor.py
```

---

## TypeScript Version

```typescript
#!/usr/bin/env npx tsx
/**
 * Suwappu MCP Portfolio Advisor — TypeScript
 * Custom MCP client that discovers tools, fetches data, and generates investment advice.
 */

const MCP_URL = "https://api.suwappu.bot/mcp";

class McpClient {
  private apiKey: string;
  private requestId = 0;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private nextId(): number {
    return ++this.requestId;
  }

  private async send(method: string, params: Record<string, unknown> = {}) {
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }
    return data.result;
  }

  async initialize() {
    const result = await this.send("initialize");
    const server = result.serverInfo;
    console.log(`Connected to ${server.name} v${server.version}`);
    console.log(`Protocol: ${result.protocolVersion}`);
    return result;
  }

  async listTools() {
    const result = await this.send("tools/list");
    this.tools = result.tools ?? [];
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await this.send("tools/call", { name, arguments: args });
    const content = result.content ?? [];
    for (const part of content) {
      if (part.type === "text") {
        try {
          return JSON.parse(part.text);
        } catch {
          return part.text;
        }
      }
    }
    return content;
  }
}

interface Balance {
  symbol: string;
  chain: string;
  balance: string;
  usd_value: number;
}

interface PriceData {
  usd: number;
  change_24h: number;
}

async function analyzeWithAi(
  portfolio: { balances: Balance[]; total_usd: number },
  prices: Record<string, PriceData>,
  chains: unknown
): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const prompt = `You are a crypto portfolio advisor. Analyze this portfolio and provide actionable recommendations.

Portfolio Holdings:
${JSON.stringify(portfolio, null, 2)}

Current Prices (with 24h change):
${JSON.stringify(prices, null, 2)}

Supported Chains:
${JSON.stringify(chains, null, 2)}

Analyze for:
1. Concentration risk (any single token >50% of portfolio?)
2. Momentum signals (tokens with >5% 24h change)
3. Diversification score (how many tokens, how spread across chains)
4. Stablecoin ratio (is there enough stable allocation for risk management?)

Provide 2-3 specific trade recommendations with reasoning. Format as a clear report.`;

  if (openaiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (anthropicKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);
    const data = await res.json();
    return data.content[0].text;
  }

  return null;
}

interface Recommendation {
  action: string;
  token: string;
  reason: string;
  target?: string;
}

function ruleBasedAnalysis(
  portfolio: { balances: Balance[]; total_usd: number },
  prices: Record<string, PriceData>
): { report: string; recommendations: Recommendation[] } {
  const { balances, total_usd } = portfolio;
  const recommendations: Recommendation[] = [];

  if (total_usd === 0) {
    return { report: "Portfolio is empty. Fund your wallet to get started.", recommendations: [] };
  }

  const lines: string[] = [];
  lines.push("=".repeat(55));
  lines.push("  PORTFOLIO ADVISORY REPORT");
  lines.push("=".repeat(55));

  // 1. Concentration risk
  lines.push("\n  1. CONCENTRATION RISK");
  for (const bal of balances) {
    const pct = (bal.usd_value / total_usd) * 100;
    if (pct > 50) {
      lines.push(`     WARNING: ${bal.symbol} is ${pct.toFixed(1)}% of portfolio (>50%)`);
      recommendations.push({
        action: "sell",
        token: bal.symbol,
        reason: `Over-concentrated at ${pct.toFixed(1)}%`,
        target: "Reduce to <40% by selling into USDC or diversifying",
      });
    } else if (pct > 30) {
      lines.push(`     WATCH: ${bal.symbol} at ${pct.toFixed(1)}% — approaching concentration limit`);
    } else {
      lines.push(`     OK: ${bal.symbol} at ${pct.toFixed(1)}%`);
    }
  }

  // 2. Momentum signals
  lines.push("\n  2. MOMENTUM SIGNALS (24h)");
  for (const [symbol, data] of Object.entries(prices)) {
    const change = data.change_24h ?? 0;
    if (change > 5) {
      lines.push(`     BULLISH: ${symbol} +${change.toFixed(1)}% — consider taking profits`);
    } else if (change < -5) {
      lines.push(`     BEARISH: ${symbol} ${change.toFixed(1)}% — potential buying opportunity`);
      const held = balances.some((b) => b.symbol === symbol);
      if (!held) {
        recommendations.push({
          action: "buy",
          token: symbol,
          reason: `Down ${change.toFixed(1)}% — potential dip buy`,
        });
      }
    } else {
      lines.push(`     NEUTRAL: ${symbol} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`);
    }
  }

  // 3. Diversification
  lines.push("\n  3. DIVERSIFICATION");
  const chains = new Set(balances.map((b) => b.chain));
  const score = Math.min(10, balances.length * 2 + chains.size);
  lines.push(`     Tokens held: ${balances.length}`);
  lines.push(`     Chains used: ${chains.size} (${[...chains].join(", ")})`);
  lines.push(`     Score: ${score}/10`);
  if (balances.length < 3) {
    lines.push("     TIP: Consider diversifying into at least 3-5 tokens");
  }

  // 4. Stablecoin ratio
  lines.push("\n  4. STABLECOIN RATIO");
  const stableSymbols = new Set(["USDC", "USDT", "DAI"]);
  const stableUsd = balances
    .filter((b) => stableSymbols.has(b.symbol))
    .reduce((sum, b) => sum + b.usd_value, 0);
  const stablePct = (stableUsd / total_usd) * 100;
  lines.push(`     Stablecoins: $${stableUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${stablePct.toFixed(1)}%)`);
  if (stablePct < 10) {
    lines.push("     WARNING: Low stablecoin allocation (<10%). Consider increasing for risk management.");
    recommendations.push({
      action: "rebalance",
      token: "USDC",
      reason: "Stablecoin allocation too low for risk management",
    });
  } else if (stablePct > 60) {
    lines.push("     NOTE: High stablecoin ratio (>60%). Capital may be underdeployed.");
  }

  // 5. Recommendations
  lines.push("\n  5. RECOMMENDATIONS");
  if (recommendations.length > 0) {
    recommendations.forEach((rec, i) => {
      lines.push(`     ${i + 1}. ${rec.action.toUpperCase()} ${rec.token}: ${rec.reason}`);
      if (rec.target) lines.push(`        → ${rec.target}`);
    });
  } else {
    lines.push("     No immediate action needed. Portfolio looks balanced.");
  }

  lines.push("");
  return { report: lines.join("\n"), recommendations };
}

async function main() {
  const apiKey = process.env.SUWAPPU_API_KEY;
  if (!apiKey) {
    console.error("Error: Set SUWAPPU_API_KEY environment variable.");
    process.exit(1);
  }

  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    console.error("Error: Set WALLET_ADDRESS environment variable.");
    process.exit(1);
  }

  // Step 1: Initialize MCP client
  console.log("Connecting to Suwappu MCP...");
  const client = new McpClient(apiKey);
  await client.initialize();

  // Step 2: Discover tools
  console.log("\nDiscovering tools...");
  const tools = await client.listTools();
  console.log(`Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description ?? "No description"}`);
  }

  // Step 3: Fetch portfolio
  console.log(`\nFetching portfolio for ${walletAddress.slice(0, 10)}...${walletAddress.slice(-6)}...`);
  const portfolio = await client.callTool("get_portfolio", { wallet_address: walletAddress });

  if (!portfolio.balances?.length) {
    console.log("Portfolio is empty. Fund your wallet first.");
    process.exit(0);
  }

  console.log(`\nPortfolio value: $${portfolio.total_usd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  for (const bal of portfolio.balances) {
    const pct = (bal.usd_value / portfolio.total_usd) * 100;
    console.log(
      `  ${bal.symbol.padStart(6)} | ${bal.balance.padStart(12)} | $${bal.usd_value.toFixed(2).padStart(10)} | ${pct.toFixed(1).padStart(5)}%`
    );
  }

  // Step 4: Fetch prices
  const symbols = portfolio.balances.map((b: Balance) => b.symbol);
  console.log(`\nFetching prices for ${symbols.join(", ")}...`);
  const priceResult = await client.callTool("get_prices", { symbols: symbols.join(",") });
  const priceData: Record<string, PriceData> = priceResult.prices ?? priceResult;

  for (const [symbol, data] of Object.entries(priceData)) {
    const change = data.change_24h ?? 0;
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "─";
    console.log(`  ${symbol}: $${data.usd.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${arrow} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`);
  }

  // Step 5: Fetch chains
  console.log("\nFetching supported chains...");
  const chains = await client.callTool("list_chains");

  // Step 6: Generate analysis
  console.log("\nAnalyzing portfolio...");
  const aiResult = await analyzeWithAi(portfolio, priceData, chains);

  let recommendations: Recommendation[] = [];
  if (aiResult) {
    console.log("\n" + aiResult);
  } else {
    console.log("\n(No AI key found — using rule-based analysis)");
    const analysis = ruleBasedAnalysis(portfolio, priceData);
    console.log(analysis.report);
    recommendations = analysis.recommendations;
  }

  // Step 7: Get quotes for recommendations
  if (recommendations.length > 0) {
    console.log("\nFetching quotes for recommended trades...");
    for (const rec of recommendations) {
      if (rec.action === "sell") {
        try {
          const quote = await client.callTool("get_quote", {
            from_token: rec.token,
            to_token: "USDC",
            amount: "0.1",
            chain: "ethereum",
          });
          console.log(`  Sample quote: 0.1 ${rec.token} → ${quote.to_amount ?? quote.amount_out ?? "?"} USDC`);
        } catch (e) {
          console.log(`  Could not quote ${rec.token}: ${e}`);
        }
      } else if (rec.action === "buy") {
        try {
          const quote = await client.callTool("get_quote", {
            from_token: "USDC",
            to_token: rec.token,
            amount: "100",
            chain: "ethereum",
          });
          console.log(`  Sample quote: 100 USDC → ${quote.to_amount ?? quote.amount_out ?? "?"} ${rec.token}`);
        } catch (e) {
          console.log(`  Could not quote ${rec.token}: ${e}`);
        }
      }
    }
  }

  console.log("\nDone. This is not financial advice — always do your own research.");
}

main().catch(console.error);
```

### Running the TypeScript Version

```bash
# Install tsx for running TypeScript directly
npm install -g tsx

# Required
export SUWAPPU_API_KEY=suwappu_sk_your_api_key
export WALLET_ADDRESS=0xYourWalletAddress

# Optional: enable AI analysis (use one or neither)
export OPENAI_API_KEY=sk-your-openai-key
export ANTHROPIC_API_KEY=sk-ant-your-anthropic-key

# Run the advisor
npx tsx mcp_portfolio_advisor.ts
```

---

## Example Output

```
Connecting to Suwappu MCP...
Connected to suwappu v0.4.0
Protocol: 2024-11-05

Discovering tools...
Found 6 tools:
  - get_quote: Get a swap quote for a token pair
  - execute_swap: Execute a previously obtained quote
  - get_portfolio: Check token balances for a wallet
  - get_prices: Get current prices for one or more tokens
  - list_chains: List all supported blockchain networks
  - list_tokens: Search and list available tokens

Fetching portfolio for 0xd8dA6BF2...96045...

Portfolio value: $48,250.75
     ETH |       12.500 | $43,755.25 | 90.7%
    USDC |     3,200.00 |  $3,200.00 |  6.6%
     DAI |     1,295.50 |  $1,295.50 |  2.7%

Fetching prices for ETH, USDC, DAI...
  ETH: $3,500.42 ▲ +2.5%
  USDC: $1.00 ─ +0.0%
  DAI: $1.00 ─ +0.0%

Analyzing portfolio...

(No AI key found — using rule-based analysis)
=======================================================
  PORTFOLIO ADVISORY REPORT
=======================================================

  1. CONCENTRATION RISK
     WARNING: ETH is 90.7% of portfolio (>50%)
     OK: USDC at 6.6%
     OK: DAI at 2.7%

  2. MOMENTUM SIGNALS (24h)
     NEUTRAL: ETH +2.5%
     NEUTRAL: USDC +0.0%
     NEUTRAL: DAI +0.0%

  3. DIVERSIFICATION
     Tokens held: 3
     Chains used: 1 (ethereum)
     Score: 7/10
     TIP: Consider diversifying into at least 3-5 tokens

  4. STABLECOIN RATIO
     Stablecoins: $4,495.50 (9.3%)
     WARNING: Low stablecoin allocation (<10%).

  5. RECOMMENDATIONS
     1. SELL ETH: Over-concentrated at 90.7%
        → Reduce to <40% by selling into USDC or diversifying
     2. REBALANCE USDC: Stablecoin allocation too low

Fetching quotes for recommended trades...
  Sample quote: 0.1 ETH → 349.50 USDC

Done. This is not financial advice — always do your own research.
```

---

## Customization Tips

### Add More Analysis Rules

Extend the rule-based engine with additional checks:

```python
# Check for tokens with very small positions (dust)
for bal in balances:
    if bal["usd_value"] < 10:
        recommendations.append({
            "action": "sell",
            "token": bal["symbol"],
            "reason": f"Dust position (${bal['usd_value']:.2f}) — consolidate or remove",
        })
```

### Use a Different AI Model

Swap the model by changing the model parameter:

```python
# Use a cheaper/faster model
"model": "gpt-4o-mini"

# Or use Claude Haiku for speed
"model": "claude-haiku-4-5-20251001"
```

### Schedule Regular Reports

Run the advisor on a cron schedule to get daily portfolio insights:

```bash
# Run every morning at 8am UTC
0 8 * * * SUWAPPU_API_KEY=suwappu_sk_... WALLET_ADDRESS=0x... python /path/to/mcp_portfolio_advisor.py >> /var/log/advisor.log 2>&1
```

### Auto-Execute Recommendations

Add a `--execute` flag to automatically act on recommendations:

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--execute", action="store_true", help="Auto-execute recommended trades")
args = parser.parse_args()

if args.execute and recommendations:
    for rec in recommendations:
        # Execute via MCP tools instead of just quoting
        quote = client.call_tool("get_quote", {...})
        result = client.call_tool("execute_swap", {
            "quote_id": quote["quote_id"],
            "wallet_address": wallet_address,
        })
        print(f"Executed: {result}")
```
