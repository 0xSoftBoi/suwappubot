// A small intent window keeps quote/route fetches from firing for every
// intermediate keystroke without retaining the old half-second pause.
// TanStack aborts superseded queries; consuming its
// signal here means a stale request never waits out the delay or keeps fetching.
export const INTENT_DELAY_MS = 120

function abortError(): Error {
  const error = new Error('Intent superseded')
  error.name = 'AbortError'
  return error
}

export function waitForIntent(
  signal?: AbortSignal,
  delayMs = INTENT_DELAY_MS,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  if (delayMs <= 0) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
  })
}
