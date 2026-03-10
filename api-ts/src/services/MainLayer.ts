import { Layer } from 'effect'
import { EnvServiceLive } from '../config/EnvService'
import { DrizzleServiceLive } from '../db'
import { AgentServiceLive } from './AgentService'
import { AlertServiceLive } from './AlertService'
import { BalanceServiceLive } from './BalanceService'
import { CopyTradingServiceLive } from './CopyTradingService'
import { DCAServiceLive } from './DCAService'
import { EventBusLive } from './EventBus'
import { JupiterServiceLive } from './JupiterService'
import { LimitOrderServiceLive } from './LimitOrderService'
import { OrderServiceLive } from './OrderService'
import { PointsServiceLive } from './PointsService'
import { RedisServiceLive } from './RedisService'
import { ReferralServiceLive } from './ReferralService'
import { SwapServiceLive } from './SwapService'
import { TelegramAuthServiceLive } from './TelegramAuthService'
import { TokenServiceLive } from './TokenService'
import { TurnkeyServiceLive } from './TurnkeyService'
import { UserServiceLive } from './UserService'
import { HyperliquidServiceLive } from './HyperliquidService'
import { MorphoServiceLive } from './MorphoService'
import { PolymarketServiceLive } from './PolymarketService'
import { WalletServiceLive } from './WalletService'

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

// Event bus layer depends on config (uses Redis for pub/sub)
export const EventBusLayer = EventBusLive.pipe(Layer.provide(ConfigLayer))

// Service layers (stateless, no dependencies on other services)
export const ServicesLayer = Layer.mergeAll(
	WalletServiceLive,
	SwapServiceLive,
	UserServiceLive,
	PointsServiceLive,
	BalanceServiceLive,
	AgentServiceLive,
	TokenServiceLive,
	JupiterServiceLive,
	LimitOrderServiceLive,
	CopyTradingServiceLive,
	DCAServiceLive,
	AlertServiceLive,
	OrderServiceLive,
	ReferralServiceLive,
	HyperliquidServiceLive,
	PolymarketServiceLive,
	MorphoServiceLive,
)

// Full application layer with all services
export const MainLayer = Layer.mergeAll(
	ConfigLayer,
	DatabaseLayer,
	TelegramAuthLayer,
	TurnkeyLayer,
	RedisLayer,
	EventBusLayer,
	ServicesLayer,
)

// Type alias for the full context
export type MainLayerContext = Layer.Layer.Success<typeof MainLayer>
