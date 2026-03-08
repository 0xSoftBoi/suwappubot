# SDK Tools Panel — Showcase Infra Panel Redesign

## Context

Replace the current Infra panel (panel 2 in horizontal scroll) with an AgentCard-style two-column layout: terminal + copy on the left, tools reference grid on the right. The 3D scatter background stays.

## Design

### Layout

Two columns on desktop, stacked on mobile. Dark background with the existing 3D petal scatter behind.

**Left column:**
- Pitch copy: "Give your agent direct access to cross-chain swaps — get quotes, execute trades, and check balances across 15 chains."
- Terminal block with dots + "terminal" label
- Command: `$ bun add @suwappu/sdk`
- Sub-line: "One line to swap." + Copy button
- Footer text: "Set `SUWAPPU_API_KEY` and your agent connects automatically — no manual setup needed."

**Right column — 6 tools:**
- `get_quote` — Best swap route for a token pair on any chain.
- `execute_swap` — Execute a previously quoted swap on-chain.
- `get_portfolio` — Wallet balances across all connected chains.
- `get_prices` — Current token prices in USD.
- `list_chains` — All supported chains and their status.
- `list_tokens` — Popular tokens available on a chain.

Each tool: name in monospace/bold with description in muted text. Simple rows, no cards, no boxes.

### Copy button

Copies `bun add @suwappu/sdk` to clipboard. Brief "Copied!" feedback (swap text for 2s, then revert).

### Mobile

Left column stacks on top, tools grid below. Terminal block stays full-width. Tools list becomes single column.

### What stays

- 3D scatter variant behind content (desktop only)
- Panel component wrapper
- useScrollContext for progress tracking

### What goes

- Current COMMANDS data array
- "Your agent swaps here." headline
- "15 chains · non-custodial · bun-native" footer line

## Files to modify

1. `showcase/src/app/page.tsx` — rewrite InfraPanel component
