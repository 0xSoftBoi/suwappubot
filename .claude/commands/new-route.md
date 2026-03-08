---
description: "Add a new TypeScript API endpoint (Hono + Effect-TS)"
---

# New TypeScript API Route

## Step-by-Step

### 1. Create Route File

Create `api-ts/src/routes/<name>.ts`:

```typescript
import { Hono } from 'hono'
import { Effect } from 'effect'
import { telegramAuth } from '../middleware'  // or agentAuth for agent API
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, ValidationError, NotFoundError } from '../errors'

const featureRoutes = new Hono()

// Public route (no auth)
featureRoutes.get('/feature/public', async (c) => {
  return c.json({ status: 'ok' })
})

// Protected route (Telegram Mini App auth)
featureRoutes.use('/webapp/feature/*', telegramAuth())

featureRoutes.get('/webapp/feature/data', async (c) => {
  const user = c.get('telegramUser')

  const program = Effect.gen(function* () {
    const featureService = yield* FeatureService
    return yield* featureService.getData(user.id)
  })

  const result = await runEffectEither(program)
  if (result._tag === 'Left') {
    return mapErrorToResponse(c, result.left)
  }
  return c.json(result.right)
})

export { featureRoutes }
```

### 2. Create Service Layer

Create `api-ts/src/services/FeatureService.ts`:

```typescript
import { Context, Effect, Layer } from 'effect'

// Define the service interface
interface FeatureServiceInterface {
  getData(userId: number): Effect.Effect<FeatureData, NotFoundError>
}

// Create the service tag
class FeatureService extends Context.Tag('FeatureService')<
  FeatureService,
  FeatureServiceInterface
>() {}

// Implement the service
const FeatureServiceLive = Layer.succeed(FeatureService, {
  getData: (userId: number) =>
    Effect.gen(function* () {
      // Use Drizzle ORM for queries
      const db = yield* DatabaseService
      const result = yield* Effect.tryPromise({
        try: () => db.select().from(features).where(eq(features.userId, userId)),
        catch: (e) => new DatabaseError({ message: String(e) }),
      })
      if (result.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: 'Feature not found' }))
      }
      return result[0]
    }),
})

export { FeatureService, FeatureServiceLive }
```

### 3. Auth Middleware

Two auth middlewares available:

```typescript
// For Telegram Mini App routes (validates X-Telegram-Init-Data header)
import { telegramAuth } from '../middleware'
featureRoutes.use('/webapp/feature/*', telegramAuth())

// For agent API routes (validates X-Agent-Key header)
import { agentAuth } from '../middleware'
featureRoutes.use('/agent/feature/*', agentAuth())
```

### 4. Redis Caching

```typescript
import { RedisService, cacheKeys } from '../services'

// In your Effect pipeline:
const redis = yield* RedisService

// Cache a value
yield* redis.set(cacheKeys.custom(`feature:${id}`), data, 300) // 5 min TTL

// Get cached value
const cached = yield* Effect.either(redis.get<FeatureData>(cacheKeys.custom(`feature:${id}`)))
if (Either.isRight(cached) && cached.right) {
  return cached.right
}
```

### 5. Error Handling

Use the typed error hierarchy:

```typescript
import { ValidationError, NotFoundError, DatabaseError } from '../errors'

// Fail with typed errors in Effect pipelines
yield* Effect.fail(new ValidationError({ message: 'Invalid input' }))
yield* Effect.fail(new NotFoundError({ message: 'User not found' }))

// Map errors to HTTP responses
const result = await runEffectEither(program)
if (result._tag === 'Left') {
  return mapErrorToResponse(c, result.left)
}
```

### 6. Register Route

In `api-ts/src/routes/index.ts`:

```typescript
export { featureRoutes } from './feature'
```

In `api-ts/src/index.ts`, mount the routes:

```typescript
import { featureRoutes } from './routes'
app.route('/', featureRoutes)
```

## Gotchas

- **Don't mix Promises with Effect**: Use `Effect.tryPromise()` to wrap async operations inside Effect pipelines. Never `await` inside `Effect.gen`.
- **Error type hierarchy**: `ValidationError` → 400, `NotFoundError` → 404, `DatabaseError` → 500
- **Schema validation**: Use `@effect/schema` for request body validation, not manual checks
- **Drizzle ORM**: Use `eq`, `desc`, `in_` from `drizzle-orm` for type-safe queries
- **runEffectEither**: Always use this to execute Effect pipelines in Hono handlers — it provides the full Layer stack

## Reference Files

- `api-ts/src/routes/swap.ts` — complex route with caching, auth, service calls
- `api-ts/src/routes/webapp.ts` — Telegram Mini App authenticated routes
- `api-ts/src/services/SwapService.ts` — Effect-TS service pattern
- `api-ts/src/config/EnvService.ts` — environment config as Effect Layer
- `api-ts/src/runtime.ts` — `runEffectEither` and ManagedRuntime setup
- `api-ts/src/errors.ts` — error types and `mapErrorToResponse`
