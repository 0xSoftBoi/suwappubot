# Relay support center digest (support.relay.link, 35 articles, crawled 2026-09-13)

Full text: `docs-crawl/support-center.md`. The help center is where a product admits what breaks. Five collections: Getting Started (8), Problems with my Transaction (6), Adding a New Chain to My Wallet (5), Safety, Security & Loss Prevention (6), FAQ (10).

## What the articles reveal
| Topic | What Relay tells users | What it tells us |
|---|---|---|
| Fees on withdrawals to L2/L3 | "you might notice a fee between 1% to 5% if you want to send funds from an L2 or L3 to another chain" because the native bridge back can take 7+ days and the solver prices that capital lock-up | Their "1 bp" pricing is for liquid corridors only. On long-tail L2/L3 exits they charge 100–500 bps. Our benchmark should include a Shape/Zora-style exit before we claim parity. |
| Native bridge wait time | "up to 7 days… set by the chains themselves"; the prove-withdrawal tx is shown on the transaction page | Some Relay routes are not instant at all; they fall back to canonical bridging (`useExternalLiquidity`). Time estimates must come from the quote, never assumed. |
| Deposit addresses | "bridge without connecting a wallet… The quote pricing is guaranteed for 30s and afterwards is subject to pricing changes" | Deposit-address quotes have a 30 s guarantee. A chat-native "send to this address" flow needs to re-quote on arrival, which Relay does automatically (regenerated requests carry `supersededByRequestId`). |
| Fiat onramp | MoonPay, two steps: fiat → USDC (Base/Polygon/Ethereum) or ETH, then a Relay swap into the desired token, region-dependent | Onramp is real and undocumented in the developer docs. For us the same two-step shape works with any onramp partner. |
| Approvals | "Relay currently limits this approval to the amount you are swapping" | Matches our executor's rule (approve ≤ input). Say it in the UI the way they do. |
| Funds not arriving | "do not send the transfer again"; status banner Success / Processing / Failure; Fill side empty while processing | The single most useful support line. Our bot message for a pending bridge should say the same thing. |
| Stuck funds and withdrawals | "In rare cases, a cross-chain transaction does not complete. When this happens, your funds are held safely in the Relay Hub… Visit relay.link/withdraw and connect the wallet you used to send the funds" | Unfilled deposits require a user-initiated withdrawal from the depository via the protocol's withdrawal flow (three keyless, signature-authorized endpoints, see 08-api-reference.md). If we route through Relay, our support runbook needs this path and our poller must surface `refund`/`failure` so the user is told to withdraw. |
| Request logs | Ctrl+I on a transaction page opens the raw quote: `amountUsd`, `slippageBps`, `guaranteedAmount`, `recipient`, `tradeType`, chain ids | A power-user transparency feature we can copy cheaply: attach the quote JSON to our transaction detail. |
| Token and rewards | "There are no official tokens as of today, so please be weary of anyone offering Relay tokens." "We at Relay do not offer an reward or token at this time"; they list third-party chain rewards (Blast, Taiko, Cyber) instead | Confirms the points/season gap is real and acknowledged. |
| Security | Phishing guide, wallet hygiene, MEV sandwich guide, "Malicious EIP-7702 Delegations and How to Stay Safe", compromised-wallet steps, "Why Direct Theft Without Private Keys is Impossible" | They are fielding 7702 delegation scams already, relevant if we adopt Calibur-style gasless. |
| Partner-specific | "I used Fantasy and can't find my funds", "I used Wolf Game and can't find my funds", "How do I export my Fantasy or Wolf wallet?" | Embedded-wallet games route through Relay; their users show up in Relay's support queue. Integrator concentration becomes support concentration. |
| Wallet chain switching | Six articles on changing chains in Phantom, Magic Eden, Binance Web3, Trust, Ledger blind signing, Degen Chain | The dominant support load is wallet UX, not Relay. A bot that owns the wallet removes this whole category. |

## Copy worth borrowing
- "Most transfers arrive within moments. If yours has not shown up yet, the transaction page will tell you exactly where it is. Start there before doing anything else, and do not send the transfer again."
- "Relay currently limits this approval to the amount you are swapping, which ensures that only the necessary amount is approved."
- "The quote pricing is guaranteed for 30s."

## Gaps we can exploit
1. Their long-tail L2/L3 exits cost 1–5%. If our router finds a cheaper canonical or third-party path, show the saving.
2. Their stuck-funds remedy is a manual withdrawal page. Ours can be a bot button that runs the same three endpoints.
3. No rewards. Every article that says "we do not offer a reward" is a line we can contradict.
