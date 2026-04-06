import { Effect, type Either, ManagedRuntime } from 'effect'
import { MainLayer, type MainLayerContext } from './services/MainLayer'

// Create a managed runtime that handles resource lifecycle
const managedRuntime = ManagedRuntime.make(MainLayer)
type RuntimeDriver = Pick<typeof managedRuntime, 'runPromise' | 'dispose'>
let runtimeDriver: RuntimeDriver = managedRuntime

export const setRuntimeDriver = (driver: RuntimeDriver): void => {
	runtimeDriver = driver
}

export const resetRuntimeDriver = (): void => {
	runtimeDriver = managedRuntime
}

/**
 * Run an Effect and return the result as a Promise
 */
export const runEffect = <A, E>(effect: Effect.Effect<A, E, MainLayerContext>): Promise<A> =>
	runtimeDriver.runPromise(effect)

/**
 * Run an Effect and return an Either (for error handling in routes)
 */
export const runEffectEither = async <A, E>(
	effect: Effect.Effect<A, E, MainLayerContext>,
): Promise<Either.Either<A, E>> => runtimeDriver.runPromise(Effect.either(effect))

/**
 * Gracefully shutdown the runtime
 */
export const shutdownRuntime = (): Promise<void> => runtimeDriver.dispose()
