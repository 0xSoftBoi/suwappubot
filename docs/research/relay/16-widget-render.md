# Relay's product UI, rendered from their own widget (2026-09-08)

relay.link is behind a Vercel bot challenge, so instead of screenshotting their site we mounted their published widget, `@relayprotocol/relay-kit-ui@11.0.6` (React 19, wagmi 2, viem, TanStack Query), in a scratch page and drove it against the live API. This is the same component embedded by fomo and available to every integrator, so it is the product most Relay users actually touch. Screenshots: `screenshots/widget-*.png`, extracted text in the sibling `.txt` files.

## What the widget does on load (network log)
1. `GET /chains?referrer=<host>` and `GET /currencies/trending?referrer=<host>` (the trending list powers the token selector's "Global 24H Volume" ordering).
2. `POST /currencies/v2` for the token lists per chain.
3. `GET /currencies/token/price?address=…&chainId=…` for the USD labels on both sides.
4. `POST /quote/v2` as soon as an amount is present, with `user` and `recipient` set to placeholder addresses when no wallet is connected (`0x…dead` as user; an internal placeholder as recipient), so a visitor sees a real quote before connecting.
5. Analytics callbacks fire on `SWAP_INPUT_FOCUSED`, `QUOTE_REQUESTED`, `QUOTE_ERROR`, etc. via the `onAnalyticEvent` prop; nothing is sent to a third-party analytics host by the package itself.

**The widget always sends `referrer=<your hostname>`**, and the API rejects `referrer` without `x-api-key`. Out of the box it shows "Please provide an api key" in a red banner (captured in the first render). Every widget integrator therefore runs a proxy with a key; the widget is a lead-capture device for their dashboard.

## The screens
### Quote card (`widget-dark-quote-usdc-eth.png`, `widget-light-quote.png`, `widget-mobile-quote.png`)
- Two stacked cards labelled **Sell** and **Buy**, a circular arrow between them to flip, token pill on the right showing symbol + chain name + chain badge on the logo.
- Under the sell amount: USD value and a toggle to type in USD instead of token units.
- Under the buy amount: USD value and the impact vs input in parentheses, e.g. `$248.69 (-0.51%)` on a $250 USDC → ETH Arbitrum quote, `$24.85 (-0.59%)` on $25. That parenthetical is the total cost of the trade in one number, which is the clearest fee disclosure in the category.
- **Enter Address** chip on the buy side: recipient can differ from sender without a settings menu.
- A third card: **Max Slippage** with `Auto` and the resolved value (`1.99%` / `2%`), the rate line `1 USDC = 0.0004 ETH`, a clock icon with `~ 1s`, a gas-pump icon with `< $0.01`, and a chevron that expands the fee breakdown.
- One primary button: **CONNECT WALLET** (becomes the swap button once connected). Uppercase, full width, saturated violet.
- Mobile (390 px) is the same layout, single column, nothing hidden.

### Token selector (`widget-token-selector.png`, `widget-mobile-selector.png`)
- Modal titled **Select Token** with a left rail of chains ("Search chains", **All Chains**, **Starred Chains** with star toggles, then "Chains A-Z") and a right list with "Search for a token or paste address".
- Default ordering header: **Global 24H Volume**. First rows: USDC (Ethereum), USDT (Ethereum), ETH (Ethereum), ETH (Base), cbBTC (Base), USDC (Arbitrum), then a memecoin (LAPTOP on Base) with a warning triangle, then PYUSD. Unverified tokens get a warning icon but are still listed and tradable.
- Addresses shown truncated next to the chain name, so users can disambiguate same-symbol tokens.

### Error state (`widget-dark-quote-usdc-sol.png`)
With SOL as destination and no wallet connected the widget shows `Invalid recipient address 0xf3d6…691e for chain 792703809`: the placeholder recipient is an EVM address, which the API rejects for Solana. It also leaks an internal address (the depository owner) into the UI. Minor, but it shows the cross-VM path is bolted onto an EVM-first component.

## Design language (observed, not inferred)
- Typeface: a geometric sans (Inter-class), bold numerals for amounts, light gray secondary labels.
- Palette: near-black `#0b0b0f`-style background in dark mode, white cards in light mode, one accent violet (~`#4b1cf5`) for the primary button, chips, and stars. Chain badges are overlaid on token logos. No gradients, no illustration.
- Corners: large radii (16–20 px) on cards, pill radii on token buttons. Cards have a 1 px hairline border in dark mode.
- Copy: "Sell / Buy", not "From / To"; "Max Slippage"; time and gas as icons with a number. Nothing says "bridge".
- Sizes: the card column is ~440 px wide at desktop; the modal is ~1000 px.

## Behaviour worth copying in Suwappu
1. **One-number cost disclosure** next to the output amount: `$24.85 (-0.59%)`. Our `/s` and webapp confirm should show the same: output in USD and the percent lost to fees and impact.
2. **Quote before connect.** The widget quotes with a placeholder user so nothing is gated behind wallet connection. Our inline query and webapp can quote before the wallet is unlocked.
3. **Time and gas as icons** with a number, not a paragraph.
4. **Trending-by-volume token list** with warning icons on unverified tokens. We have token security data; a shield icon instead of a warning triangle would be our version.
5. **Recipient as a chip**, not a hidden setting: cross-chain sends to a friend are a first-class case in Telegram.

## Behaviour to avoid
- Requiring an API key for the embeddable widget makes every hobby integration fail on first render. Our SDK should work keyless with a low rate limit.
- Placeholder recipient leaking an internal address on cross-VM.
- 2% default slippage on a stable-to-ETH quote is high for a $25 ticket; our default is 0.5%.
