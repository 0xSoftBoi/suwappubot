import type { Env } from './EnvService'

/**
 * Multi-provider LLM model registry.
 *
 * Maps a public model id → the provider details needed to route a chat
 * completion: which wire protocol to speak (`anthropic-native` vs the de-facto
 * `openai-compatible` `/chat/completions` shape), the upstream base URL, and the
 * name of the EnvService key that holds that provider's API key.
 *
 * Adding a model is a single object-literal entry — keep this the only place
 * model routing knowledge lives. All env keys are OPTIONAL: a model whose key is
 * unset resolves to a clean "provider not configured" 400 at call time rather
 * than throwing (see LlmService).
 */

/** Wire protocol used to talk to the upstream provider. */
export type LlmMode = 'anthropic-native' | 'openai-compatible'

/** EnvService keys that may hold an LLM provider API key (all optional). */
export type LlmEnvKey =
	| 'ANTHROPIC_API_KEY'
	| 'OPENAI_API_KEY'
	| 'DEEPSEEK_API_KEY'
	| 'QWEN_API_KEY'
	| 'MINIMAX_API_KEY'

export interface LlmModelEntry {
	/** Human-facing provider name, used in error messages. */
	readonly provider: string
	/** Wire protocol to use when calling this model. */
	readonly mode: LlmMode
	/**
	 * Upstream base URL. For openai-compatible providers the request goes to
	 * `${baseUrl}/chat/completions`. For anthropic-native this is informational
	 * (the official SDK manages its own base URL) but kept for parity/overrides.
	 */
	readonly baseUrl: string
	/** EnvService key whose value is the Bearer/API key for this provider. */
	readonly envKey: LlmEnvKey
}

// Anthropic public API base (the official SDK defaults to this; kept explicit
// so the registry is self-documenting and overridable).
const ANTHROPIC_BASE = 'https://api.anthropic.com'
// OpenAI-compatible base URLs.
const OPENAI_BASE = 'https://api.openai.com/v1'
const DEEPSEEK_BASE = 'https://api.deepseek.com'
const QWEN_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
const MINIMAX_BASE = 'https://api.minimax.chat/v1'

/**
 * The model registry. Keys are the exact public model ids callers pass in the
 * request body's `model` field. These Anthropic ids are real, current model
 * names — do NOT append date suffixes.
 */
export const LLM_MODELS = {
	// --- Anthropic (native API) ---
	'claude-opus-4-8': { provider: 'Anthropic', mode: 'anthropic-native', baseUrl: ANTHROPIC_BASE, envKey: 'ANTHROPIC_API_KEY' },
	'claude-sonnet-4-6': { provider: 'Anthropic', mode: 'anthropic-native', baseUrl: ANTHROPIC_BASE, envKey: 'ANTHROPIC_API_KEY' },
	'claude-haiku-4-5': { provider: 'Anthropic', mode: 'anthropic-native', baseUrl: ANTHROPIC_BASE, envKey: 'ANTHROPIC_API_KEY' },

	// --- OpenAI (OpenAI-compatible) ---
	'gpt-5.5': { provider: 'OpenAI', mode: 'openai-compatible', baseUrl: OPENAI_BASE, envKey: 'OPENAI_API_KEY' },
	'gpt-5.4-mini': { provider: 'OpenAI', mode: 'openai-compatible', baseUrl: OPENAI_BASE, envKey: 'OPENAI_API_KEY' },

	// --- DeepSeek (OpenAI-compatible) ---
	'deepseek-v4-flash': { provider: 'DeepSeek', mode: 'openai-compatible', baseUrl: DEEPSEEK_BASE, envKey: 'DEEPSEEK_API_KEY' },
	'deepseek-v4-pro': { provider: 'DeepSeek', mode: 'openai-compatible', baseUrl: DEEPSEEK_BASE, envKey: 'DEEPSEEK_API_KEY' },

	// --- Chinese OpenAI-compatible providers (base-url swaps) ---
	'qwen-plus': { provider: 'Qwen', mode: 'openai-compatible', baseUrl: QWEN_BASE, envKey: 'QWEN_API_KEY' },
	'minimax-text-01': { provider: 'MiniMax', mode: 'openai-compatible', baseUrl: MINIMAX_BASE, envKey: 'MINIMAX_API_KEY' },
} as const satisfies Record<string, LlmModelEntry>

/** Union of all registered model ids. */
export type LlmModelId = keyof typeof LLM_MODELS

/** Default model when a caller omits `model`. */
export const DEFAULT_LLM_MODEL: LlmModelId = 'claude-opus-4-8'

/** Sorted list of supported model ids (for 400 error payloads + discovery). */
export const SUPPORTED_LLM_MODELS: readonly string[] = Object.keys(LLM_MODELS).sort()

/** Type guard: is `model` a registered model id? */
export function isLlmModelId(model: string): model is LlmModelId {
	return Object.prototype.hasOwnProperty.call(LLM_MODELS, model)
}

/** Look up a registry entry by model id (undefined if unknown). */
export function getLlmModel(model: string): LlmModelEntry | undefined {
	return isLlmModelId(model) ? LLM_MODELS[model] : undefined
}

/**
 * Resolve the API key for a model's provider from the decoded env. Returns the
 * key string, or undefined if the provider is not configured (env var unset).
 */
export function resolveApiKey(env: Env, entry: LlmModelEntry): string | undefined {
	return env[entry.envKey]
}
