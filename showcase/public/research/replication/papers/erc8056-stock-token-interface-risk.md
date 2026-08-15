# When `balanceOf()` Stops Meaning What the User Thinks

## ERC-8056 integration risk in Robinhood Stock Tokens

**Suwappu Research — 7 August 2026 — v1.0**
**Evidence state: RESEARCH**

## Abstract

Robinhood Stock Tokens expose a compatibility edge that ordinary ERC-20 integration
tests do not cover. A corporate action can change the number of underlying shares
represented by one token while the token's raw ERC-20 balance and total supply remain
unchanged. The Draft ERC-8056 extension supplies the missing semantic layer through an
18-decimal `uiMultiplier()`. Robinhood's REST equity-price surface is *not* multiplier
adjusted, while its Chainlink token feed *is* already multiplier adjusted.

That creates three distinct, internally consistent quantities: raw token amount,
share-equivalent amount, and per-token economic value. Treating any two as interchangeable
can yield a wrong display or valuation without a failed RPC call, reverted transaction, or
incorrect ERC-20 implementation.

We pair the documented mechanism with a purposive public-code search of nine open-source
wallet, portfolio, explorer, DEX-interface, and EVM-library repositories. On 7 August 2026,
GitHub code search returned no matches across that sample for eight canonical ERC-8056
names or interface identifiers. A positive-control search for `balanceOf` returned indexed
code. Suwappu's own pre-study `main` snapshot also returned no canonical ERC-8056 markers.
These are **integration signals, not runtime-support findings**: private backends, generated
ABIs, dynamic calls, third-party metadata, unindexed branches, and differently named
adapters are outside the search. We do not claim that any named product currently displays
Robinhood Stock Tokens incorrectly.

## 1. The compatibility break is semantic, not transactional

Robinhood describes its Stock Tokens as tokenised debt securities issued by Robinhood
Assets (Jersey) Limited. They provide economic exposure to underlying securities but do
not confer legal or beneficial rights in those underlying securities. The contracts use
the standard ERC-20 interface with 18 decimals.

The unusual part appears at the corporate-action boundary. Robinhood's documentation says
dividends and stock splits change an onchain shares-per-token multiplier while the raw
balance remains static until redemption. Its developer guide is explicit that `balanceOf()`
and `totalSupply()` stay fixed.

[Draft ERC-8056](https://eips.ethereum.org/EIPS/eip-8056) standardizes this split between
raw and UI amounts. The core interface exposes `uiMultiplier()` at 18-decimal precision;
the optional balance interface exposes `balanceOfUI()` and `totalSupplyUI()`. Standard
ERC-20 operations continue to use raw amounts. The draft's wallet integration guide tells
integrators to detect the interface via ERC-165, compute or query the UI balance, label raw
and UI amounts clearly, and continue transferring raw amounts.

For a normalized raw token amount \(b\) and multiplier \(m\):

\[
q_{shares} = b \times m
\]

where \(m=1\) initially and, for example, \(m=10\) after a 10-for-1 split. Onchain the
integer multiplier is scaled by \(10^{18}\); the equation above uses its normalized value.

The result is backwards compatible at the contract-call level while breaking an assumption
many interfaces quietly make: **the human-readable ERC-20 balance is not necessarily the
human-readable economic quantity the user wants to see.**

## 2. One split, three ways to be wrong

Chainlink publishes an official 10-for-1 Robinhood example. Before the split, the underlying
share price is $200, the multiplier is 1.0, and the token feed is $200. During the corporate
action the oracle is paused. After unpause, the underlying share price is $20, the multiplier
is 10.0, and the token feed remains $200 because the feed already reports:

\[
p_{token} = p_{share} \times m
\]

Hold one raw token through that illustrative split and the relevant surfaces become:

| Quantity | Before | After | Correct interpretation |
|---|---:|---:|---|
| ERC-20 raw token balance | 1.000 | 1.000 | Settlement/accounting amount stays raw |
| `uiMultiplier()` | 1.0x | 10.0x | Underlying shares represented by each raw token |
| Share-equivalent amount | 1.000 | 10.000 | User-facing underlying-share quantity |
| Raw underlying share price | $200 | $20 | Robinhood REST `/prices` semantics |
| Chainlink token feed | $200 | $200 | Already multiplier adjusted |

Three failure modes follow directly.

**Raw-balance display error.** An interface labels 1.000 raw token as one underlying share
after the split. The ERC-20 read is correct; the share-equivalent display is wrong by 10x.

**Raw-price valuation error.** A portfolio service multiplies Robinhood's raw $20 underlying
share price by the raw 1.000-token balance. It reports $20 instead of the $200 token value
unless it applies the 10x multiplier exactly once.

**Double-adjusted oracle error.** A service reads the $200 Chainlink token feed and then
applies the multiplier again. It reports $2,000 instead of $200. Robinhood and Chainlink both
warn that the onchain token feed is already multiplier adjusted.

No failure requires a revert. Every input can be fresh, correctly decoded, and individually
valid. The defect is a provenance error: the application has lost track of what each number
means.

## 3. Public-code audit

### Question

Do prominent public crypto codebases visibly carry canonical ERC-8056 integration markers
today?

### Sample

We selected nine public repositories to span likely integration layers rather than estimate
population prevalence:

| Repository | Layer |
|---|---|
| `MetaMask/metamask-extension` | Wallet |
| `RabbyHub/Rabby` | Wallet |
| `rainbow-me/rainbow` | Wallet |
| `trustwallet/wallet-core` | Wallet core |
| `rotki/rotki` | Portfolio/accounting |
| `blockscout/frontend` | Explorer frontend |
| `wevm/viem` | EVM library |
| `ethers-io/ethers.js` | EVM library |
| `Uniswap/interface` | DEX interface |

This is a purposive integration sample, not a randomized sample of wallets or DeFi software.

### Queries

Using the connected GitHub code-search surface on 7 August 2026, scoped to the repositories
above, we searched for eight canonical markers:

`uiMultiplier`, `balanceOfUI`, `UIMultiplierUpdated`, `ERC-8056`, `a60bf13d`, `d890fd71`,
`57854fc3`, and `4bd27648`.

The four hexadecimal strings are the interface identifiers published by Draft ERC-8056 for
the core, balance, conversion, and pending-multiplier interfaces. All eight searches returned
zero matches in the nine-repository scope. A `balanceOf` positive control using the same scope
returned five results at the requested top-five limit, including indexed code from
`trustwallet/wallet-core` at commit `7782ecfbfef710c06d1ad6b6de282598a163d522`.

The machine-readable search record is
[released with this paper](../data/erc8056-public-code-audit.json). The companion
[`verify_erc8056_audit.mjs`](../code/verify_erc8056_audit.mjs) script checks the released search
counts and the split arithmetic offline.

### What zero matches means — and does not mean

The narrow finding is: **we found no canonical ERC-8056 identifiers in this public-code
search at the observation time.**

It does not establish that the named products lack support. A runtime can implement the
semantics in a private service, use an external token-metadata provider, construct selectors
dynamically, generate interfaces outside the indexed tree, use different names, or support
the asset through code not captured by GitHub search. Nor does a library such as ethers or
viem need first-class ERC-8056 code for an application to call the interface successfully.

Accordingly, this paper does **not** rank products, estimate a market-wide support rate, or
claim that any named wallet currently shows an incorrect Robinhood balance.

## 4. Suwappu failed the same search

We ran the canonical-marker search against Suwappu's own pre-change `main` snapshot,
commit `8ca242149eb40c7f90b0c2ac02a4ca850e432e4c`, across the bot, TypeScript API, webapp,
terminal, packages, contracts, showcase source, and docs. It returned zero matches.

That is not a currently exposed Stock Token money-path bug. Suwappu's current source
explicitly fail-closes canonical Robinhood Stock Token trading until a dedicated jurisdiction
and eligibility flow exists; the generic Robinhood long-tail-token route remains separate.
The relevant implementation boundary is pinned in
[the discovery handler](https://github.com/0xSoftBoi/suwappubot/blob/8ca242149eb40c7f90b0c2ac02a4ca850e432e4c/bot/handlers/paste_trade.py#L196-L207)
and defended again in
[the swap callback](https://github.com/0xSoftBoi/suwappubot/blob/8ca242149eb40c7f90b0c2ac02a4ca850e432e4c/bot/handlers/swap.py#L2030-L2041).

This matters for engineering governance: **ERC-8056 handling belongs in the admission
criteria before that fail-closed boundary is removed.** Researching the semantic mismatch
now is cheaper than discovering it after a corporate action.

## 5. An integration contract that is testable

Supporting this asset class safely requires separating amount semantics at the type and test
level rather than sprinkling a multiplier into presentation code.

1. **Detect support explicitly.** Probe the Draft ERC-8056 core interface through ERC-165 and
   treat the standard's draft status as a versioning risk.
2. **Name quantities by meaning.** Keep raw token amount, share-equivalent amount, raw
   underlying price, and adjusted token price distinct in APIs and storage.
3. **Apply the multiplier exactly once.** Robinhood REST underlying price needs the multiplier
   when deriving token value; the Chainlink token feed already includes it.
4. **Model transition state.** Read pending multiplier/effective time where relevant and honor
   oracle pause and staleness controls during corporate actions.
5. **Test discontinuities, not only 1.0x.** Fixtures should include at least a forward split,
   reverse split, and small dividend-style multiplier change. A test suite that only sees a
   1.0 multiplier cannot distinguish an ERC-20-only integration from a correct scaled-UI one.
6. **Keep transfers raw.** ERC-20 transfer semantics remain raw even when the interface displays
   share-equivalent quantities.

The important invariant is simple: for one holding and one observation time, all supported
price/amount paths should reconcile to the same economic value after their documented
transformations. If the REST path, Chainlink path, and UI path disagree, the integration
should fail closed rather than guess which surface is already adjusted.

## 6. Why this is bigger than one token family

ERC-20 made a powerful promise: almost any token can flow through the same generic plumbing.
Tokenized real-world assets add state from outside that plumbing — corporate actions,
underlying-market sessions, issuer terms, and price provenance. Draft ERC-8056 preserves raw
ERC-20 composability by moving one part of that state into a standardized UI multiplier.

That is elegant, but it changes what “ERC-20 compatible” is sufficient to mean. Settlement
compatibility can survive while display compatibility does not. A generic wallet can be
perfectly correct about the contract's raw balance and still lack enough semantics to present
the user's share-equivalent position.

The contract did not break. **The abstraction got a new layer.**

## 7. Limitations and falsification conditions

- ERC-8056 is **Draft** as of the observation date. Its names, identifiers, or requirements can
  change before finalization.
- The GitHub audit is identifier-based public-code search. It is deliberately not treated as
  runtime conformance testing.
- The nine repositories are a purposive sample. No prevalence estimate is justified.
- We did not inspect private backends, mobile binaries, hosted token registries, or third-party
  portfolio providers used by the named products.
- We did not establish that a live non-1.0 multiplier has already caused a user-visible error.
  The split fixture is Chainlink's documented 10-for-1 example, not an incident report.
- Robinhood Stock Tokens have jurisdiction and eligibility restrictions. This paper analyzes
  integration semantics; it is not a guide to acquiring, trading, or bypassing restrictions on
  the products.

The public-code result should be updated if a canonical marker appears in the sample, if a
named product documents an alternative implementation, or if ERC-8056 changes materially.
Runtime tests against supported applications would provide stronger evidence than this search.

## Sources

1. Ethereum Improvement Proposals, [ERC-8056: Scaled UI Amount Extension for ERC-20 Tokens](https://eips.ethereum.org/EIPS/eip-8056), Draft, observed 7 August 2026.
2. Robinhood Chain, [Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/), observed 7 August 2026.
3. Robinhood Chain, [Building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/), observed 7 August 2026.
4. Robinhood Chain, [Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/), observed 7 August 2026.
5. Robinhood Chain, [Oracles & Price Feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds/), observed 7 August 2026.
6. Chainlink, [Robinhood Tokenized Equities](https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood), observed 7 August 2026.

## Disclosure

Suwappu has implemented Robinhood Chain support for generic long-tail ERC-20 routes and has a
commercial interest in cross-chain execution infrastructure. Canonical Robinhood Stock Token
trading is explicitly disabled in the cited source snapshot pending dedicated eligibility and
jurisdiction controls. This research does not constitute investment, legal, tax, accounting,
or financial advice, and no named third party reviewed it before publication.
