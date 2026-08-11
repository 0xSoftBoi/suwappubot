import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  http,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  getAddress,
  maxUint256,
  parseEther,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { amortizingVaultAbi, timeCurveAbi } from "../src/abis.js";
import { baseSepoliaDeployment as D } from "../src/addresses.js";
import { computeLineKey, createSuwappuClient } from "../src/client.js";

// Uses the node:test API so the same file runs under `bun test` (normal CI, with
// direct network) and under `node --import tsx --test` (used here, where the agent
// proxy re-terminates TLS and only Node's env-proxy fetch can reach the RPC).
const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const TIMEOUT = 60_000;

// `as` casts sidestep viem's known deep-generic identity bailout when a concrete
// client is passed to a function typed against the library's PublicClient/WalletClient.
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) }) as PublicClient<
  Transport,
  Chain | undefined
>;
const client = createSuwappuClient({ publicClient, addresses: D });

// Addresses involved in the deployed demo state (see contracts/DEPLOYMENTS.md).
const A0 = "0x474Bbd1E36654210Ca06539c69C1d22a19A51B6d" as const; // deployer
const A1 = "0x87fCd0d29644756F766872B71DD84c724de9FBe7" as const; // credit counterparty
const WAD = 10n ** 18n;

describe("SuwappuTimeCurve (live Base Sepolia)", () => {
  test("reads immutable params exactly", { timeout: TIMEOUT }, async () => {
    assert.equal(await client.curve.name(), "Suwappu Curve");
    assert.equal(await client.curve.symbol(), "sCRV");
    assert.equal(await client.curve.decimals(), 18);
    assert.equal(await client.curve.basePrice(), WAD / 100n); // 0.01
    assert.equal(await client.curve.slope(), WAD / 1000n); // 0.001
    assert.equal(await client.curve.sinkRate(), WAD / 100n); // 1%
    assert.equal(await client.curve.rate(), -1585489599n); // ~-5%/yr
    assert.equal(getAddress(await client.curve.reserve()), getAddress(D.reserveAsset));
  });

  test("quotes and price are live and sane", { timeout: TIMEOUT }, async () => {
    const mult = await client.curve.multiplier();
    assert.ok(mult > 0n, "multiplier > 0");
    assert.ok(mult <= WAD, "decay ⇒ multiplier ≤ 1");
    assert.ok((await client.curve.spotPrice()) > 0n);
    assert.ok((await client.curve.quoteBuy(WAD)) > 0n);
    const [q1, q10] = [await client.curve.quoteBuy(WAD), await client.curve.quoteBuy(10n * WAD)];
    assert.ok(q10 > q1, "buying more costs strictly more (monotonic curve)");
    assert.ok((await client.curve.reserveBalance()) > 0n);
  });
});

describe("SuwappuAmortizingVault (live Base Sepolia)", () => {
  test("reads immutable params exactly", { timeout: TIMEOUT }, async () => {
    assert.equal(getAddress(await client.vault.asset()), getAddress(D.reserveAsset));
    assert.equal(getAddress(await client.vault.collateralVault()), getAddress(D.collateralVault));
    assert.equal(await client.vault.maxLtv(), WAD / 2n); // 50%
    assert.equal(await client.vault.liqLtv(), (WAD * 9n) / 10n); // 90%
    assert.equal(await client.vault.liqBonus(), WAD / 20n); // 5%
    assert.equal(await client.vault.borrowRate(), 634195839n); // ~2%/yr
  });

  test("pool + position accounting is coherent", { timeout: TIMEOUT }, async () => {
    // Pin one block: linear interest makes debt grow every ~2s block, so reads
    // must be taken at a single block for the identity to hold exactly.
    const blockNumber = await publicClient.getBlockNumber();
    const at = (functionName: "poolAssets" | "cash" | "totalDebtAssets") =>
      publicClient.readContract({
        address: D.amortizingVault,
        abi: amortizingVaultAbi,
        functionName,
        blockNumber,
      }) as Promise<bigint>;
    const [pool, cash, debt] = await Promise.all([at("poolAssets"), at("cash"), at("totalDebtAssets")]);
    assert.equal(pool, cash + debt); // poolAssets == cash + outstanding debt
    assert.ok((await client.vault.nextPositionId()) >= 1n); // position 0 opened at deploy
    const pos0 = await client.vault.position(0n);
    assert.notEqual(pos0.owner, "0x0000000000000000000000000000000000000000");
    assert.ok((await client.vault.debtOf(0n)) > 0n);
  });
});

describe("SuwappuMutualCredit (live Base Sepolia)", () => {
  test("off-chain lineKey matches on-chain lineKey", { timeout: TIMEOUT }, async () => {
    const onchain = await client.credit.lineKey(A0, A1, D.reserveAsset);
    assert.equal(computeLineKey(A0, A1, D.reserveAsset), onchain);
    // order-independent (sorted pair)
    assert.equal(computeLineKey(A1, A0, D.reserveAsset), onchain);
  });

  test("owedBy reads the live ledger", { timeout: TIMEOUT }, async () => {
    const owed = await client.credit.owedBy(A0, A1, D.reserveAsset);
    assert.ok(owed >= 0n); // demo state seeded a 300-unit debt; may be settled later
    assert.ok((await client.credit.defaults(A0)) >= 0n);
  });
});

// Opt-in write path: set TEST_PRIVATE_KEY (a funded Base Sepolia key) to exercise a
// real buy() through the client. Skipped by default so CI needs no secret/gas.
const pk = process.env.TEST_PRIVATE_KEY as `0x${string}` | undefined;
describe("write path (needs funded TEST_PRIVATE_KEY)", { skip: !pk }, () => {
  test("approve + buy mints curve tokens", { timeout: 120_000 }, async () => {
    const account = privateKeyToAccount(pk as `0x${string}`);
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) }) as WalletClient<
      Transport,
      Chain | undefined,
      Account
    >;
    const w = createSuwappuClient({ publicClient, walletClient, addresses: D });

    const cost = await w.curve.quoteBuy(parseEther("1"));
    const allowance = await w.token.allowance(D.reserveAsset, account.address, D.timeCurve);
    if (allowance < cost) {
      const h = await w.token.approve(D.reserveAsset, D.timeCurve, maxUint256);
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
    const hash = await w.curve.buy(parseEther("1"), cost * 2n);
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(rcpt.status, "success");
    // Assert on the tx's own receipt logs — authoritative and independent of the
    // public RPC's eventual-consistency (a follow-up balanceOf can hit a lagging
    // replica). The CurveBuy event proves exactly 1e18 was minted to the buyer.
    const events = parseEventLogs({ abi: timeCurveAbi, eventName: "CurveBuy", logs: rcpt.logs });
    assert.equal(events.length, 1);
    assert.equal(events[0].args.tokensOut, parseEther("1"));
    assert.equal(getAddress(events[0].args.buyer), account.address);
  });
});
