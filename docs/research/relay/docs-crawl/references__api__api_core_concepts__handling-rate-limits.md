# Handling Rate Limits - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/handling-rate-limits

On this page
Optimize your request workflow
Replace polling with webhooks or websockets
Request an elevated rate limit
Core Concepts
Handling Rate Limits
Copy page

Reduce your request volume and request an elevated limit when you reach Relay’s per-key rate limits

Relay enforces rate limits per API key to keep the platform reliable for every integrator. When a request exceeds a limit, Relay rejects it with a 429 response. Use this guide to optimize your request workflow or replace status polling with webhooks or websockets. If you have already tried both, contact support to request an elevated rate limit.
Per-endpoint limits are listed in API keys and Rate Limits. To see which keys and endpoints are reaching their limits, open Observability in the Relay Dashboard.
​
Optimize your request workflow
Most integrations that reach a limit are sending requests they don’t need. This is the fastest change to ship, and it usually resolves the problem without any change to your architecture.
Configuration data is the most common source of unnecessary traffic. Chains, currencies, and similar responses change infrequently, so fetch them once at startup and cache them rather than calling on every user interaction.
Quote traffic is the next place to look. /quote carries the tightest default limit at 50 requests per minute. Debounce amount and token inputs so a user typing an amount produces one call rather than one per keystroke, and collapse identical in-flight requests into a single call whose result is shared across callers.
Validation belongs on the client too. Amounts below Relay’s minimum come back as AMOUNT_TOO_LOW, so a sub-cent value a user types should fail your own check before it turns into a quote call. Where your interface already knows the user’s balance, apply the same treatment to amounts they can’t cover.
If you poll for status, widen the interval and stop polling once a request reaches a terminal status (success, failure, or refund). When you need many records at once, GET /requests/v3 retrieves them in a single filtered call instead of one call per request ID.
If you receive a 429 response, retry the request after an exponential backoff. This will prevent you from hammering the API with requests that will likely fail again.
​
Replace polling with webhooks or websockets
Polling for status is a major source of avoidable request volume. Relay can push status updates to you instead, which removes those calls from your budget entirely and delivers updates faster than any polling interval.
Webhooks POST request.status.updated events to an HTTPS endpoint on your backend as each request changes status. Configure one endpoint per API key in the Relay Dashboard. Use webhooks when you have a server that can receive traffic.
Websockets deliver the same events over an open connection to wss://ws.relay.link, authenticated with your API key. Use websockets when the consumer is a client or a process that can hold a connection open.
Either option eliminates polling for status. Keep a low-frequency reconciliation poll if you want a safety net against missed events, but drive your primary flow from the pushed updates.
​
Request an elevated rate limit
If your workflow is already optimized and you’ve moved off polling, reach out to our support team to request an elevated rate limit. Elevated limits are applied per key. The Elevated Rate Limits table lists what’s available.
Get in touch through the support widget in the Relay Dashboard. Tell us the label of the API key as it appears in the Dashboard rather than the key itself, the endpoints involved, your expected sustained and peak volume in requests per second, and what you’ve already optimized.

Was this page helpful?

Yes
No
Handling Quote Errors
Handling Execution Errors
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform