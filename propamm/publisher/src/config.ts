import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";

export const TESTNET_CHAIN_IDS = [31337, 560048, 11155111] as const;

const addr = z.string().refine((s) => isAddress(s, { strict: false }), "invalid address").transform((s) => s as Address);
const int = (def?: number) => z.coerce.number().int().default(def as number);
const bool = z.enum(["true", "false", "1", "0"]).transform((s) => s === "true" || s === "1");

const Schema = z
  .object({
    RPC_HTTP_URL: z.string().url(),
    RPC_WS_URL: z.string().url().refine((u) => /^wss?:/.test(u), "must be ws(s)"),
    CHAIN_ID: z.coerce.number().int().positive(),
    ORACLE_ADDRESS: addr,
    FEED_ID: z.coerce.bigint().nonnegative(),
    TRANSPORT: z.enum(["titan-ws", "rpc"]),

    SIGNER: z.enum(["local", "kms"]),
    LOCAL_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    ALLOW_LOCAL_KEY_ON_MAINNET: z.string().optional(),
    KMS_KEY_ID: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
    EXPECTED_PUSHER_ADDRESS: addr.optional(),

    // titan
    TITAN_REGION: z.enum(["eu", "us", "ap"]).optional(),
    TITAN_API_KEY: z.string().min(1).optional(),
    TITAN_WS_URL: z.string().url().optional(), // override (mock / future endpoint); must be wss or loopback ws
    POOL_ADDRESS: addr.optional(),
    TOKEN0: addr.optional(),
    TOKEN1: addr.optional(),
    STATE_DIR: z.string().min(1).default("./.state"),
    TITAN_MAX_CONSEC_ERRORS: int(5),
    TITAN_ACK_TIMEOUT_MS: int(2000),

    // loop / quoting
    UPDATE_INTERVAL_MS: int(50),
    MIN_MOVE_BPS: z.coerce.number().nonnegative().default(0.5),
    HEARTBEAT_MS: int(300),
    REQUOTE_EVERY_BLOCK: bool.optional(),
    STEP_SAFETY_BPS: int(8000), // fraction of maxStepBps actually used, in bps of the cap (8000 = 80%)
    MAX_ANCHOR_DEV_BPS: z.coerce.number().positive(), // pool's maxAnchorDevBps
    ANCHOR_SAFETY_BPS: int(8000),
    RECOVERY_TICKS: int(20),

    // tx
    GAS_LIMIT_CAP: int(300_000),
    MAX_FEE_GWEI_CAP: z.coerce.number().positive().default(200),

    // prices
    PRICE_SOURCES: z.string().default("pyth,coinbase"),
    MIN_SOURCES: int(2),
    MAX_SOURCE_AGE_MS: int(3000),
    MAX_SOURCE_DISAGREE_BPS: z.coerce.number().positive().max(20).default(15), // hard cap 20 bps
    MAX_PYTH_CONF_BPS: z.coerce.number().positive().default(25),
    USDC_PYTH_PRICE_ID: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional(), // quote-asset (USDC/USD) feed
    MAX_QUOTE_DEPEG_BPS: z.coerce.number().positive().max(100).default(20), // hard cap 100 bps
    DEV_SIGN_DELAY_MS: int(0), // test hook, only honoured on chainId 31337
    OUTLIER_BPS: z.coerce.number().positive().default(50),
    PYTH_HERMES_URL: z.string().url().default("https://hermes.pyth.network"),
    PYTH_PRICE_ID: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional(),
    COINBASE_PRODUCT: z.string().default("ETH-USD"),
    COINBASE_WS_URL: z.string().url().default("wss://ws-feed.exchange.coinbase.com"),
    DEV_WALK_START: z.string().regex(/^\d+(\.\d+)?$/).default("3000"),
    DEV_WALK_STEP_BPS: int(30),

    // ops
    KILL_SWITCH_FILE: z.string().min(1),
    HTTP_PORT: int(9464),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((c, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const sources = c.PRICE_SOURCES.split(",").map((s) => s.trim()).filter(Boolean);
    for (const s of sources) if (!["pyth", "coinbase", "devwalk"].includes(s)) bad("PRICE_SOURCES", `unknown source ${s}`);
    if (new Set(sources).size !== sources.length) bad("PRICE_SOURCES", "duplicate source");
    if (sources.includes("devwalk") && c.CHAIN_ID !== 31337) bad("PRICE_SOURCES", "devwalk only allowed on chainId 31337");
    if (c.MIN_SOURCES < 2 && c.CHAIN_ID !== 31337) bad("MIN_SOURCES", "must be >= 2 outside local chain 31337");
    if (c.MIN_SOURCES < 1 || sources.length < c.MIN_SOURCES) bad("MIN_SOURCES", "fewer configured sources than MIN_SOURCES");
    if (sources.includes("pyth") && !c.PYTH_PRICE_ID) bad("PYTH_PRICE_ID", "required for pyth source");

    if (c.SIGNER === "local" && !c.LOCAL_PRIVATE_KEY) bad("LOCAL_PRIVATE_KEY", "required for SIGNER=local");
    if (c.SIGNER === "kms" && (!c.KMS_KEY_ID || !c.AWS_REGION)) bad("KMS_KEY_ID", "KMS_KEY_ID and AWS_REGION required for SIGNER=kms");
    if (c.SIGNER === "kms" && !c.EXPECTED_PUSHER_ADDRESS) bad("EXPECTED_PUSHER_ADDRESS", "mandatory for SIGNER=kms");
    if (c.TRANSPORT === "rpc" && !(TESTNET_CHAIN_IDS as readonly number[]).includes(c.CHAIN_ID)) bad("TRANSPORT", "rpc transport only allowed on testnet/local chain ids");
    if (c.DEV_SIGN_DELAY_MS > 0 && c.CHAIN_ID !== 31337) bad("DEV_SIGN_DELAY_MS", "only allowed on chainId 31337");
    if ((sources.includes("pyth") || sources.includes("coinbase")) && !c.USDC_PYTH_PRICE_ID) bad("USDC_PYTH_PRICE_ID", "required: quote-asset (USDC/USD) parity feed");
    if (c.CHAIN_ID !== 31337) {
      if (!/^https:/.test(c.RPC_HTTP_URL)) bad("RPC_HTTP_URL", "https required outside chain 31337");
      if (!/^wss:/.test(c.RPC_WS_URL)) bad("RPC_WS_URL", "wss required outside chain 31337");
      if (!/^https:/.test(c.PYTH_HERMES_URL)) bad("PYTH_HERMES_URL", "https required outside chain 31337");
      if (!/^wss:/.test(c.COINBASE_WS_URL)) bad("COINBASE_WS_URL", "wss required outside chain 31337");
      if (c.TITAN_WS_URL && !c.TITAN_WS_URL.startsWith("wss://")) bad("TITAN_WS_URL", "wss required outside chain 31337");
    }

    if (c.STEP_SAFETY_BPS < 1 || c.STEP_SAFETY_BPS > 9500) bad("STEP_SAFETY_BPS", "must be in [1, 9500]");
    if (c.ANCHOR_SAFETY_BPS < 1 || c.ANCHOR_SAFETY_BPS > 10000) bad("ANCHOR_SAFETY_BPS", "must be in [1, 10000]");
    if (c.UPDATE_INTERVAL_MS < 10) bad("UPDATE_INTERVAL_MS", "must be >= 10");

    if (c.TRANSPORT === "titan-ws") {
      if (!c.POOL_ADDRESS) bad("POOL_ADDRESS", "required for titan-ws (quote_address)");
      if (!c.TOKEN0 || !c.TOKEN1) bad("TOKEN0", "TOKEN0 and TOKEN1 required for titan-ws (asset_pairs)");
      if (!c.TITAN_WS_URL && !c.TITAN_REGION) bad("TITAN_REGION", "TITAN_REGION or TITAN_WS_URL required");
      const loopback = c.TITAN_WS_URL ? /^ws:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(c.TITAN_WS_URL) : false;
      if (c.TITAN_WS_URL && !loopback && !c.TITAN_WS_URL.startsWith("wss://")) bad("TITAN_WS_URL", "must be wss:// unless loopback");
      if (!loopback && !c.TITAN_API_KEY) bad("TITAN_API_KEY", "required for non-loopback Titan endpoint");
    }
  });

export type Config = Omit<z.infer<typeof Schema>, "PRICE_SOURCES" | "REQUOTE_EVERY_BLOCK" | "LOCAL_PRIVATE_KEY"> & {
  PRICE_SOURCES: string[];
  REQUOTE_EVERY_BLOCK: boolean;
  LOCAL_PRIVATE_KEY?: Hex;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const empty = Object.keys(Schema.innerType().shape).filter((k) => env[k] === "");
  if (empty.length) throw new Error(`invalid config (fail closed): empty-string env values: ${empty.join(", ")}`);
  const r = Schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid config (fail closed): ${msg}`);
  }
  const d = r.data;
  return {
    ...d,
    PRICE_SOURCES: d.PRICE_SOURCES.split(",").map((s) => s.trim()).filter(Boolean),
    REQUOTE_EVERY_BLOCK: d.REQUOTE_EVERY_BLOCK ?? d.TRANSPORT === "titan-ws",
    LOCAL_PRIVATE_KEY: d.LOCAL_PRIVATE_KEY as Hex | undefined,
  };
}
