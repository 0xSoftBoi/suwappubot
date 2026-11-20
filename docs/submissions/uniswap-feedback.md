# Uniswap v4 hooks feedback (ETHGlobal Tokyo 2026)

- `HookMiner` (in `v4-periphery/test/shared/`) is genuinely useful but lives in `test/`,
  not a published package export — we had to import it directly from the lib path
  rather than a versioned package, which is a bit fragile for anyone building outside
  Foundry's test context.
- The `beforeSwap`/`afterSwap` `sender` parameter being the router's address (not the
  end-user's EOA) is the correct design for composability, but it means any compliance
  or identity-gated hook *must* thread the real actor through `hookData` — worth a
  clearer callout in the hook-development docs, since it's an easy first mistake (we
  hit it ourselves and had to redeploy after catching it in a dry-run simulation).
- No official Sepolia PoolManager address could be found via a quick doc search;
  `docs.uniswap.org/contracts/v4/deployments` is the source of truth but wasn't the
  first result surfaced by general web search — worth ensuring that page ranks well
  for "uniswap v4 sepolia poolmanager address".
