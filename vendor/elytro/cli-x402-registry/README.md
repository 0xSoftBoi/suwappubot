# cli-x402-registry

The official service registry for [Elytro CLI](https://github.com/Elytro-eth/cli)'s built-in [x402](https://x402.org) support.

This registry is the data source behind the `elytro services` command — run it to browse all available x402-enabled services directly from your terminal.

## Structure

Each service has its own JSON file in the project root (e.g. `agentmail.json`) containing full details: endpoints, pricing, tags, and documentation links.

`index.json` is a generated summary index consumed by the CLI. **Do not edit it manually.**

Only files with `"ENABLE": true` are included in the index.

## Adding a Service

1. Create a new `<service-id>.json` file in the root directory following the schema of an existing service file.
2. Set `"ENABLE": true` when the service is ready to be listed.
3. Regenerate the index:

```sh
npx --yes tsx ./dev/generateIndex.ts
```

4. Validate the output:

```sh
npx --yes tsx ./dev/verify.ts
```

## Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `ENABLE` | boolean | Yes | Set to `true` to include in the index |
| `id` | string | Yes | Unique identifier (kebab-case) |
| `name` | string | Yes | Display name |
| `description` | string | Yes | Short description |
| `categories` | string[] | Yes | Category tags |
| `serviceUrl` | string | Yes | Base URL of the x402 service |
| `tags` | string[] | Yes | Search tags |
| `docs` | string[] | Yes | Documentation URLs |
| `endpoints` | Endpoint[] | Yes | List of available endpoints |
