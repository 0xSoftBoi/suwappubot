CREATE TYPE "public"."dca_interval" AS ENUM('hourly', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."dca_order_status" AS ENUM('active', 'paused', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."limit_order_status" AS ENUM('active', 'filled', 'cancelled', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "rug_monitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_address" varchar(255) NOT NULL,
	"chain" varchar(50) NOT NULL,
	"token_symbol" varchar(20),
	"is_active" boolean DEFAULT true,
	"auto_sell_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "swap_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"from_chain" varchar(50) NOT NULL,
	"from_token" varchar(20) NOT NULL,
	"to_chain" varchar(50) NOT NULL,
	"to_token" varchar(20) NOT NULL,
	"default_amount" varchar(78),
	"slippage" real DEFAULT 0.5,
	"use_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"api_key" varchar(64) NOT NULL,
	"api_key_hash" varchar(128) NOT NULL,
	"callback_url" text,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"rate_limit_tier" varchar(20) DEFAULT 'free' NOT NULL,
	"subscription_tier" varchar(20),
	"subscription_expires_at" timestamp,
	"total_requests" integer DEFAULT 0,
	"total_swaps" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp,
	CONSTRAINT "agents_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "agents_name_unique" UNIQUE("name"),
	CONSTRAINT "agents_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "copy_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"follower_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"copy_mode" varchar(20) DEFAULT 'notify',
	"copy_type" varchar(20) DEFAULT 'fixed',
	"copy_amount_usd" real DEFAULT 10,
	"copy_percentage" real DEFAULT 100,
	"max_trade_usd" real DEFAULT 100,
	"daily_limit_usd" real DEFAULT 500,
	"daily_copied_usd" real DEFAULT 0,
	"last_daily_reset" timestamp,
	"max_slippage_percent" real DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"auto_sell_enabled" boolean DEFAULT true,
	"chains_filter" varchar(200),
	"total_copied_trades" integer DEFAULT 0,
	"total_copied_volume" real DEFAULT 0,
	"total_copy_pnl" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "copy_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"copy_trade_id" integer NOT NULL,
	"telegram_message_id" integer,
	"sent_at" timestamp DEFAULT now(),
	"action_taken" varchar(20),
	"action_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "copy_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_swap_id" integer NOT NULL,
	"copy_swap_id" integer,
	"trader_id" integer NOT NULL,
	"copier_id" integer NOT NULL,
	"follow_id" integer NOT NULL,
	"from_token" varchar(20) NOT NULL,
	"to_token" varchar(20) NOT NULL,
	"from_chain" varchar(20) NOT NULL,
	"to_chain" varchar(20) NOT NULL,
	"trader_amount_usd" real NOT NULL,
	"copy_amount_usd" real NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"failure_reason" varchar(255),
	"entry_price" real,
	"exit_price" real,
	"pnl_usd" real,
	"created_at" timestamp DEFAULT now(),
	"copied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "trader_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"is_public" boolean DEFAULT false,
	"display_name" varchar(50),
	"bio" varchar(255),
	"avatar_emoji" varchar(10) DEFAULT '🦊',
	"total_trades" integer DEFAULT 0,
	"winning_trades" integer DEFAULT 0,
	"total_pnl_usd" real DEFAULT 0,
	"total_volume_usd" real DEFAULT 0,
	"win_rate" real DEFAULT 0,
	"avg_trade_size_usd" real DEFAULT 0,
	"best_trade_pnl_usd" real DEFAULT 0,
	"worst_trade_pnl_usd" real DEFAULT 0,
	"follower_count" integer DEFAULT 0,
	"times_copied" integer DEFAULT 0,
	"total_copy_volume_usd" real DEFAULT 0,
	"rank_score" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trader_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader_id" integer NOT NULL,
	"swap_id" integer NOT NULL,
	"from_token" varchar(20) NOT NULL,
	"to_token" varchar(20) NOT NULL,
	"from_chain" varchar(20) NOT NULL,
	"to_chain" varchar(20) NOT NULL,
	"amount_usd" real NOT NULL,
	"entry_price" real,
	"current_price" real,
	"is_closed" boolean DEFAULT false,
	"pnl_usd" real DEFAULT 0,
	"pnl_percent" real DEFAULT 0,
	"is_winning" boolean,
	"created_at" timestamp DEFAULT now(),
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dca_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"dca_order_id" integer NOT NULL,
	"amount_spent" varchar(78) NOT NULL,
	"amount_received" varchar(78) NOT NULL,
	"price" real NOT NULL,
	"tx_hash" varchar(100),
	"executed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dca_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_chain" varchar(50) NOT NULL,
	"from_token" varchar(42) NOT NULL,
	"from_token_symbol" varchar(20) NOT NULL,
	"to_chain" varchar(50) NOT NULL,
	"to_token" varchar(42) NOT NULL,
	"to_token_symbol" varchar(20) NOT NULL,
	"amount_per_execution" varchar(78) NOT NULL,
	"interval" "dca_interval" NOT NULL,
	"total_executions" integer,
	"executions_completed" integer DEFAULT 0,
	"max_slippage" integer DEFAULT 50,
	"wallet_address" varchar(42) NOT NULL,
	"status" "dca_order_status" DEFAULT 'active',
	"next_execution_at" timestamp NOT NULL,
	"last_executed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fee_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"swap_fee_percentage" real DEFAULT 1,
	"min_fee_usd" real DEFAULT 0,
	"max_fee_usd" real DEFAULT 1000,
	"fee_collector_chain" varchar(50) DEFAULT 'ethereum',
	"fee_collector_address" varchar(100),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fee_discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"discount_tier" varchar(20) DEFAULT 'none',
	"discount_percent" real DEFAULT 0,
	"valid_until" timestamp,
	"source" varchar(20) DEFAULT 'points',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fee_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_type" varchar(10) NOT NULL,
	"period_date" varchar(10) NOT NULL,
	"total_swaps" integer DEFAULT 0,
	"total_volume_usd" real DEFAULT 0,
	"total_fees_usd" real DEFAULT 0,
	"chain_breakdown" varchar(2000),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fee_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"swap_id" integer,
	"chain" varchar(50) NOT NULL,
	"token_symbol" varchar(20) NOT NULL,
	"swap_amount" real NOT NULL,
	"fee_percentage" real NOT NULL,
	"fee_amount" real NOT NULL,
	"fee_amount_usd" real,
	"collected" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "points_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tier" varchar(20) DEFAULT 'none',
	"qualifying_xp" integer DEFAULT 0,
	"qualifying_volume_usd" numeric(20, 2) DEFAULT '0',
	"accumulated_rewards" numeric(20, 8) DEFAULT '0',
	"last_claim_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "points_tiers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "daily_quests" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"quest_type" varchar(50) NOT NULL,
	"description" varchar(255) NOT NULL,
	"target_value" integer NOT NULL,
	"points_reward" integer NOT NULL,
	"xp_reward" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jackpot_pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"total_pool_usd" real DEFAULT 0,
	"winner_user_id" integer,
	"winner_payout_usd" real,
	"is_drawn" boolean DEFAULT false,
	"drawn_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "jackpot_pools_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "user_quests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"quest_id" integer NOT NULL,
	"progress" integer DEFAULT 0,
	"is_completed" boolean DEFAULT false,
	"completed_at" timestamp,
	"claimed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hot_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"chain_type" varchar(20) NOT NULL,
	"address" varchar(100) NOT NULL,
	"encrypted_private_key" text,
	"encryption_scheme" varchar(50) DEFAULT 'legacy_fernet_v1',
	"kms_wrapped_dek" text,
	"aesgcm_nonce" varchar(32),
	"kms_key_id" varchar(255),
	"key_version" integer DEFAULT 1,
	"wallet_provider" varchar(20) DEFAULT 'local',
	"turnkey_wallet_id" varchar(100),
	"turnkey_account_id" varchar(100),
	"is_deposit_wallet" boolean DEFAULT true,
	"is_gas_payer" boolean DEFAULT false,
	"native_balance" varchar(78) DEFAULT '0',
	"last_balance_check" timestamp,
	"min_native_balance" varchar(78) DEFAULT '0.1',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "hot_wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "limit_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_chain" varchar(50) NOT NULL,
	"from_token" varchar(42) NOT NULL,
	"from_token_symbol" varchar(20) NOT NULL,
	"from_amount" varchar(78) NOT NULL,
	"to_chain" varchar(50) NOT NULL,
	"to_token" varchar(42) NOT NULL,
	"to_token_symbol" varchar(20) NOT NULL,
	"target_price" real NOT NULL,
	"trigger_type" varchar(10) DEFAULT 'lte' NOT NULL,
	"slippage" integer DEFAULT 50,
	"wallet_address" varchar(42) NOT NULL,
	"status" "limit_order_status" DEFAULT 'active',
	"current_price" real,
	"last_checked_at" timestamp,
	"executed_at" timestamp,
	"executed_price" real,
	"executed_tx_hash" varchar(255),
	"swap_transaction_id" integer,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"email" varchar(255),
	"name" varchar(255),
	"profile_image" text,
	"turnkey_authenticator_id" varchar(255),
	"is_primary" boolean DEFAULT false,
	"is_verified" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_login_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" varchar(64) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"redirect_uri" text,
	"code_verifier" varchar(128),
	"user_id" integer,
	"action" varchar(50) DEFAULT 'login',
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"token_type" varchar(50) DEFAULT 'Bearer',
	"scope" text,
	"expires_at" timestamp,
	"refresh_expires_at" timestamp,
	"encryption_scheme" varchar(50) DEFAULT 'kms_aesgcm_v2',
	"kms_wrapped_dek" text,
	"aesgcm_nonce" varchar(32),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "p2p_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"maker_user_id" bigint NOT NULL,
	"maker_wallet_id" integer,
	"source" varchar(16) DEFAULT 'native',
	"offer_type" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'active',
	"fiat_currency" varchar(3) NOT NULL,
	"crypto_asset" varchar(20) NOT NULL,
	"crypto_chain" varchar(32) DEFAULT 'base',
	"price_per_unit" numeric(20, 6) NOT NULL,
	"min_fiat_amount" numeric(20, 2) NOT NULL,
	"max_fiat_amount" numeric(20, 2) NOT NULL,
	"available_crypto" varchar(78),
	"payment_methods" text,
	"region" varchar(8),
	"terms" text,
	"payment_window_minutes" integer DEFAULT 30,
	"completion_rate" double precision DEFAULT 1,
	"trade_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "p2p_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(16) DEFAULT 'native',
	"offer_id" integer,
	"external_offer_id" varchar(255),
	"external_trade_id" varchar(255),
	"taker_user_id" bigint NOT NULL,
	"maker_user_id" bigint,
	"counterparty_handle" varchar(255),
	"status" varchar(20) DEFAULT 'initiated',
	"offer_type" varchar(16) NOT NULL,
	"fiat_currency" varchar(3) NOT NULL,
	"crypto_asset" varchar(20) NOT NULL,
	"crypto_chain" varchar(32) DEFAULT 'base',
	"fiat_amount" numeric(20, 2) NOT NULL,
	"crypto_amount" varchar(78) NOT NULL,
	"price_per_unit" numeric(20, 6) NOT NULL,
	"payment_method" varchar(64) NOT NULL,
	"escrow_address" varchar(255),
	"escrow_lock_tx" varchar(255),
	"escrow_release_tx" varchar(255),
	"fiat_payment_ref" varchar(255),
	"dispute_reason" text,
	"disputed_at" timestamp,
	"error_message" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_credit_topups" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"tx_hash" varchar(128) NOT NULL,
	"chain" varchar(32) DEFAULT 'base' NOT NULL,
	"amount_usd" real NOT NULL,
	"credits_added" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_credit_topups_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "agent_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"balance" real DEFAULT 0 NOT NULL,
	"lifetime_purchased" real DEFAULT 0 NOT NULL,
	"lifetime_used" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_credits_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"tier" varchar(20) NOT NULL,
	"tx_hash" varchar(128) NOT NULL,
	"chain" varchar(32) DEFAULT 'base' NOT NULL,
	"amount_usd" real NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_subscriptions_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "agent_subscriptions_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "api_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"balance" real DEFAULT 0,
	"lifetime_purchased" real DEFAULT 0,
	"lifetime_used" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "api_credits_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_id" integer,
	"account" varchar(64) NOT NULL,
	"spender" varchar(64) NOT NULL,
	"token" varchar(64) NOT NULL,
	"allowance" varchar(80) NOT NULL,
	"period_seconds" integer NOT NULL,
	"start_ts" integer NOT NULL,
	"end_ts" integer NOT NULL,
	"salt" varchar(80) NOT NULL,
	"signature" text NOT NULL,
	"tier" varchar(20),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"approved_tx" varchar(128),
	"next_charge_at" timestamp,
	"last_charge_at" timestamp,
	"last_charge_tx" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"payment_id" varchar(128) NOT NULL,
	"amount" real NOT NULL,
	"token_symbol" varchar(16) DEFAULT 'USDC',
	"token_address" varchar(64),
	"chain" varchar(32) DEFAULT 'base',
	"tx_hash" varchar(128),
	"status" varchar(20) DEFAULT 'pending',
	"product_type" varchar(32) NOT NULL,
	"product_id" varchar(64),
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"receipt" text,
	"payment_method" varchar(32) DEFAULT 'crypto',
	"stars_amount" integer,
	CONSTRAINT "x402_payments_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "hyperliquid_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"hl_address" varchar(255),
	"api_key_encrypted" text,
	"api_secret_encrypted" text,
	"is_active" boolean DEFAULT true,
	"total_equity" numeric(20, 8) DEFAULT '0',
	"available_margin" numeric(20, 8) DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "hyperliquid_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "perp_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"position_id" integer,
	"exchange" varchar(50) DEFAULT 'hyperliquid',
	"market" varchar(50) NOT NULL,
	"side" varchar(10) NOT NULL,
	"order_type" varchar(20) NOT NULL,
	"size" numeric(20, 8) NOT NULL,
	"price" numeric(20, 8),
	"leverage" integer DEFAULT 1,
	"status" varchar(20) DEFAULT 'pending',
	"hl_order_id" varchar(100),
	"fill_price" numeric(20, 8),
	"filled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "perp_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"wallet_id" integer,
	"exchange" varchar(50) DEFAULT 'hyperliquid',
	"market" varchar(50) NOT NULL,
	"side" varchar(10) NOT NULL,
	"size" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"mark_price" numeric(20, 8),
	"leverage" integer DEFAULT 1,
	"margin" numeric(20, 8),
	"unrealized_pnl" numeric(20, 8) DEFAULT '0',
	"liquidation_price" numeric(20, 8),
	"tp_price" numeric(20, 8),
	"sl_price" numeric(20, 8),
	"status" varchar(20) DEFAULT 'open',
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"closed_pnl" numeric(20, 8)
);
--> statement-breakpoint
CREATE TABLE "polymarket_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text,
	"wallet_address" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_secret_encrypted" text NOT NULL,
	"passphrase_encrypted" text NOT NULL,
	"encryption_scheme" text DEFAULT 'aes-256-gcm' NOT NULL,
	"kms_wrapped_dek" text,
	"aesgcm_nonce" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "polymarket_accounts_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(255) NOT NULL,
	"emoji" varchar(10) DEFAULT '🏆' NOT NULL,
	"requirement_type" varchar(50) NOT NULL,
	"requirement_value" integer NOT NULL,
	"points_reward" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "milestones_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "point_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reward_id" integer,
	"points_spent" integer NOT NULL,
	"reward_type" varchar(50) NOT NULL,
	"reward_value" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "point_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"action" varchar(50) NOT NULL,
	"description" varchar(255),
	"swap_id" integer,
	"referral_id" integer,
	"season_id" integer,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(255) NOT NULL,
	"emoji" varchar(10) DEFAULT '🎁' NOT NULL,
	"points_cost" integer NOT NULL,
	"reward_type" varchar(50) NOT NULL,
	"reward_value" varchar(50) NOT NULL,
	"reward_category" varchar(30) DEFAULT 'own_product' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"stock" integer,
	"duration_days" integer
);
--> statement-breakpoint
CREATE TABLE "user_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"milestone_id" integer NOT NULL,
	"achieved_at" timestamp DEFAULT now() NOT NULL,
	"points_awarded" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"total_points_earned" integer DEFAULT 0 NOT NULL,
	"current_points" integer DEFAULT 0 NOT NULL,
	"points_spent" integer DEFAULT 0 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" varchar(20) DEFAULT 'bronze' NOT NULL,
	"daily_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_checkin" timestamp,
	"last_swap_date" timestamp,
	"total_swaps" integer DEFAULT 0 NOT NULL,
	"total_volume_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_points_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "redemption_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reward_id" integer,
	"category" varchar(30) NOT NULL,
	"points_spent" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"provider" varchar(40),
	"provider_ref" varchar(120),
	"payload" json,
	"idempotency_key" varchar(120),
	"error" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"fulfilled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"token_symbol" varchar(20) NOT NULL,
	"chain" varchar(50) NOT NULL,
	"target_price" real NOT NULL,
	"condition" varchar(10) NOT NULL,
	"is_active" boolean DEFAULT true,
	"is_triggered" boolean DEFAULT false,
	"triggered_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"total_referrals" integer DEFAULT 0,
	"total_rewards" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "referral_codes_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount_usd" real NOT NULL,
	"token" varchar(20) NOT NULL,
	"token_amount" varchar(78) NOT NULL,
	"chain" varchar(50) NOT NULL,
	"tx_hash" varchar(128),
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"error_message" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"referral_id" integer NOT NULL,
	"swap_id" integer NOT NULL,
	"fee_amount_usd" real NOT NULL,
	"reward_amount_usd" real NOT NULL,
	"tier" varchar(20) DEFAULT 'tier_1',
	"reward_percentage" real DEFAULT 30,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "referral_rewards_swap_id_unique" UNIQUE("swap_id")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_id" integer NOT NULL,
	"referred_id" integer NOT NULL,
	"referral_code" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reward_amount" real,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "referrals_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "season_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"points" double precision DEFAULT 0 NOT NULL,
	"base_points" double precision DEFAULT 0 NOT NULL,
	"swap_volume_usd" double precision DEFAULT 0 NOT NULL,
	"referral_points" double precision DEFAULT 0 NOT NULL,
	"daily_points_awarded" double precision DEFAULT 0 NOT NULL,
	"daily_window_date" varchar(10),
	"fee_paid_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"final_points" double precision NOT NULL,
	"rank" integer,
	"total_points" double precision NOT NULL,
	"token_pool" double precision NOT NULL,
	"token_allocation" double precision NOT NULL,
	"token_symbol" varchar(20) DEFAULT 'SUWP' NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp,
	"claim_tx_hash" varchar(120),
	"wallet_address" varchar(120),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'upcoming' NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"token_pool" double precision DEFAULT 0 NOT NULL,
	"token_symbol" varchar(20) DEFAULT 'SUWP' NOT NULL,
	"description" varchar(255),
	"season_index" integer DEFAULT 1 NOT NULL,
	"quarter" varchar(16),
	"total_points_snapshot" double precision,
	"realized_fee_revenue_usd" double precision,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"details" text,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "backup_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code_hash" varchar(128) NOT NULL,
	"is_used" boolean DEFAULT false,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "withdrawal_whitelist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"chain" varchar(50) NOT NULL,
	"address" varchar(255) NOT NULL,
	"label" varchar(100),
	"cooldown_until" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auto_snipe_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"wallet_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true,
	"platforms" json DEFAULT '["pump_fun","raydium"]'::json,
	"min_liquidity_sol" real,
	"max_liquidity_sol" real,
	"min_quality_score" real,
	"require_socials" boolean DEFAULT false,
	"name_must_contain" json DEFAULT '[]'::json,
	"name_must_not_contain" json DEFAULT '[]'::json,
	"creator_whitelist" json DEFAULT '[]'::json,
	"creator_blacklist" json DEFAULT '[]'::json,
	"sol_amount" real NOT NULL,
	"slippage_bps" integer DEFAULT 1000,
	"use_jito" boolean DEFAULT true,
	"jito_tip" integer DEFAULT 10000000,
	"max_snipes_per_day" integer DEFAULT 10,
	"max_sol_per_day" real DEFAULT 5,
	"snipes_today" integer DEFAULT 0,
	"sol_spent_today" real DEFAULT 0,
	"last_reset_date" varchar(10),
	"total_snipes" integer DEFAULT 0,
	"successful_snipes" integer DEFAULT 0,
	"total_sol_spent" real DEFAULT 0,
	"total_pnl_sol" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "snipe_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"quick_amounts" json DEFAULT '[0.1,0.5,1,5]'::json,
	"default_sol_amount" real DEFAULT 0.5,
	"default_slippage_bps" integer DEFAULT 1000,
	"default_mode" varchar(20) DEFAULT 'instant',
	"use_jito" boolean DEFAULT true,
	"default_jito_tip" integer DEFAULT 10000000,
	"auto_snipe_enabled" boolean DEFAULT false,
	"auto_snipe_min_liquidity" real DEFAULT 5,
	"auto_snipe_max_liquidity" real DEFAULT 100,
	"auto_snipe_require_socials" boolean DEFAULT false,
	"auto_snipe_platforms" json DEFAULT '["pump_fun","raydium"]'::json,
	"auto_snipe_daily_budget" real DEFAULT 10,
	"auto_snipe_used_today" real DEFAULT 0,
	"honeypot_check" boolean DEFAULT true,
	"authority_check" boolean DEFAULT true,
	"blacklist_check" boolean DEFAULT true,
	"notify_on_launch" boolean DEFAULT true,
	"notify_on_execution" boolean DEFAULT true,
	"notify_on_failure" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "snipe_configs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "snipe_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"snipe_order_id" integer,
	"token_mint" varchar(64) NOT NULL,
	"token_name" varchar(100),
	"token_symbol" varchar(20),
	"platform" varchar(30) NOT NULL,
	"sol_spent" real NOT NULL,
	"tokens_received" varchar(78) NOT NULL,
	"entry_price" real NOT NULL,
	"execution_time_ms" real,
	"current_price" real,
	"current_value_sol" real,
	"pnl_sol" real,
	"pnl_percent" real,
	"highest_price" real,
	"lowest_price" real,
	"is_sold" boolean DEFAULT false,
	"sold_at" timestamp,
	"exit_price" real,
	"sol_received" real,
	"realized_pnl_sol" real,
	"realized_pnl_percent" real,
	"sniped_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "snipe_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"wallet_id" integer NOT NULL,
	"token_mint" varchar(64),
	"token_name" varchar(100),
	"token_symbol" varchar(20),
	"platform" varchar(30) DEFAULT 'any',
	"sol_amount" real NOT NULL,
	"slippage_bps" integer DEFAULT 1000,
	"mode" varchar(20) DEFAULT 'instant',
	"use_jito" boolean DEFAULT true,
	"jito_tip_lamports" integer DEFAULT 10000000,
	"status" varchar(20) DEFAULT 'pending',
	"status_message" varchar(255),
	"min_liquidity_sol" real,
	"max_price_sol" real,
	"require_socials" boolean DEFAULT false,
	"min_quality_score" real,
	"executed_at" timestamp,
	"tx_signature" varchar(128),
	"bundle_id" varchar(128),
	"sol_spent" real,
	"tokens_received" varchar(78),
	"execution_price" real,
	"execution_time_ms" real,
	"slot" integer,
	"retries" integer DEFAULT 0,
	"error_message" varchar(500),
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "watched_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_mint" varchar(64) NOT NULL,
	"token_name" varchar(100),
	"token_symbol" varchar(20),
	"platform" varchar(30) NOT NULL,
	"snipe_on_migration" boolean DEFAULT true,
	"snipe_sol_amount" real DEFAULT 0.5,
	"alert_on_progress" boolean DEFAULT true,
	"progress_percent" real DEFAULT 0,
	"bonding_curve" varchar(64),
	"is_active" boolean DEFAULT true,
	"migrated" boolean DEFAULT false,
	"migrated_at" timestamp,
	"sniped" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tier" varchar(20) DEFAULT 'free',
	"started_at" timestamp,
	"expires_at" timestamp,
	"api_calls_today" integer DEFAULT 0,
	"api_calls_total" integer DEFAULT 0,
	"last_reset_date" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "swap_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_chain" varchar(50) NOT NULL,
	"from_token" varchar(20) NOT NULL,
	"from_amount" varchar(78) NOT NULL,
	"from_amount_usd" real,
	"to_chain" varchar(50) NOT NULL,
	"to_token" varchar(20) NOT NULL,
	"to_amount" varchar(78),
	"to_amount_usd" real,
	"status" varchar(30) DEFAULT 'pending',
	"tx_hash" varchar(255),
	"bridge_tx_hash" varchar(255),
	"destination_tx_hash" varchar(255),
	"idempotency_key" varchar(128),
	"route_provider" varchar(50),
	"route_data" text,
	"gas_fee" real,
	"bridge_fee" real,
	"slippage" integer DEFAULT 50,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"error_message" text,
	"agent_id" integer,
	"agent_uuid" varchar(36)
);
--> statement-breakpoint
CREATE TABLE "token_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"chain" varchar(50) NOT NULL,
	"token_symbol" varchar(20) NOT NULL,
	"token_address" varchar(100) NOT NULL,
	"total_bought" real DEFAULT 0,
	"total_sold" real DEFAULT 0,
	"total_cost_usd" real DEFAULT 0,
	"total_proceeds_usd" real DEFAULT 0,
	"avg_buy_price_usd" real DEFAULT 0,
	"realized_pnl_usd" real DEFAULT 0,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "distribution_epochs" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_number" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_fees_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"staking_pool_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"protocol_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_suwp_staked" numeric(18, 6) DEFAULT '0' NOT NULL,
	"suwp_emission" numeric(18, 6) DEFAULT '10000' NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now(),
	"distributed_at" timestamp,
	"direct_fees_usdc" numeric(18, 6),
	"treasury_yield_usdc" numeric(18, 6),
	"total_staker_usdc" numeric(18, 6),
	"treasury_aum_usdc" numeric(18, 6),
	CONSTRAINT "distribution_epochs_epoch_number_unique" UNIQUE("epoch_number")
);
--> statement-breakpoint
CREATE TABLE "epoch_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"suwp_staked_snapshot" numeric(18, 6) NOT NULL,
	"usdc_reward" numeric(18, 6) NOT NULL,
	"suwp_bonus" numeric(18, 6) NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"tx_hash" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "staking_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"suwp_staked" numeric(18, 6) DEFAULT '0' NOT NULL,
	"staked_since" timestamp,
	"last_reward_epoch" integer,
	"total_usdc_claimed" numeric(18, 6) DEFAULT '0',
	"total_suwp_bonus_claimed" numeric(18, 6) DEFAULT '0',
	"is_active" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "staking_positions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "token_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"points_burned" integer NOT NULL,
	"suwp_amount" numeric(18, 6) NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"tx_hash" varchar(255),
	"error_message" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "treasury_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_name" varchar(50) DEFAULT 'aave_v3_base_usdc',
	"chain" varchar(20) DEFAULT 'base',
	"principal_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"current_a_token_balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_yield_harvested_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"last_deposit_at" timestamp,
	"last_harvest_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trader_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"display_name" varchar(50),
	"is_public" boolean DEFAULT false,
	"total_trades" integer DEFAULT 0,
	"win_rate" real DEFAULT 0,
	"pnl_7d" real DEFAULT 0,
	"pnl_7d_percent" real DEFAULT 0,
	"pnl_30d" real DEFAULT 0,
	"pnl_30d_percent" real DEFAULT 0,
	"follower_count" integer DEFAULT 0,
	"copier_count" integer DEFAULT 0,
	"last_trade_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint,
	"whatsapp_id" varchar(255),
	"username" varchar(255),
	"first_name" varchar(255),
	"last_name" varchar(255),
	"default_slippage" integer DEFAULT 50,
	"notifications_enabled" boolean DEFAULT true,
	"gas_mode" varchar(10) DEFAULT 'auto',
	"language_preference" text DEFAULT 'en',
	"tos_accepted" boolean DEFAULT false,
	"tos_accepted_at" timestamp,
	"referred_by_user_id" integer,
	"total_referral_rewards" real DEFAULT 0,
	"referral_count" integer DEFAULT 0,
	"two_fa_enabled" boolean DEFAULT false,
	"totp_secret" varchar(64),
	"two_fa_threshold" integer DEFAULT 1000,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_active_at" timestamp DEFAULT now(),
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_whatsapp_id_unique" UNIQUE("whatsapp_id")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) DEFAULT 'Default Wallet',
	"address" varchar(255) NOT NULL,
	"encrypted_private_key" text,
	"encryption_scheme" varchar(50) DEFAULT 'legacy_fernet_v1',
	"kms_wrapped_dek" text,
	"aesgcm_nonce" varchar(32),
	"kms_key_id" varchar(255),
	"key_version" integer DEFAULT 1,
	"wallet_provider" varchar(20) DEFAULT 'local',
	"turnkey_sub_org_id" varchar(100),
	"turnkey_wallet_id" varchar(100),
	"turnkey_account_id" varchar(100),
	"chain_type" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"payload" text NOT NULL,
	"callback_url" varchar(1024) NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"attempts" integer DEFAULT 0,
	"next_retry_at" timestamp,
	"last_error" text,
	"response_status" integer,
	"created_at" timestamp DEFAULT now(),
	"delivered_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "copy_follows" ADD CONSTRAINT "copy_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_follows" ADD CONSTRAINT "copy_follows_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_profiles" ADD CONSTRAINT "trader_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_trades" ADD CONSTRAINT "trader_trades_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dca_executions" ADD CONSTRAINT "dca_executions_dca_order_id_dca_orders_id_fk" FOREIGN KEY ("dca_order_id") REFERENCES "public"."dca_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dca_orders" ADD CONSTRAINT "dca_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_orders" ADD CONSTRAINT "limit_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_redemptions" ADD CONSTRAINT "point_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_redemptions" ADD CONSTRAINT "point_redemptions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_swap_id_swap_transactions_id_fk" FOREIGN KEY ("swap_id") REFERENCES "public"."swap_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_milestones" ADD CONSTRAINT "user_milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_milestones" ADD CONSTRAINT "user_milestones_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_points" ADD CONSTRAINT "user_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_orders" ADD CONSTRAINT "redemption_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_orders" ADD CONSTRAINT "redemption_orders_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_points" ADD CONSTRAINT "season_points_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_points" ADD CONSTRAINT "season_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_snapshots" ADD CONSTRAINT "season_snapshots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_snapshots" ADD CONSTRAINT "season_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD CONSTRAINT "swap_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epoch_rewards" ADD CONSTRAINT "epoch_rewards_epoch_id_distribution_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."distribution_epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epoch_rewards" ADD CONSTRAINT "epoch_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staking_positions" ADD CONSTRAINT "staking_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_claims" ADD CONSTRAINT "token_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_stats" ADD CONSTRAINT "trader_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_agents_is_active" ON "agents" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "copy_follows_follower_id_idx" ON "copy_follows" USING btree ("follower_id");--> statement-breakpoint
CREATE INDEX "copy_follows_trader_id_idx" ON "copy_follows" USING btree ("trader_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_copy_follows_unique" ON "copy_follows" USING btree ("follower_id","trader_id");--> statement-breakpoint
CREATE INDEX "ix_copy_follows_trader_active" ON "copy_follows" USING btree ("trader_id","is_active");--> statement-breakpoint
CREATE INDEX "ix_copy_trades_copier_status" ON "copy_trades" USING btree ("copier_id","status");--> statement-breakpoint
CREATE INDEX "ix_copy_trades_original" ON "copy_trades" USING btree ("original_swap_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_profiles_user_id_idx" ON "trader_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trader_profiles_public_idx" ON "trader_profiles" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "ix_trader_trades_trader_date" ON "trader_trades" USING btree ("trader_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_quest" ON "user_quests" USING btree ("user_id","quest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_oauth_provider_user" ON "oauth_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "ix_agent_credit_topups_agent_id" ON "agent_credit_topups" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ix_agent_subscriptions_agent_id" ON "agent_subscriptions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ix_recurring_subscriptions_due" ON "recurring_subscriptions" USING btree ("status","next_charge_at");--> statement-breakpoint
CREATE INDEX "point_redemptions_user_id_idx" ON "point_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "point_transactions_user_id_idx" ON "point_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "point_transactions_created_at_idx" ON "point_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "point_transactions_user_action_idx" ON "point_transactions" USING btree ("user_id","action");--> statement-breakpoint
CREATE INDEX "user_milestones_user_id_idx" ON "user_milestones" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_milestones_user_milestone_idx" ON "user_milestones" USING btree ("user_id","milestone_id");--> statement-breakpoint
CREATE INDEX "user_points_user_id_idx" ON "user_points" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_redemption_orders_user_id" ON "redemption_orders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_redemption_orders_idem" ON "redemption_orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_season_points_season_user" ON "season_points" USING btree ("season_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_season_snapshots_season_user" ON "season_snapshots" USING btree ("season_id","user_id");--> statement-breakpoint
CREATE INDEX "season_snapshots_season_id_idx" ON "season_snapshots" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "season_snapshots_user_id_idx" ON "season_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_swap_transactions_user_id" ON "swap_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_swap_transactions_user_id_created_at" ON "swap_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_swap_transactions_idempotency_key" ON "swap_transactions" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_token_position" ON "token_positions" USING btree ("user_id","chain","token_address");--> statement-breakpoint
CREATE INDEX "ix_epoch_rewards_epoch_id" ON "epoch_rewards" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "ix_epoch_rewards_user_id" ON "epoch_rewards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_token_claims_user_id" ON "token_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_token_claims_status" ON "token_claims" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_stats_user_id_idx" ON "trader_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trader_stats_public_idx" ON "trader_stats" USING btree ("is_public");