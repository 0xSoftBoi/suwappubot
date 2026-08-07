import { describe, expect, it } from 'bun:test'
import { INTENT_DELAY_MS, waitForIntent } from './intentDelay'

describe('waitForIntent', () => {
  it('uses the short interaction intent budget', () => {
    expect(INTENT_DELAY_MS).toBe(120)
  })

  it('resolves once a non-aborted intent survives the delay', async () => {
    const controller = new AbortController()
    await expect(waitForIntent(controller.signal, 1)).resolves.toBeUndefined()
  })

  it('rejects a superseded intent with AbortError', async () => {
    const controller = new AbortController()
    const pending = waitForIntent(controller.signal, 10_000)

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects immediately when the query was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(waitForIntent(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
