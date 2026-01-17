# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **TUI (Terminal User Interface) dashboard** for monitoring and managing AWS ECS Fargate deployments of the Suwappubot cross-chain swap bot. Built with Bun + Ink (React for terminals).

## Commands

```bash
# Development with hot reload
bun run dev

# Production run
bun run start

# Install dependencies
bun install
```

## Architecture

### Core Stack
- **Runtime**: Bun (not Node.js)
- **UI**: Ink 5.x (React terminal renderer)
- **Language**: TypeScript with strict mode

### Key Directories
- `components/` - React UI components (ServicePanel, LogPanel, StatusBar, ConfirmDialog)
- `hooks/` - React hooks for AWS polling (useEcsStatus, useLogs, useDeployments)
- `services/aws.ts` - AWS CLI command wrappers (uses `Bun.spawn()`, not AWS SDK)
- `deployments/` - JSON configs for each environment (production.json, development.json)
- `types/deployment.ts` - TypeScript interfaces for all data structures

### Data Flow
1. `useDeployments` loads JSON configs from `deployments/`
2. `useEcsStatus` polls AWS ECS/RDS every 15 seconds via CLI
3. `useLogs` streams CloudWatch logs in real-time
4. User keyboard input triggers actions (deploy, restart, switch panes)

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

| Key | Action |
|-----|--------|
| Q | Quit |
| D/R | Deploy/Restart (force new ECS deployment) |
| L | Toggle expanded logs |
| P | Pause/resume log streaming |
| C | Clear logs |
| 1-4 | Switch deployment pane |
| Enter | Refresh status |

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
