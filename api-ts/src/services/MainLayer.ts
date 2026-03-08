import { Layer } from 'effect'
import { EnvServiceLive } from '../config/EnvService'
import { DrizzleServiceLive } from '../db'
import { TelegramAuthServiceLive } from './TelegramAuthService'
import { WalletServiceLive } from './WalletService'
import { SwapServiceLive } from './SwapService'
import { UserServiceLive } from './UserService'
import { PointsServiceLive } from './PointsService'
import { BalanceServiceLive } from './BalanceService'
import { TurnkeyServiceLive } from './TurnkeyService'
import { AgentServiceLive } from './AgentService'
import { TokenServiceLive } from './TokenService'
import { JupiterServiceLive } from './JupiterService'
import { RedisServiceLive } from './RedisService'
import { LimitOrderServiceLive } from './LimitOrderService'
import { CopyTradingServiceLive } from './CopyTradingService'
import { DCAServiceLive } from './DCAService'
import { AlertServiceLive } from './AlertService'
import { OrderServiceLive } from './OrderService'
import { ReferralServiceLive } from './ReferralService'

// Base configuration layer
export const ConfigLayer = EnvServiceLive

// Database layer depends on config
export const DatabaseLayer = DrizzleServiceLive.pipe(Layer.provide(ConfigLayer))

// Telegram auth layer depends on config
export const TelegramAuthLayer = TelegramAuthServiceLive.pipe(Layer.provide(ConfigLayer))

// Turnkey layer depends on config
export const TurnkeyLayer = TurnkeyServiceLive.pipe(Layer.provide(ConfigLayer))

// Redis layer depends on config
export const RedisLayer = RedisServiceLive.pipe(Layer.provide(ConfigLayer))

// Service layers (stateless, no dependencies on other services)
export const ServicesLayer = Layer.mergeAll(WalletServiceLive, SwapServiceLive, UserServiceLive, PointsServiceLive, BalanceServiceLive, AgentServiceLive, TokenServiceLive, JupiterServiceLive, LimitOrderServiceLive, CopyTradingServiceLive, DCAServiceLive, AlertServiceLive, OrderServiceLive, ReferralServiceLive)

// Full application layer with all services
export const MainLayer = Layer.mergeAll(
	ConfigLayer,
	DatabaseLayer,
	TelegramAuthLayer,
	TurnkeyLayer,
	RedisLayer,
	ServicesLayer
)

// Type alias for the full context
export type MainLayerContext = Layer.Layer.Success<typeof MainLayer>
