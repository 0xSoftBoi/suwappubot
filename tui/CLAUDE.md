# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **TUI (Terminal User Interface) dashboard** with two modes:
1. **AWS Mode** (default) - Monitor AWS ECS Fargate deployments
2. **Debug Mode** - Debug local API development with endpoint testing, request monitoring, and database viewing

Built with Bun + Ink (React for terminals).

## Commands

```bash
# Install dependencies
bun install

# AWS Monitoring Mode
bun run start           # Production
bun run dev             # Development with hot reload

# Debug Mode (local API development)
bun run debug           # Production
bun run debug:dev       # Development with hot reload
```

## Architecture

### Core Stack
- **Runtime**: Bun (not Node.js)
- **UI**: Ink 5.x (React terminal renderer)
- **Language**: TypeScript with strict mode

### Key Directories
- `components/` - React UI components
  - AWS: ServicePanel, LogPanel, StatusBar, ConfirmDialog, CompactPane, EnvironmentPane
  - Debug: ApiTester, RequestMonitor, DatabaseViewer, LocalLogPanel
- `hooks/` - React hooks for AWS polling (useEcsStatus, useLogs, useDeployments)
- `services/` - Backend integrations
  - `aws.ts` - AWS CLI command wrappers (uses `Bun.spawn()`, not AWS SDK)
  - `api.ts` - Local API endpoint testing and request logging
  - `local.ts` - Local server management and log streaming
  - `database.ts` - Database queries (via API or direct SQLite)
- `deployments/` - JSON configs for each environment (production.json, development.json)
- `types/deployment.ts` - TypeScript interfaces for all data structures

### Data Flow (AWS Mode)
1. `useDeployments` loads JSON configs from `deployments/`
2. `useEcsStatus` polls AWS ECS/RDS every 15 seconds via CLI
3. `useLogs` streams CloudWatch logs in real-time
4. User keyboard input triggers actions (deploy, restart, switch panes)

### Debug Mode Panels
1. **API Tester** - Test predefined endpoints (/health, /tools, /wallets, etc.) with response preview
2. **Request Monitor** - View all HTTP requests made, with status codes and response times
3. **Database Viewer** - Browse swaps, wallets, and stats (via API or direct SQLite)
4. **Logs Panel** - Stream local uvicorn/FastAPI logs with filtering

## AWS Integration

Uses AWS CLI (not SDK) with profile support. Commands run via `Bun.spawn()`.

**Required permissions**: ECS (DescribeServices, ListTasks, UpdateService), RDS (DescribeDBInstances), CloudWatch Logs (GetLogEvents, DescribeLogStreams), ELBv2 (DescribeTargetHealth)

**Profile config**: Set `awsProfile` in deployment JSON files (e.g., "Swappu")

## Deployment Config Schema

Each file in `deployments/*.json`:
```typescript
{
  name: string;
  environment: 'production' | 'staging' | 'development';
  awsProfile?: string;
  fargate: { clusterName, serviceName, logGroup, logStreamPrefix };
  rds?: { instanceId, endpoint };
  endpoints: { api, health };  // Empty string = no ALB, derive health from ECS
}
```

## Keyboard Shortcuts

### AWS Mode

| Key | Action |
|-----|--------|
| Q | Quit |
| D/R | Deploy/Restart (force new ECS deployment) |
| L | Toggle expanded logs |
| P | Pause/resume log streaming |
| C | Clear logs |
| 1-4 | Switch deployment pane |
| Enter | Refresh status |

### Debug Mode

| Key | Action |
|-----|--------|
| Q | Quit |
| Tab | Switch panel (API → Requests → Database → Logs) |
| X | Start/Stop local API server |
| J/K or ↑/↓ | Navigate lists |
| Enter | Test endpoint / View details |
| A | Test all endpoints (API panel) |
| C | Clear logs/requests |
| P | Pause/resume logs |
| F | Cycle log filter (all/error/warn/info) |
| 1/2/3 | Switch database view (Swaps/Wallets/Stats) |

## Patterns & Conventions

- **No state management library** - Uses React hooks (useState, useEffect, useCallback, useRef)
- **Polling with refs** - `useRef` for interval cleanup, 15-second default refresh
- **Health fallback** - If no `endpoints.health`, derives health from ECS task RUNNING status
- **Color coding** - Green=healthy/running, Yellow=pending/warning, Red=error/unreachable
- **Error handling** - Try-catch with fallback values (null, empty arrays), no throws to UI

## Parent Project Context

This TUI is part of the larger Suwappubot project:
- `../bot/` - Python Telegram bot
- `../api/` - FastAPI endpoints
- `../dashboard/` - Next.js web dashboard
- `../Dockerfile` - Container builds the Python bot

The TUI operates independently and monitors the deployed Python bot infrastructure.
