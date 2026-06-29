import Anthropic from '@anthropic-ai/sdk'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'
import {
	DEFAULT_LLM_MODEL,
	getLlmModel,
	type LlmModelEntry,
	resolveApiKey,
	SUPPORTED_LLM_MODELS,
} from '../config/llmModels'
import { ExternalServiceError, ValidationError } from '../errors'
import { logger } from '../lib/logger'

// Default completion length when the caller omits max_tokens. Anthropic's API
// requires max_tokens; OpenAI-compatible providers treat it as optional but we
// pass a sane default for cost predictability.
const DEFAULT_MAX_TOKENS = 4096

/**
 * OpenAI-compatible chat message. `role` covers the common set; content is a
 * plain string (v1 does not implement multi-part / tool message content).
 */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant'
	content: string
}

/** Request params for a single chat completion. */
export interface ChatCompletionParams {
	model: string
	messages: ChatMessage[]
	max_tokens?: number
	temperature?: number
	/** Accepted for forward-compat; v1 is non-streaming only (see TODO below). */
	stream?: boolean
}

/**
 * OpenAI-compatible chat completion response. Anthropic-native responses are
 * mapped into this shape so callers see one uniform contract regardless of which
 * provider served the request.
 */
export interface ChatCompletionResponse {
	id: string
	object: 'chat.completion'
	created: number
	model: string
	choices: Array<{
		index: number
		message: { role: 'assistant'; content: string }
		finish_reason: string | null
	}>
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
	/** Provider that actually served the call (Suwappu extension field). */
	provider: string
}

export interface LlmServiceInterface {
	/**
	 * Route a chat completion to the provider that owns `params.model` and return
	 * an OpenAI-compatible response. Fails with ValidationError for an unknown
	 * model or an unconfigured provider, and ExternalServiceError if the upstream
	 * provider call fails.
	 */
	readonly chatCompletion: (
		params: ChatCompletionParams,
	) => Effect.Effect<ChatCompletionResponse, ValidationError | ExternalServiceError, EnvService>
}

export class LlmService extends Context.Tag('LlmService')<LlmService, LlmServiceInterface>() {}

// --- Anthropic-native path -------------------------------------------------

/**
 * Call an Anthropic model via the official SDK and map the result to the
 * OpenAI-compatible response shape. `model` is passed through exactly as given.
 */
function anthropicCompletion(
	apiKey: string,
	entry: LlmModelEntry,
	params: ChatCompletionParams,
): Effect.Effect<ChatCompletionResponse, ExternalServiceError> {
	return Effect.tryPromise({
		try: async () => {
			const client = new Anthropic({ apiKey, baseURL: entry.baseUrl })

			// Anthropic takes the system prompt as a top-level field, not a message.
			const systemPrompt = params.messages
				.filter((m) => m.role === 'system')
				.map((m) => m.content)
				.join('\n\n')
			const turns = params.messages
				.filter((m) => m.role === 'user' || m.role === 'assistant')
				.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

			const res = await client.messages.create({
				model: params.model,
				max_tokens: params.max_tokens ?? DEFAULT_MAX_TOKENS,
				...(systemPrompt ? { system: systemPrompt } : {}),
				...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
				messages: turns,
			})

			// Flatten text blocks into a single string (v1 ignores non-text blocks).
			const text = res.content
				.filter((b): b is Anthropic.TextBlock => b.type === 'text')
				.map((b) => b.text)
				.join('')

			const promptTokens = res.usage.input_tokens
			const completionTokens = res.usage.output_tokens

			return {
				id: res.id,
				object: 'chat.completion' as const,
				created: Math.floor(Date.now() / 1000),
				model: res.model,
				choices: [
					{
						index: 0,
						message: { role: 'assistant' as const, content: text },
						finish_reason: res.stop_reason ?? null,
					},
				],
				usage: {
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					total_tokens: promptTokens + completionTokens,
				},
				provider: entry.provider,
			}
		},
		catch: (e) =>
			new ExternalServiceError({
				message: `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
				service: entry.provider,
				cause: e,
			}),
	})
}

// --- OpenAI-compatible path ------------------------------------------------

/**
 * Call an OpenAI-compatible provider (OpenAI, DeepSeek, Qwen, MiniMax) via a
 * single POST to `${baseUrl}/chat/completions`. The provider already returns the
 * OpenAI response shape, so it is passed through with only the `provider` field
 * attached.
 */
function openAiCompatibleCompletion(
	apiKey: string,
	entry: LlmModelEntry,
	params: ChatCompletionParams,
): Effect.Effect<ChatCompletionResponse, ExternalServiceError> {
	return Effect.tryPromise({
		try: async () => {
			const res = await fetch(`${entry.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: params.model,
					messages: params.messages,
					max_tokens: params.max_tokens ?? DEFAULT_MAX_TOKENS,
					...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
					// v1 is non-streaming only. TODO: streaming (SSE passthrough).
					stream: false,
				}),
			})

			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as {
					error?: { message?: string }
				}
				throw new Error(errBody.error?.message || `HTTP ${res.status} ${res.statusText}`)
			}

			// Already OpenAI-shaped — return as-is, just tag the serving provider.
			const json = (await res.json()) as ChatCompletionResponse
			return { ...json, provider: entry.provider }
		},
		catch: (e) =>
			new ExternalServiceError({
				message: `${entry.provider} request failed: ${e instanceof Error ? e.message : String(e)}`,
				service: entry.provider,
				cause: e,
			}),
	})
}

export const LlmServiceLive = Layer.succeed(LlmService, {
	chatCompletion: (params: ChatCompletionParams) =>
		Effect.gen(function* () {
			const model = params.model || DEFAULT_LLM_MODEL

			// Validate the model is registered.
			const entry = getLlmModel(model)
			if (!entry) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Unsupported model: ${model}`,
						fields: { supported_models: SUPPORTED_LLM_MODELS.join(', ') },
					}),
				)
			}

			if (!params.messages || params.messages.length === 0) {
				return yield* Effect.fail(
					new ValidationError({ message: 'messages must be a non-empty array' }),
				)
			}

			// v1 is non-streaming. Accept the flag but never honor it (clean contract
			// vs. silently returning a non-stream when stream:true was requested).
			if (params.stream) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Streaming is not yet supported. Set stream:false or omit it.',
					}),
				)
			}

			// Resolve the provider API key from env; clean 400 if not configured.
			const env = yield* EnvService
			const apiKey = resolveApiKey(env, entry)
			if (!apiKey) {
				return yield* Effect.fail(
					new ValidationError({
						message: `provider ${entry.provider} not configured`,
						fields: { hint: `Set ${entry.envKey} to enable ${model}` },
					}),
				)
			}

			logger.info('[LlmService] chatCompletion model=%s provider=%s', model, entry.provider)

			const normalized: ChatCompletionParams = { ...params, model }

			// Route by wire protocol.
			return yield* entry.mode === 'anthropic-native'
				? anthropicCompletion(apiKey, entry, normalized)
				: openAiCompatibleCompletion(apiKey, entry, normalized)
		}),
})
