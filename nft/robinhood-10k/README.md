# Suwappu Feathers — 10k generative collection for Robinhood Chain

10,000 procedurally drawn feathers targeting **Robinhood Chain mainnet (chain id 4663**, Arbitrum
Orbit, native gas ETH; testnet **46630**). Explorer: https://robinhoodchain.blockscout.com

The full 262MB output (10,000 SVGs + 10,000 metadata files) is **not committed** — it regenerates
byte-for-byte from the committed seed. What IS committed:

| File | Purpose |
|------|---------|
| `traits.json` | Layer/rarity config + collection seed (`4663`) + 10 legendary 1/1 definitions |
| `generate.py` | Deterministic generator (stdlib only, no deps) |
| `collection.json` | All 10,000 metadata rows in one file |
| `provenance.json` | sha256 per image + BAYC-style provenance hash + legendary token ids |
| `samples/` | 8 committed example tokens (incl. legendary #106 "The First Feather") |
| `abi/SuwappuFeathers.json` | Compiled contract ABI (solc 0.8.27) |

**Provenance hash:** `1892dc53a3677f255d644842f80fd2b01535734dd6fd5a09264249af01254071`
(`sha256(concat(sha256(image_i) for i in 1..10000))`) — also hardcoded in the deploy script and
fixed immutably in the contract constructor, committing the token→art assignment before any mint.

## Traits

7 layers — Background (8), Palette (8), Shape (6), Barbs (6), Shaft (6), Charm (10, incl. tokenized-
equity tickers AAPL/TSLA/NVDA/SPY/…/HOOD and USDG), Aura (5) — plus 10 legendary 1/1s at
deterministically-drawn token ids `[106, 1152, 1269, 2318, 3014, 3528, 3918, 4206, 7325, 9682]`.
All 10,000 combinations are unique (enforced at roll time).

## Regenerate

```bash
python3 nft/robinhood-10k/generate.py            # full 10k → output/ (~1 min)
python3 nft/robinhood-10k/generate.py --limit 50 # debug run; writes *.partial50.json, never
                                                 # clobbers the committed full-collection records
```

## Ship it

1. Regenerate, then upload `output/images/` to IPFS → note the CID.
2. Rewrite `image` in `output/metadata/*` replacing `__COLLECTION_CID__` with that CID; upload
   `output/metadata/` → that dir's CID becomes the base URI (`ipfs://<CID>/`).
3. Deploy (testnet first — faucet: https://faucet.testnet.chain.robinhood.com):
   ```bash
   export DEPLOYER_PRIVATE_KEY=0x...
   export FEATHERS_BASE_URI=ipfs://<metadata-CID>/
   forge script contracts/deploy/DeployFeathers.s.sol \
     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast -vvvv
   ```
4. Verify `provenanceHash()` on the deployed contract matches `provenance.json`, open the mint
   (`setMintOpen(true)`, optional `setMintPrice`), and after the reveal is final,
   `freezeMetadata()`.

Contract: `contracts/SuwappuFeathers.sol` — ERC-721 (OZ 5.6), max supply 10,000, 20/wallet,
owner airdrop mint, price-exact payable mint, freezable base URI, immutable provenance.
