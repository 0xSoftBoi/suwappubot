import { Layer } from 'effect'
import { EnvServiceLive } from '../config/EnvService'
import { DrizzleServiceLive } from '../db'
import { TelegramAuthServiceLive } from './TelegramAuthService'
import { WalletServiceLive } from './WalletService'
import { SwapServiceLive } from './SwapService'
import { UserServiceLive } from './UserService'

// Base configuration layer
export const ConfigLayer = EnvServiceLive

// Database layer depends on config
export const DatabaseLayer = DrizzleServiceLive.pipe(Layer.provide(ConfigLayer))

// Telegram auth layer depends on config
export const TelegramAuthLayer = TelegramAuthServiceLive.pipe(Layer.provide(ConfigLayer))

// Service layers (stateless, no dependencies on other services)
export const ServicesLayer = Layer.mergeAll(WalletServiceLive, SwapServiceLive, UserServiceLive)

// Full application layer with all services
export const MainLayer = Layer.mergeAll(
	ConfigLayer,
	DatabaseLayer,
	TelegramAuthLayer,
	ServicesLayer
)

// Type alias for the full context
export type MainLayerContext = Layer.Layer.Success<typeof MainLayer>
