import { defineRailway, github, group, postgres, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const suwappubot = github("0xSoftBoi/suwappubot", { branch: "claude/feature-parity-plan-x106cz", checkSuites: false });
  const suwappubot2 = github("0xSoftBoi/suwappubot", { branch: "dev", checkSuites: false });
  const suwappubot3 = github("0xSoftBoi/suwappubot", { branch: "feat/pump-onchain-ingest", checkSuites: false });

  const Redis = redis("Redis", { region: "us-west2" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis", tcpProxies: { "6379": {} } };
  const Postgres = postgres("Postgres", { region: "us-west2" });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 50000 });
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 50000 });
  const suwappuHolderCensus = service("suwappu-holder-census", {
    source: github("0xSoftBoi/suwappubot", { branch: "ops/suwappu-holder-census", checkSuites: false, rootDirectory: "scripts" }),
    build: { buildCommand: "echo holder-census", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "python serve_compact_snapshot.py",
    preDeploy: "python bankr_launch_lookup.py",
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
  });
  const suwappuBridge = service("suwappu-bridge", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "us-west2": 1 },
  });
  const webappMarketdata = service("webapp-marketdata", {
    source: suwappubot,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "webapp/Dockerfile", watchPatterns: ["/.manual-deploy-only/webapp-marketdata/**"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const apiTs = service("api-ts", {
    source: github("0xSoftBoi/suwappubot", { branch: "dev", checkSuites: false, rootDirectory: "/api-ts" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["/api-ts/**"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const marketDataCapture = service("market-data-capture", {
    source: github("0xSoftBoi/suwappubot", { branch: "reconcile/main-into-dev-20260820", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "api/Dockerfile.railway", watchPatterns: ["/.manual-deploy-only/market-data-capture/**"] },
    start: "sh -c 'exit 0'",
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "0 0 1 1 *", restartPolicyType: "NEVER", sleepApplication: true },
  });
  const terminal = service("terminal", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "us-west2": 1 },
  });
  const suwappuPrimitivesUi = service("suwappu-primitives-ui", {
    source: suwappubot2,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "/showcase/Dockerfile", watchPatterns: ["/.manual-deploy-only/suwappu-primitives-ui/**"] },
    healthcheck: "/primitives",
    healthcheckTimeout: 100,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const showcase = service("showcase", {
    source: github("0xSoftBoi/suwappubot", { branch: "dev", checkSuites: false, rootDirectory: "/" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "showcase/Dockerfile", watchPatterns: ["/showcase/**", "/packages/design-tokens/**", "/railway.showcase.json"] },
    healthcheck: "/",
    healthcheckTimeout: 100,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const pumpOnchainIngest = service("pump-onchain-ingest", {
    source: suwappubot3,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "ingest/Dockerfile", watchPatterns: ["/.manual-deploy-only/pump-onchain-ingest/**"] },
    start: "sh -c 'exit 0'",
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "0 0 1 1 *", restartPolicyType: "NEVER", sleepApplication: true },
  });
  const signalLab = service("signal-lab", {
    source: suwappubot3,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "ingest/Dockerfile.signal-lab", watchPatterns: ["/.manual-deploy-only/signal-lab/**"] },
    start: "sh -c 'exit 0'",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "0 0 1 1 *", restartPolicyType: "NEVER", sleepApplication: true },
  });
  const apiTsMarketdata = service("api-ts-marketdata", {
    source: github("0xSoftBoi/suwappubot", { branch: "claude/feature-parity-plan-x106cz", checkSuites: false, rootDirectory: "/api-ts" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["/.manual-deploy-only/api-ts-marketdata/**"] },
    healthcheck: "/health",
    healthcheckTimeout: 300,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const terminalMarketdata = service("terminal-marketdata", {
    source: suwappubot,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "terminal/Dockerfile", watchPatterns: ["/.manual-deploy-only/terminal-marketdata/**"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const pythonApi = service("python-api", {
    source: suwappubot2,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "api/Dockerfile.railway", watchPatterns: ["/api/**", "/bot/**", "/database/**", "/requirements*.txt", "/pyproject.toml", "/uv.lock", "/railway.python-api.json"] },
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "NEVER", sleepApplication: true },
  });
  const Redis2 = group("Redis", [Redis]);
  const PostgreSQL = group("PostgreSQL", [Postgres]);

  return project("suwappu", {
    variables: { managed: false },
    resources: [suwappuHolderCensus, suwappuBridge, webappMarketdata, apiTs, marketDataCapture, terminal, suwappuPrimitivesUi, showcase, pumpOnchainIngest, signalLab, apiTsMarketdata, terminalMarketdata, pythonApi, postgresVolume, redisVolume, Redis2, PostgreSQL],
  });
});
