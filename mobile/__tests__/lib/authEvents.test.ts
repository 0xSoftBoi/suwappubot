/**
 * Tests for lib/authEvents.ts — typed event emitter.
 */
import { authEvents } from '../../lib/authEvents'

describe('authEvents', () => {
  it('calls listeners on emit', () => {
    const listener = jest.fn()
    authEvents.on('unauthorized', listener)

    authEvents.emit('unauthorized')
    expect(listener).toHaveBeenCalledTimes(1)

    authEvents.off('unauthorized', listener)
  })

  it('removes listeners with off()', () => {
    const listener = jest.fn()
    authEvents.on('unauthorized', listener)
    authEvents.off('unauthorized', listener)

    authEvents.emit('unauthorized')
    expect(listener).not.toHaveBeenCalled()
  })

  it('supports multiple listeners', () => {
    const listener1 = jest.fn()
    const listener2 = jest.fn()

    authEvents.on('unauthorized', listener1)
    authEvents.on('unauthorized', listener2)

    authEvents.emit('unauthorized')
    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)

    authEvents.off('unauthorized', listener1)
    authEvents.off('unauthorized', listener2)
  })
})
