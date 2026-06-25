# Own Agents & Custom Models — Build-the-Moat Strategy

**Status:** Research / proposal · **Date:** 2026-06-25 · **Owner:** TBD
**Companion to:** [`llm-reseller-strategy.md`](./llm-reseller-strategy.md) (reselling base models)

This is the "build a moat instead of reselling commodity tokens" angle. Two questions:
**(1) Can we have our own *custom/fine-tuned* model?** and **(2) Should we ship our own
*agents*?** The research answer flips the priority order: **the model layer is a
commodity; our defensible asset is the tooling + MCP server + x402 we already own.**

> **TL;DR**
> - **You cannot fine-tune Claude or GPT‑5.5.** Anthropic offers *no* first-party
>   fine-tuning; OpenAI is *winding down* its fine-tuning platform (closed to new users,
>   GPT‑5.x not tunable). "Custom model" = **open-weights only** (Qwen3, gpt‑oss, Gemma,
>   DeepSeek distills).
> - For a domain like ours, **cheap API + good prompting + RAG beats fine-tuning** for
>   almost everything. Fine-tuning only pays off for **one narrow thing**: structured
>   parsing/intent classification at volume — and it's ~$10 to *test*, so test before
>   committing.
> - **The moat is agents, not models.** We already hold the three scarce pieces — **bot
>   tooling, an MCP server, and x402 micropayments**. The differentiated product is a
>   **paid, x402-metered MCP server** that *other people's agents* pay per call, plus
>   user-facing agentic features on the same tool layer.

---

## 1. Custom / fine-tuned models — the reality

### 1a. You can't fine-tune the frontier models
| Provider | Fine-tuning status (mid-2026) |
|---|---|
| **Anthropic / Claude** | **None.** No first-party fine-tuning endpoint, ever, for current models. Only legacy **Claude 3 Haiku SFT on Bedrock** (old model). Sonnet/Opus/Haiku 4.x and Fable: **not tunable.** Anthropic steers you to prompt caching, **Agent Skills**, long context, the memory tool, and RAG. |
| **OpenAI** | **Winding down.** Platform **closed to new users**; GPT‑5.x **not** fine-tunable. Legacy SFT/DPO/RFT only on `gpt-4.1*` / `o4-mini`, served at ~2× base price. A new account likely can't onboard. |
| **AWS Bedrock** | **Custom Model Import = open-weight architectures only** (Llama, Qwen, Mistral, **gpt‑oss**, Flan‑T5, GPTBigCode). **Claude cannot be imported.** Serving requires **Provisioned Throughput (~$21–50/hr per model unit, monthly commit)** — a real fixed cost. |

**Conclusion:** "custom-tuned Claude" / "custom GPT‑5.5" is not a thing you can buy. A
genuinely custom *weights-level* model means fine-tuning an **open-weight** base.

### 1b. The customization ladder — climb it in order
Every provider says the same thing: exhaust the cheap rungs first.

1. **Prompt engineering + few-shot** — free, instant. Beats fine-tuning more often than not.
2. **Prompt caching** — cache a long DeFi/system context; ~10% of input cost on reads.
   (Claude's answer to "make it know our domain cheaply.")
3. **RAG** — for anything that changes (prices, new tokens, docs). Fine-tuning *cannot*
   do fresh data; RAG can.
4. **Agent Skills** (Claude) — package domain procedures/instructions, loaded on demand.
5. **Fine-tuning (open-weight, LoRA)** — *only* if 1–4 plateau on a **narrow, well-defined**
   task and you have 200–500 quality examples.

### 1c. The one place fine-tuning might pay off for us
A **small open-weight model specialized for command parsing / intent classification** —
e.g. turning `"swap 0.5 eth to usdc on base"` or a messy NL message into a structured
intent, or routing `/s /w /b /p /snipe`-style commands. This is exactly the narrow,
structured task where LoRA wins, and where today every call hits a general model.

- **Base candidates (commercial-friendly):** **Qwen3‑8B** or **gpt‑oss‑20B** (Apache‑2.0),
  Gemma 4 small, DeepSeek distills (MIT). Avoid Llama's restricted community license for a
  commercial product.
- **Cost to test:** **~$6–$12** — a QLoRA run on a rented A100 ($1.19–$2/hr × 2–6 hrs)
  with **200–500 curated examples** (some narrow tasks hit ~92% on ~150). Tooling:
  **Unsloth** (fastest) or Axolotl.
- **Serving with zero idle cost:** **serverless LoRA** on **Predibase** (free up to
  ~1M tok/day) or **Fireworks** (fine-tuned served at base-model rate) — many adapters on a
  shared base, **~$0.05–0.20/1M tokens**. **Together** lets you download the weights
  (portability / no lock-in).
- **Don't stand up your own GPU** until sustained volume exceeds **~25M+ tokens/day** (a
  dedicated H100 is ~$5k/mo; below that, serverless or a plain cheap API wins).

**Verdict on custom models:** default to **cheap API + prompting + RAG**. Run **one $10
LoRA experiment** on command-parsing only if prompting accuracy is the measured
bottleneck. Everything else is premature.

---

## 2. Own agents — where the real leverage is

We already have the **three scarce pieces** most teams lack:
**(1)** real bot tooling (swap, quote, portfolio, alerts, copy-trade, perps),
**(2)** an **MCP server** (`api-ts/src/routes/agent.ts`), and
**(3)** **x402** micropayments (`bot/services/x402_service.py`, x402 middleware).

The model is the commodity. These three are the moat.

### 2a. Three productization tiers

| Tier | What | Differentiation | Verdict |
|---|---|---|---|
| **(a) User-facing agentic features** | An in-bot swap / research / portfolio agent that plans + calls our tools for our own users | Medium — UX win, but a "chat over a model" is copyable | **Build now** — fast, low-risk, retention win |
| **(b) Paid x402-metered MCP server** | Expose swap/quote/portfolio/alert tools that *other people's agents* (ChatGPT Apps, Claude, ElizaOS bots) call and **pay per invocation via x402** | **High** — cross-chain execution + real liquidity is hard to replicate; <5% of MCP servers are monetized today | **The differentiated bet** |
| **(c) Autonomous trading agent** | A bot that trades on its own | Low — everyone has one; highest custody/liability risk | **Skip as a product** — make it a *feature* inside (a), gated by strict spend policies |

### 2b. Why (b) is the moat
- The **x402 standard is real and battle-tested** — 50M+ transactions, folded into
  Google's **AP2** agent-payments standard; Coinbase **AgentKit** ("every agent deserves a
  wallet"), Kraken/Binance/OKX shipped agent toolkits. The agent economy is arriving and it
  **pays in stablecoins**.
- The x402 flow *is* the monetization primitive: an agent hits our endpoint → HTTP **402 +
  price** → pays USDC from its wallet → retries with proof. That's a **paid MCP tool call**.
  We already implement the hard half.
- A chat wrapper over GPT‑5.5 is commodity; **cross-chain swap execution with real
  liquidity, sold per-call to the agent economy, is not.** This is the one thing competitors
  can't copy by swapping a `base_url`.

### 2c. Build options for the agent layer
Build the **MCP tool layer once**; let multiple front-ends consume it.

- **Anthropic Claude Agent SDK / Managed Agents** — hosted agent loop, sessions,
  environments, Skills, the `outcomes` (rubric-graded) loop. **Cost gotchas:** Managed
  Agents bill **token rates + ~$0.08/session-hour**, no Batch discount; the Agent SDK moved
  to a separate monthly credit pool (Jun 15 2026). Good for a managed, low-ops agent.
- **OpenAI Agents SDK + AgentKit** — handoffs, guardrails, tracing, hosted tools; **Apps
  SDK** ships an interactive app *inside ChatGPT* (built on MCP) — a distribution channel to
  ~800M users. Free SDK, pay usage.
- **Pydantic AI** (type-safe, validated I/O — best for **money-path correctness**, which
  matters when an agent moves funds) or **LangGraph** (stateful, durable, audit/rollback)
  for self-hosted control. **CrewAI** for fast prototyping.
- **MCP is the universal adapter.** Wrap our tools once as an MCP server and *any* model or
  agent — Claude, ChatGPT Apps, Cursor, ElizaOS — calls them unmodified. The 2026 MCP spec
  adds a stateless core + Tasks, simplifying remote hosting.

**Apply the agent-tier gate** (from Anthropic's agent-design guidance) before building any
agent: only go agentic when the task is genuinely **multi-step + hard to fully specify**,
the **value justifies the cost/latency**, the model is **capable** at it, and **errors are
recoverable**. For a single swap quote, a single tool call beats an agent loop.

---

## 3. How this changes the reseller plan

The two docs combine into one coherent strategy, in priority order:

1. **Foundation (both docs):** the LiteLLM multi-provider proxy behind our credits system
   (see reseller doc §5). One integration unlocks every model for both reselling *and* our
   own agents.
2. **Moat (this doc §2b):** the **paid x402 MCP server** — our tools, sold per-call to the
   agent economy. This is the differentiated product; the model proxy is just plumbing
   underneath it.
3. **Retention (this doc §2a):** user-facing swap/research/portfolio agents on the same
   tool layer.
4. **Optional optimization (this doc §1c):** a $10 LoRA experiment to cut command-parsing
   cost — *only* if measured as a bottleneck.

**The reframe:** don't position as "a reseller of Anthropic/OpenAI" (thin margin,
ToS-constrained, commodity). Position as **"the execution layer for the crypto agent
economy"** — we sell *actions* (swaps, quotes, portfolio) priced in credits/x402, and the
models are interchangeable inputs we buy at wholesale.

---

## 4. Recommended next steps

1. **Don't fine-tune anything yet.** Confirm the cheap-API + prompting + RAG baseline first.
2. **Spike the paid MCP server (b):** add x402 pricing to a couple of existing MCP tools
   (quote, portfolio) so an external agent can pay-per-call. We already have the x402
   middleware — this is wiring, not new infra.
3. **Ship one user-facing agent (a):** a Suwappu swap/portfolio agent built on the Claude
   Agent SDK or Pydantic AI, over the *same* MCP tools.
4. **Backlog the LoRA experiment (1c):** only if command-parsing accuracy/cost is measured
   as a real pain point. Budget ~$10 + a 200–500-example dataset; serve serverless.
5. **Skip:** Claude/GPT fine-tuning (impossible), dedicated GPU hosting (premature), an
   autonomous trading *product* (commodity + liability).

---

### Sources

- Fine-tuning: [OpenAI model optimization](https://developers.openai.com/api/docs/guides/model-optimization) ·
  [Anthropic: fine-tune Claude 3 Haiku (legacy)](https://www.anthropic.com/news/fine-tune-claude-3-haiku) ·
  [Bedrock custom model import](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html) ·
  [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- Open-weight FT/serving: [Fireworks pricing](https://fireworks.ai/pricing) ·
  [Predibase pricing](https://predibase.com/pricing) ·
  [RunPod fine-tuning guide](https://www.runpod.io/articles/guides/how-to-fine-tune-large-language-models-on-a-budget) ·
  [dataset size vs FT](https://latitude.so/blog/dataset-size-impacts-llm-fine-tuning)
- Agents: [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents) ·
  [AgentKit](https://openai.com/index/introducing-agentkit/) ·
  [Apps SDK (in-ChatGPT, MCP-based)](https://developers.openai.com/apps-sdk) ·
  [agent framework comparison](https://www.speakeasy.com/blog/ai-agent-framework-comparison)
- Crypto agents / x402: [Coinbase AgentKit](https://github.com/coinbase/agentkit) ·
  [x402 use cases](https://www.xpay.sh/blog/article/x402-protocol-use-cases/) ·
  [paid MCP + x402](https://zuplo.com/blog/mcp-api-payments-with-x402)

*Caveat: fine-tuning availability and model IDs are mid-2026 snapshots; OpenAI's wind-down
and per-provider FT support shift quickly — re-verify before committing engineering time.*
