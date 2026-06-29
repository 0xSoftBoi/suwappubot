import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import {
	DEFAULT_LLM_MODEL,
	isLlmModelId,
	SUPPORTED_LLM_MODELS,
} from '../config/llmModels'
import type { Agent } from '../db'
import { mapErrorToResponse } from '../errors'
import { agentBearerAuth } from '../middleware'
import { rateLimit } from '../middleware/rateLimit'
import { meteredPayment } from '../middleware/x402Payment'
import { runEffectEither } from '../runtime'
import { type ChatMessage, LlmService } from '../services'
import { formatZodErrors, LlmChatSchema } from './validators'

// Mounted at /v1/agent/llm in app.ts, so this file's paths are relative to that.
type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const llmRoutes = new Hono<AgentContext>()

// Auth → rate limit → metering, in that order (metering must run AFTER auth so
// it can read the agent off the context; see x402Payment.meteredPayment).
llmRoutes.use('/chat', agentBearerAuth())
llmRoutes.use('/chat', rateLimit())
llmRoutes.use('/chat', meteredPayment('llm'))

// GET /v1/agent/llm/models — discovery of supported model ids (auth'd, no charge).
llmRoutes.get('/models', agentBearerAuth(), (c) => {
	return c.json({
		success: true,
		default_model: DEFAULT_LLM_MODEL,
		models: SUPPORTED_LLM_MODELS,
	})
})

// POST /v1/agent/llm/chat — OpenAI-compatible chat completion routed to the
// provider that owns the requested model. Metered at 5 credits per call.
llmRoutes.post('/chat', async (c) => {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = LlmChatSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { model, messages, max_tokens, temperature, stream } = parsed.data

	// Fast pre-flight: reject unknown models with the supported list before doing
	// any work (the service guards this too, but this gives a clean 400 + list).
	if (!isLlmModelId(model)) {
		return c.json(
			{
				success: false,
				error: `Unsupported model: ${model}`,
				supported_models: SUPPORTED_LLM_MODELS,
			},
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const llm = yield* LlmService
			return yield* llm.chatCompletion({
				model,
				messages: messages as ChatMessage[],
				...(max_tokens !== undefined ? { max_tokens } : {}),
				...(temperature !== undefined ? { temperature } : {}),
				...(stream !== undefined ? { stream } : {}),
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	// OpenAI-shaped response, returned as-is.
	return c.json(result.right)
})

export { llmRoutes }
