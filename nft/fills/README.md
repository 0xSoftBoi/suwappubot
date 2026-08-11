# Suwappu Fills — 10,000 order tickets on Robinhood Chain

Every ticket is a **filled order for one of the 96 tokenized equities that actually
trade as ERC-20s on Robinhood Chain** (chain id 4663). Hold one in a wallet linked to
Suwappu and every swap you make gets cheaper.

The collection is built out of things this repo already knows to be true on-chain,
rather than invented lore:

| On the ticket | Comes from |
|---|---|
| Ticker, company, ERC-20 address, decimals | `bot/config/tokens.py::ROBINHOOD_EQUITIES` — pulled from Robinhood's canonical asset registry and spot-verified with `eth_getCode`/`symbol()`/`decimals()` |
| `USDG` settlement (never USDC) | Chain 4663 has **no USDC**; the anchor is Paxos USDG — `docs/plans/robinhood-chain-native.md` |
| Routes `fly` / `across` / Li.Fi Diamond | The exact Li.Fi routes verified live in that same plan |
| Sessions incl. Overnight / Pre-Market | Tokenized equities keep trading while the underlying market is shut |
| Desk tier → fee discount | Stacks in `fee_service.get_fee_decimal`, the bot's single source of truth for the charged rate |

The generator **parses the registry at build time** (`generate.py::load_registry`), so
the collection cannot drift from what is tradable. A test asserts the bands and sector
map cover the registry exactly — add a ticker to the registry and the suite fails until
the collection is updated.

## Utility

| Desk | Supply | Swap fee | Ticker XP |
|------|-------:|---------:|----------:|
| Retail | 5,081 | −5 bps | +2.5% |
| Desk | 2,894 | −10 bps | +5% |
| Prime | 1,533 | −20 bps | +10% |
| Whale | 443 | −35 bps | +20% |
| House | 49 | −50 bps | +35% |

The fee discount stacks with subscription tier and points discounts and is **floored at
`MIN_EFFECTIVE_FEE_RATE` (0.1%)** — the fee can never reach zero, which would also zero
the referral fee-share. The XP boost applies when you swap the ticker your ticket names.

Trust model: token ids come from an indexer, but the *value* of the perk is always
resolved by `eth_call` against `bestDiscountBps`, which re-checks ownership on-chain and
ignores ids you do not own. A stale or hostile indexer can only ever produce a **smaller**
discount. `bot/services/fills_service.py` fails closed to "no perk" on any error, and the
sync fee path reads an in-memory cache only — pricing a swap never waits on an RPC.

## Contract

`contracts/SuwappuFills.sol` — ERC-721 (OZ 5.6, solc 0.8.27, compiles with zero warnings).

- **Fair assignment.** `startingIndex` is drawn from a future block hash and rotates token
  ids onto asset ids. Without it a provenance hash proves nothing, since asset N would
  always land on token N. The draw is permissionless once the committed block is mined, so
  the owner cannot stall a result they dislike. Arbitrum keeps 256 recent block hashes, so
  the fallback path is documented in the contract.
- **On-chain traits.** The `(ticker, desk)` pair for all 10,000 assets lives on-chain as a
  packed 20,000-byte blob, uploaded in 10 batches and sealed against an immutable
  `keccak256` commitment. The bot never has to trust an off-chain JSON file for a discount.
- **No equity semantics.** A ticket references an ERC-20; it conveys no equity, no
  shareholder rights and no claim on any issuer. The disclaimer is in every metadata file
  and printed on every image.

## Files

| File | Purpose |
|------|---------|
| `config.json` | Ticker bands, sector map, trait weights, desk table, seed (`4663`) |
| `generate.py` | Deterministic generator (stdlib only) |
| `pack_traits.py` | Packs the on-chain traits blob + `keccak256` commitment (stdlib keccak, cross-checked against js-sha3) |
| `collection.json` | All 10,000 metadata rows |
| `provenance.json` | Per-image sha256 + provenance hash |
| `traits_commitment.txt`, `traits_calldata.json` | Constructor arg + `appendTraits()` chunks |
| `samples/` | 6 committed example tickets |
| `abi/SuwappuFills.json` | Compiled ABI |

`output/` (10k SVGs + metadata, ~300MB) and `traits.bin` are gitignored — both regenerate
byte-for-byte from the seed.

**Provenance:** `91c0ec0e3e7bd108175c9443d32b0dd16f78b89d5af23c9e7a02f42d6008c124`
**Traits commitment:** `0xb3479dd822b01a4b5d365f06d06480902473ac10f40f09a4253a74f4d9e70887`

## Regenerate & ship

```bash
python3 nft/fills/generate.py       # 10k tickets -> output/  (~2 min)
python3 nft/fills/pack_traits.py    # traits blob + commitment
python3 -m pytest tests/test_fills_collection.py
```

1. Upload `output/images/` to IPFS; replace `__IMAGES_CID__` in `output/metadata/*`.
2. Upload `output/metadata/` — that CID is the base URI.
3. Deploy (testnet first — faucet: https://faucet.testnet.chain.robinhood.com):
   ```bash
   export DEPLOYER_PRIVATE_KEY=0x... FILLS_UNREVEALED_URI=ipfs://<placeholder>
   forge script contracts/deploy/DeployFills.s.sol \
     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast -vvvv
   ```
4. `appendTraits()` x10 → `sealTraits()` → `setBaseURI()` → mint → `commitReveal()` →
   `drawStartingIndex()` → `freezeMetadata()`.
5. Set `SUWAPPU_FILLS_CONTRACT` in the bot env to light up `/fills` and the fee discount.
   Leaving it unset disables the perk entirely.
