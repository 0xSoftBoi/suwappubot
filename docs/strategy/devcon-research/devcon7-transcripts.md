# Devcon 7 (Bangkok, Nov 2024): transcript-level findings

Source: the 410 transcripts returned by `api.devcon.org/sessions?event=devcon-7` (the `transcript_text` field), read 2026-11-06.
URLs: `https://archive.devcon.org/devcon-7/<slug>`.

**Data problems**
- `why-erc-7683-is-broken-and-how-to-fix-it`: the transcript is truncated at about 1,100 words.
- `chain-abstraction-is-risk-abstraction`: the transcript is empty.
- `the-end-of-self-custodial-wallets`: the middle of the transcript is garbled.
- `does-ethereum-really-need-pbs...` and `smart-accounts-need-smart-sessions`: each file holds the wrong talk.

These five were queued for Whisper re-transcription.

## Talks

| Talk (slug) | Speaker | Core argument | Quote |
|---|---|---|---|
| why-erc-7683-is-broken-and-how-to-fix-it | Vaibhav Chellani (Socket) | 7683 standardises the intent struct to stop filler fragmentation. But only 15–20 fillers exist, and fields like `calldata` already split them. (From the description, not the transcript: it forces fillers to understand every order and gives users no execution guarantee; the fix is to standardise further downstream.) | "There are probably 15 to 20 entities that are operating in this particular role. And if you start fragmenting those, we don't know where we'll end up." |
| exploring-various-approaches-...-intent-based-protocols | Mounir Benchemled (Velora/Paraswap) | The intent-system API is a single point of failure. Make the API optional so users can relay their own orders. FHE is far too slow for trading. He doubts general-purpose intents. | "that API, which acts as a central point of failure, if it stops working, the whole system is not useful." |
| chain-abstraction-but-i-want-to-know-where-my-tokens-are | Konrad Urban (Peanut) | Abstraction makes the app the curator of the infrastructure underneath. Hiding risk wins in the short term, which drives a race to the bottom. The market doesn't price bridge risk. | "either you expose the risk… or you curate it for them and then don't get surprised if people will spam your support email if they lose their funds" |
| fair-combinatorial-auction-for-trade-intents | Andrea Canidio (CoW) | Single-order auctions (Fusion, UniswapX) give up batching gains (coincidence of wants, gas). Fair surplus sharing without a numeraire is hard. | — |
| achieving-chain-abstraction-through-transaction-orchestration | Mislav Javor (Biconomy) | "Super transactions": the user signs one Merkle root covering userops, intents and payments. Atomicity is soft, backed by pre-signed retries ("99% goes through"). The risk is stale permissions. | "A lot of things don't really require this type of hard atomicity." |
| the-age-of-aggregation | Marc Boiron (Polygon) | AggLayer pessimistic proofs plus fast interop. Intents are capital-heavy, and shared sequencers and bridges are "not actually very secure". | "most of the time these are not actually very safe for interoperability." |
| bringing-ethereum-to-1b-telegram-users | Julien Niset (Argent) | Telegram's moat is distribution: 950M MAU, virality, everyone already logged in. Solana TG bots do about $60M/day, which proves the market. Mini App wallet: biometrics, paymaster, claim-link send to any contact, month-long session keys. Off-ramp is out of scope. | "it's a social network it has social virality features baked in." |
| the-end-of-self-custodial-wallets | Mikko Ohtamaa | Regulators can't ban crypto, so they restrict its use: unhosted-wallet transfer limits (EU), regulating wallet developers, and regulating front ends (Denmark requires VASP registration for front ends). | "what governments and regulators work is that they will restrict its use." |
| scaling-crypto-...-minipay | Charles Hamel (Opera) | 4M+ wallets and 1M+ P2P transfers a month in Africa. Phone-number addressing, auto backup, local ramps, sandboxed mini-apps with human-readable signing. Deliberately narrow. | "Minipay doesn't try to be a Swiss army knife that sees all your assets and all the chains and all the swaps." |
| cypherpunk-is-slow-not-hyper-financialized-and-unlike-twitter | Sebastian Buergel (HOPR) | Fast blocks serve traders. Only two builders remain. MEV is "user screwing infrastructure". | "there's exactly two remaining… Titan and Beaver. Congrats on democratization going well." |
| can-we-fix-mev | Jonah Burian | MEV comes from the proposer's monopoly. The two answers are to sell the monopoly (ePBS, auctions) or break it (FOCIL, BRAID). Encrypted mempools can be circumvented. | "MEV originates from a monopoly on the right to propose a block." |
| building-a-social-app-with-spend-permissions | Lukas Rosario, Conner Swenberg (Base) | Base rejected arbitrary-call session keys in favour of spend-only permissions: amount, period and start/end times as an EIP-712 signature, with batch revoke. Named use cases include automated trading and copy trading. | "we just don't believe that users are informed enough to give approval to those kinds of permissions." |
| the-dacc-vision-balancing-progress-and-protection | Vitalik Buterin | d/acc: defensive tech (formal verification, ZK, FHE, secure hardware). Not specific to trading. | — |

## Implications (feed into the strategy)
1. **Don't make ERC-7683 the interface.** The filler market is thin (15–20 fillers) and the standard gives users no execution guarantee. We consume LI.FI quotes; if we ever originate 7683 orders, show the user the guarantee ourselves.
2. **Route risk as a first-class quote field**, plus a per-agent bridge allowlist in the policy gate and rejection reasons written to the audit chain (Urban, Boiron).
3. **Soft-atomic multi-leg routes, stated plainly:** a hop state machine with retry/refund transitions, every hop audited, and approvals that expire (Javor).
4. **Telegram:** claim-link sends to any contact as a referral hook. Our deposit/withdraw flow covers the off-ramp gap Niset admitted to.
5. **Regulatory pressure lands on hosted front ends and wallet developers.** Keep the non-custodial path strong and compliance screening on the roadmap (Ohtamaa; garbled transcript, so verify).
6. **Agent permission defaults should follow Base:** spend-only, capped, periodic, expiring, one-click revoke; arbitrary calls off by default.
7. **Focus beats breadth for the mass market** (MiniPay).
8. **MEV isn't solved at the protocol level,** so the app has to own sandwich protection and show realised slippage (Buergel, Burian).
