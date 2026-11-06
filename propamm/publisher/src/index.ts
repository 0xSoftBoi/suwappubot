import { loadConfig } from "./config";
import { Chain } from "./chain";
import { startHttp } from "./http";
import { log, originOf, registerSecret, setLogLevel } from "./log";
import { Publisher } from "./loop";
import { Aggregator } from "./prices/aggregator";
import { CoinbaseSource, DevWalkSource, PythSource } from "./prices/sources";
import type { PriceSource } from "./prices/types";
import { KmsSigner } from "./signer/kms";
import { LocalDevSigner } from "./signer/local";
import type { Signer } from "./signer/types";
import { RpcTransport } from "./transport/rpc";
import { TitanTransport } from "./transport/titan";
import type { Transport } from "./transport/types";
import { assetPair } from "./titan/codec";

async function main() {
  const cfg = loadConfig();
  setLogLevel(cfg.LOG_LEVEL);
  registerSecret(cfg.TITAN_API_KEY);
  registerSecret(cfg.LOCAL_PRIVATE_KEY);
  registerSecret(cfg.LOCAL_PRIVATE_KEY?.slice(2));

  let signer: Signer;
  if (cfg.SIGNER === "local") {
    signer = new LocalDevSigner(cfg.LOCAL_PRIVATE_KEY!, cfg.CHAIN_ID, cfg.ALLOW_LOCAL_KEY_ON_MAINNET);
  } else {
    signer = await KmsSigner.create(cfg.KMS_KEY_ID!, cfg.AWS_REGION!, cfg.EXPECTED_PUSHER_ADDRESS);
  }
  if (cfg.EXPECTED_PUSHER_ADDRESS && cfg.EXPECTED_PUSHER_ADDRESS.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("signer address != EXPECTED_PUSHER_ADDRESS");
  }
  log("info", "starting", { signer: signer.kind, pusher: signer.address, chainId: cfg.CHAIN_ID, transport: cfg.TRANSPORT, oracle: cfg.ORACLE_ADDRESS });

  const sources: PriceSource[] = cfg.PRICE_SOURCES.map((n) => {
    if (n === "pyth") return new PythSource(cfg.PYTH_HERMES_URL, cfg.PYTH_PRICE_ID!, cfg.MAX_PYTH_CONF_BPS);
    if (n === "coinbase") return new CoinbaseSource(cfg.COINBASE_WS_URL, cfg.COINBASE_PRODUCT);
    return new DevWalkSource(cfg.CHAIN_ID, cfg.DEV_WALK_START, cfg.DEV_WALK_STEP_BPS);
  });
  const agg = new Aggregator(sources, {
    minSources: cfg.MIN_SOURCES,
    maxAgeMs: cfg.MAX_SOURCE_AGE_MS,
    outlierBps: cfg.OUTLIER_BPS,
    maxDisagreeBps: cfg.MAX_SOURCE_DISAGREE_BPS,
    maxDepegBps: cfg.MAX_QUOTE_DEPEG_BPS,
  }, cfg.USDC_PYTH_PRICE_ID ? new PythSource(cfg.PYTH_HERMES_URL, cfg.USDC_PYTH_PRICE_ID, cfg.MAX_PYTH_CONF_BPS, "usdc-usd") : null);

  const chain = new Chain(cfg, signer.address);
  await chain.init();

  let transport: Transport;
  let titan: TitanTransport | null = null;
  if (cfg.TRANSPORT === "titan-ws") {
    const url = cfg.TITAN_WS_URL ?? `wss://${cfg.TITAN_REGION}.rpc.titanbuilder.xyz/ws/sendquoteupdate`;
    titan = new TitanTransport({
      url,
      apiKey: cfg.TITAN_API_KEY,
      assetPairs: [assetPair(cfg.TOKEN0!, cfg.TOKEN1!)],
      quoteAddress: cfg.POOL_ADDRESS!,
      pools: [cfg.POOL_ADDRESS!],
      stateDir: cfg.STATE_DIR,
      ackTimeoutMs: cfg.TITAN_ACK_TIMEOUT_MS,
      maxConsecErrors: cfg.TITAN_MAX_CONSEC_ERRORS,
    });
    titan.start();
    transport = titan;
  } else {
    transport = new RpcTransport(chain.http, cfg.CHAIN_ID);
  }

  const pub = new Publisher(cfg, chain, agg, signer, transport);

  const http = startHttp(
    cfg.HTTP_PORT,
    () => ({
      ok: !pub.halted && !!chain.head && transport.connected() && pub.pricesHealthy,
      detail: {
        halted: pub.halted,
        halt_reason: pub.haltReason,
        head: chain.head?.number.toString() ?? null,
        prices_healthy: pub.pricesHealthy,
        transport_connected: transport.connected(),
        titan_uuid: titan?.currentUuid() ?? null,
        titan_seq: titan?.currentSeq() ?? null,
      },
    }),
    (reason) => pub.halt(reason),
  );

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("warn", "shutdown", { sig });
    pub.stop();
    await pub.halt(`shutdown ${sig}`, { persist: false }); // sets halted first; transport latches
    await pub.drain(); // in-flight tick finishes; it cannot send (halted + transport latch)
    await transport.close();
    agg.stop();
    chain.stop();
    http.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGUSR1", () => void pub.halt("SIGUSR1 kill switch"));

  agg.start();
  log("info", "running", { http: `127.0.0.1:${cfg.HTTP_PORT}` });
  await pub.run();
}

main().catch((e) => {
  log("error", "fatal", { err: e });
  process.exit(1);
});
