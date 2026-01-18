import { Effect, Either, ManagedRuntime } from 'effect'
import { MainLayer, type MainLayerContext } from './services/MainLayer'

// Create a managed runtime that handles resource lifecycle
const managedRuntime = ManagedRuntime.make(MainLayer)

/**
 * Run an Effect and return the result as a Promise
 */
export const runEffect = <A, E>(effect: Effect.Effect<A, E, MainLayerContext>): Promise<A> =>
	managedRuntime.runPromise(effect)

/**
 * Run an Effect and return an Either (for error handling in routes)
 */
export const runEffectEither = async <A, E>(
	effect: Effect.Effect<A, E, MainLayerContext>
): Promise<Either.Either<A, E>> => managedRuntime.runPromise(Effect.either(effect))

/**
 * Gracefully shutdown the runtime
 */
export const shutdownRuntime = (): Promise<void> => managedRuntime.dispose()
