import { Layer } from 'effect'
import { EnvServiceLive } from '../config/EnvService'
import { DrizzleServiceLive } from '../db'
import { AgentServiceLive } from './AgentService'
import { AgentTrustServiceLive } from './AgentTrustService'
import { AlertServiceLive } from './AlertService'
import { ApprovalServiceLive } from './ApprovalService'
import { AutopilotServiceLive } from './AutopilotService'
import { BalanceServiceLive } from './BalanceService'
import { CopyTradingServiceLive } from './CopyTradingService'
import { DCAServiceLive } from './DCAService'
import { EventBusLive } from './EventBus'
import { HyperliquidServiceLive } from './HyperliquidService'
import { JupiterServiceLive } from './JupiterService'
import { LimitOrderServiceLive } from './LimitOrderService'
import { MorphoServiceLive } from './MorphoService'
import { OrderServiceLive } from './OrderService'
import { P2PServiceLive } from './P2PService'
import { PointsServiceLive } from './PointsService'
import { PolicyServiceLive } from './PolicyService'
import { PolymarketCredentialServiceLive } from './PolymarketCredentialService'
import { TenantBotServiceLive } from './TenantBotService'
import { PolymarketServiceLive } from './PolymarketService'
import { RedisServiceLive } from './RedisService'
import { ReferralServiceLive } from './ReferralService'
import { RewardsServiceLive } from './RewardsService'
import { SeasonsServiceLive } from './SeasonsService'
import { SmartAccountServiceLive } from './SmartAccountService'
import { StripeServiceLive } from './StripeService'
import { SwapServiceLive } from './SwapService'
import { TelegramAuthServiceLive } from './TelegramAuthService'
import { TokenServiceLive } from './TokenService'
import { TurnkeyServiceLive } from './TurnkeyService'
import { UserServiceLive } from './UserService'
import { WalletServiceLive } from './WalletService'

// Base configuration layer
export const ConfigLayer = EnvServiceLive

// Database layer depends on config
export const DatabaseLayer = DrizzleServiceLive.pipe(Layer.provide(ConfigLayer))

// Telegram auth layer depends on config
export const TelegramAuthLayer = TelegramAuthServiceLive.pipe(Layer.provide(ConfigLayer))

// Turnkey layer depends on config
export const TurnkeyLayer = TurnkeyServiceLive.pipe(Layer.provide(ConfigLayer))

// Stripe layer depends on config
export const StripeLayer = StripeServiceLive.pipe(Layer.provide(ConfigLayer))

// Smart-account (ERC-4337) layer depends on config only
export const SmartAccountLayer = SmartAccountServiceLive.pipe(Layer.provide(ConfigLayer))

// On-chain rewards read API depends on config (distributor address + RPC)
export const RewardsLayer = RewardsServiceLive.pipe(Layer.provide(ConfigLayer))

// Redis layer depends on config
export const RedisLayer = RedisServiceLive.pipe(Layer.provide(ConfigLayer))

// Event bus layer depends on config (uses Redis for pub/sub)
export const EventBusLayer = EventBusLive.pipe(Layer.provide(ConfigLayer))

// Polymarket credential layer depends on config + database
export const PolymarketCredentialLayer = PolymarketCredentialServiceLive.pipe(
	Layer.provide(ConfigLayer),
	Layer.provide(DatabaseLayer),
)

// Tenant bots need the env (for the token-encryption key) and the db.
export const TenantBotLayer = TenantBotServiceLive.pipe(
	Layer.provide(ConfigLayer),
	Layer.provide(DatabaseLayer),
)

// Service layers (stateless, no dependencies on other services)
export const ServicesLayer = Layer.mergeAll(
	WalletServiceLive,
	SwapServiceLive,
	UserServiceLive,
	PointsServiceLive,
	SeasonsServiceLive,
	BalanceServiceLive,
	AgentServiceLive,
	AgentTrustServiceLive,
	AutopilotServiceLive,
	TokenServiceLive,
	JupiterServiceLive,
	LimitOrderServiceLive,
	CopyTradingServiceLive,
	DCAServiceLive,
	AlertServiceLive,
	ApprovalServiceLive,
	OrderServiceLive,
	ReferralServiceLive,
	HyperliquidServiceLive,
	PolymarketServiceLive,
	MorphoServiceLive,
	P2PServiceLive,
	PolicyServiceLive,
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
	PolymarketCredentialLayer,
	TenantBotLayer,
	StripeLayer,
	SmartAccountLayer,
	RewardsLayer,
)

// Type alias for the full context
export type MainLayerContext = Layer.Layer.Success<typeof MainLayer>
