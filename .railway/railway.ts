import { defineRailway, github, group, postgres, project, redis, service, volume } from "railway/iac";

// NOTE: persistent services use Railway's default restart policy (ON_FAILURE). Railway
// normalises an explicit "ON_FAILURE" / sleepApplication:false back to null, so stating
// them here makes `railway config plan --detailed-exit-code` report permanent drift.
// Policy lives in railway.services.json (restartPolicyType: ON_FAILURE).
export default defineRailway(() => {
  const suwappubot = github("0xSoftBoi/suwappubot", { branch: "feat/pump-onchain-ingest", checkSuites: false });
  // Persistent services deploy from main only after CI passes (railway.services.json policy: waitForCi).
  const suwappubot2 = github("0xSoftBoi/suwappubot", { branch: "main", checkSuites: true });

  const Redis = redis("Redis", { region: "us-east4-eqdc4a" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis", tcpProxies: { "6379": {} } };
  const Postgres = postgres("Postgres", { region: "us-east4-eqdc4a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 50000 });
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 50000 });
  const suwappuHolderCensus = service("suwappu-holder-census", {
    source: github("0xSoftBoi/suwappubot", { rootDirectory: "scripts", checkSuites: false }),
    build: { buildCommand: "echo holder-census", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/.manual-deploy-only/suwappu-holder-census/**"] },
    start: "python serve_compact_snapshot.py",
    preDeploy: "python bankr_launch_lookup.py",
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
  });
  const suwappuBridge = service("suwappu-bridge", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "us-east4-eqdc4a": {  }, "us-west2": 1 },
  });
  const webappMarketdata = service("webapp-marketdata", {
    source: github("0xSoftBoi/suwappubot"),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "webapp/Dockerfile", watchPatterns: ["/.manual-deploy-only/webapp-marketdata/**"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const apiTs = service("api-ts", {
    source: github("0xSoftBoi/suwappubot", { branch: "main", checkSuites: true, rootDirectory: "/api-ts" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["/api-ts/**"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
  });
  const pumpOnchainIngestProd = service("pump-onchain-ingest-prod", {
    source: suwappubot,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "ingest/Dockerfile", watchPatterns: ["/.manual-deploy-only/pump-onchain-ingest-prod/**"] },
    start: "sh -c 'python /app/pump_ingest_live.py & python /app/pump_research_pipeline_signers.py'",
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
  });
  const ghostcatcherCompactExport = service("ghostcatcher-compact-export", {
    source: github("0xSoftBoi/suwappubot", { branch: "feat/ghostcatcher-compact-export", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/.manual-deploy-only/ghostcatcher-compact-export/**"] },
    replicas: { "us-west2": 1 },
  });
  const testnetRunner = service("testnet-runner", {
    source: github("0xSoftBoi/suwappubot", { branch: "claude/nft-collections-market-redesign-gm1kpr", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "deploy/Dockerfile.testnet-runner", watchPatterns: ["/.manual-deploy-only/testnet-runner/**"] },
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER" },
  });
  const ghostcatcherChainExportV2 = service("ghostcatcher-chain-export-v2", {
    source: github("0xSoftBoi/suwappubot", { branch: "feat/ghostcatcher-chain-export", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "ingest/Dockerfile.ghostcatcher-export", watchPatterns: ["/.manual-deploy-only/ghostcatcher-chain-export-v2/**"] },
    start: "python /app/ghostcatcher_snapshot_server.py",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const signalLabProd = service("signal-lab-prod", {
    source: suwappubot,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "ingest/Dockerfile.signal-lab", watchPatterns: ["/.manual-deploy-only/signal-lab-prod/**"] },
    start: "python /app/signal_lab.py",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
  });
  const terminal = service("terminal", {
    source: suwappubot2,
    build: { buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/terminal/**", "/packages/design-tokens/**", "/railway.terminal.json"] },
    healthcheck: "/health",
    healthcheckTimeout: 60,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
  });
  const showcase = service("showcase", {
    source: github("0xSoftBoi/suwappubot", { branch: "main", checkSuites: true, rootDirectory: "/" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "showcase/Dockerfile", watchPatterns: ["/showcase/**", "/packages/design-tokens/**", "/railway.showcase.json"] },
    healthcheck: "/robots.txt",
    healthcheckTimeout: 100,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
  });
  const suwappuRelayer = service("suwappu-relayer", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "us-east4-eqdc4a": 1 },
  });
  const ghostcatcherChainExport = service("ghostcatcher-chain-export", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "ingest/Dockerfile.ghostcatcher-export", watchPatterns: ["/.manual-deploy-only/ghostcatcher-chain-export/**"] },
    start: "python /app/ghostcatcher_compact_export.py",
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER" },
  });
  const pythonApi = service("python-api", {
    source: suwappubot2,
    build: { buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/api/**", "/bot/**", "/database/**", "/requirements*.txt", "/pyproject.toml", "/uv.lock", "/railway.python-api.json"] },
    healthcheck: "/health",
    healthcheckTimeout: 300,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
  });
  // Same image as python-api, Telegram bot OFF (RUN_TELEGRAM_BOT=false), background loops ON.
  // Created 2026-11-06 via `railway add` with variable REFERENCES to python-api (variables are unmanaged here).
  const pythonWorker = service("python-worker", {
    source: suwappubot2,
    build: { buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/api/**", "/bot/**", "/database/**", "/requirements*.txt", "/pyproject.toml", "/uv.lock", "/railway.python-worker.json"] },
    healthcheck: "/health",
    healthcheckTimeout: 300,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { restartPolicyMaxRetries: 10 },
  });
  const Redis2 = group("Redis", [Redis]);
  const PostgreSQL = group("PostgreSQL", [Postgres]);

  return project("suwappu", {
    variables: { managed: false },
    resources: [suwappuHolderCensus, suwappuBridge, webappMarketdata, apiTs, pumpOnchainIngestProd, ghostcatcherCompactExport, testnetRunner, ghostcatcherChainExportV2, signalLabProd, terminal, showcase, suwappuRelayer, ghostcatcherChainExport, pythonApi, pythonWorker, postgresVolume, redisVolume, Redis2, PostgreSQL],
  });
});
