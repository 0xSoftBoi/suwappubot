# WebMCP Challenge — judges, criteria, and what to nail

Research date: 2026-08-30. Deadline: **Sept 3, 2026, 1:00pm PDT**.
Challenge: **OpenAI WebMCP Challenge** — https://openai.com/webmcp-challenge/ →
Devpost https://webmcp.devpost.com/ ($35k pool, top 10 teams win; co-sponsored
by Chrome, Cloudflare, Shopify, Vercel, Render, Netlify).

## Official judging criteria (verbatim, equally weighted)

1. **WebMCP Leverage** — "How thoroughly and skillfully does the project use WebMCP?"
2. **Execution** — "Does the project deliver a working or runnable project that has a complete, coherent product experience?"
3. **Potential Impact** — "Does the project make a credible, specific case for solving a real problem?"
4. **Creativity & Ambition** — "How creative and novel is the concept and does the project differ from existing concepts?"

## The judges and what each one values

| Judge | Who | What they reward |
|---|---|---|
| **Justin Rushing** | Browser Platform Lead, OpenAI (ChatGPT Atlas agent mode) | Scoped agent permissions ("agent is only ever operating on your tabs"); OpenAI's own WebMCP docs: unambiguous tool names, **website tool defs/results are untrusted content**, confirmation before consequential actions, preserve the human UI. https://learn.chatgpt.com/docs/webmcp |
| **Alex Nahas** | Creator of MCP-B, W3C WebMCP co-originator | His taxonomy: read tools flat in context; **navigation tools = "the system prompt of your website"**; write tools confirm before firing. WebMCP as **progressive enhancement** — same page serves humans and agents; session-auth (no OAuth/key) is the whole point. Still flags the "lethal trifecta" as unsolved. https://www.arcade.dev/blog/web-mcp-alex-nahas-interview/ |
| **Sarah Drasner** | Distinguished Engineer, Chrome — "AI Web Ecosystem" | "Rigorous focus on **security, privacy, and user observability**"; "safe, standardized, mutually beneficial interactions"; WebMCP as a proper interface layer vs. UI reverse-engineering. Front-end craft/DX lens. https://x.com/sarah_edo/status/2041887347068080128 |
| **Ilya Grigorik** | Distinguished Engineer, Shopify (Universal Commerce Protocol) | Real **transactional commerce** over toy demos; structured real-time data contracts over scraping; standards interop (W3C agentic-commerce workshop). https://shopify.engineering/ucp |
| **Jude Gao** | Vercel, Next.js core team (next-devtools-mcp) | Framework-grade **execution and DX polish** — does the integration work cleanly in a real Next.js app; code quality; adoptability. https://github.com/gaojude |
| **Andrew Galloni** | VP Research & Innovation, Cloudflare | "Agents are a **new kind of visitor**"; the agentic web must be "readable, discoverable, callable, and **payable**" — x402-style payments and access control are first-class. https://blog.cloudflare.com/author/andrew-galloni/ |
| **Sean Roberts** | VP Applied AI, Netlify ("Agent Experience") | "Protocols like MCP are **just plumbing**" — end-to-end AX wins: discovery, reliable execution, graceful recovery. "Orchestra, not jam session": **curated tool surface** over sprawl. Humans stay in control. https://tessl.io/podcast/agent-experience-is-the-new-developer-experience-sean-roberts/ |

## Ranked: what the submission must nail for THIS panel

1. Real working tools on a real product (Rushing, Gao, "Execution").
2. Read / navigation / write taxonomy done right; write tools confirm (Nahas, OpenAI docs).
3. Visible human-in-the-loop confirmation for anything consequential (Rushing, Roberts).
4. Untrusted-content discipline both directions; narrow attack surface, observability (Drasner, OpenAI docs, Nahas).
5. Credible transactional/commerce problem with structured data, not scraping (Grigorik, "Impact").
6. Spec fidelity — `document.modelContext`, `toolchange`, abort signals — not a proprietary bolt-on (Drasner, Grigorik).
7. The human UI keeps working without WebMCP — progressive enhancement (Nahas, OpenAI docs).
8. A discoverability story: how does an agent *find* and trust these tools (Galloni).
9. Curated, intentional tool surface — few, reliable, well-described (Roberts).
10. Why this had to be WebMCP (in-page, session-scoped, key-free) rather than a backend MCP server (Nahas, "Creativity").
11. A payable/x402 thread scores bonus with Galloni — Suwappu already runs x402 metering on the API the mandate compiles toward.
12. Demo/live-app reliability — flakiness reads as unfinished to at least 3 of 7 judges.

## Verification notes

- openai.com page 403'd direct fetch; facts corroborated via Devpost + press.
- Drasner/Grigorik X quotes via search summaries, not direct tweet reads.
- No confirmation the 7 names are the *complete* panel.
