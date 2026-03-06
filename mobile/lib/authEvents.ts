/**
 * Typed event emitter for auth lifecycle events.
 *
 * Used by the API client to signal 401 responses so AuthContext
 * can clear state and redirect to the login screen.
 */

type AuthEvent = 'unauthorized'
type Listener = () => void

class AuthEventEmitter {
  private listeners = new Map<AuthEvent, Set<Listener>>()

  on(event: AuthEvent, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
  }

  off(event: AuthEvent, listener: Listener): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: AuthEvent): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener()
      } catch {
        // swallow listener errors
      }
    })
  }
}

export const authEvents = new AuthEventEmitter()
