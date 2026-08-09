import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  COINBASE_UI_FLUSH_MS,
  subscribeCoinbase,
  type CoinbaseFeedState,
} from './coinbaseFeed'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  onopen: WebSocket['onopen'] = null
  onmessage: WebSocket['onmessage'] = null
  onerror: WebSocket['onerror'] = null
  onclose: WebSocket['onclose'] = null
  sent: string[] = []
  closed = false

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.({} as Event)
  }

  receive(data: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  disconnect(): void {
    this.onclose?.({} as CloseEvent)
  }
}

const NativeWebSocket = globalThis.WebSocket

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for feed state')
    await wait(10)
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
  globalThis.WebSocket = NativeWebSocket
})

describe('Coinbase feed', () => {
  it('coalesces incremental book/trade bursts into one bounded UI update', async () => {
    expect(COINBASE_UI_FLUSH_MS).toBeGreaterThanOrEqual(50)
    expect(COINBASE_UI_FLUSH_MS).toBeLessThanOrEqual(100)

    const states: CoinbaseFeedState[] = []
    const unsubscribe = subscribeCoinbase('TEST-BATCH-USD', (state) => states.push(state))
    const ws = FakeWebSocket.instances[0]

    try {
      expect(states).toHaveLength(1)
      expect(states[0].status).toBe('connecting')

      ws.receive({
        type: 'snapshot',
        product_id: 'TEST-BATCH-USD',
        bids: [['100', '1'], ['99', '2']],
        asks: [['102', '1'], ['103', '2']],
      })
      expect(states).toHaveLength(2)

      ws.receive({
        type: 'l2update',
        product_id: 'TEST-BATCH-USD',
        changes: [['buy', '101', '3']],
      })
      ws.receive({
        type: 'match',
        product_id: 'TEST-BATCH-USD',
        trade_id: 7,
        price: '101.5',
        size: '0.25',
        side: 'sell',
        time: '2026-08-07T00:00:00.000Z',
      })
      ws.receive({
        type: 'l2update',
        product_id: 'TEST-BATCH-USD',
        changes: [['sell', '102', '0'], ['sell', '101.75', '4']],
      })

      // The three incremental messages mutate the feed immediately but cross
      // into React only once at the bounded flush.
      expect(states).toHaveLength(2)
      await waitUntil(() => states.length === 3)

      expect(states).toHaveLength(3)
      expect(states[2].bids.map((level) => level.price)).toEqual([101, 100, 99])
      expect(states[2].asks.map((level) => level.price)).toEqual([101.75, 103])
      expect(states[2].trades[0]).toMatchObject({
        id: '7',
        price: 101.5,
        size: 0.25,
        side: 'buy',
      })
    } finally {
      unsubscribe()
    }
  })

  it('shares one socket and one cached snapshot across subscribers', () => {
    const firstStates: CoinbaseFeedState[] = []
    const secondStates: CoinbaseFeedState[] = []
    const unsubscribeFirst = subscribeCoinbase('TEST-REF-USD', (state) => firstStates.push(state))
    const ws = FakeWebSocket.instances[0]

    ws.receive({
      type: 'snapshot',
      product_id: 'TEST-REF-USD',
      bids: [['10', '1']],
      asks: [['11', '1']],
    })
    const unsubscribeSecond = subscribeCoinbase('TEST-REF-USD', (state) => secondStates.push(state))

    try {
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(secondStates).toHaveLength(1)
      expect(secondStates[0]).toBe(firstStates[firstStates.length - 1])

      unsubscribeFirst()
      expect(ws.closed).toBe(false)
      unsubscribeSecond()
      expect(ws.closed).toBe(true)
    } catch (error) {
      unsubscribeFirst()
      unsubscribeSecond()
      throw error
    }
  })

  it('reconnects after a disconnect and rebuilds from the fresh snapshot', async () => {
    const states: CoinbaseFeedState[] = []
    const unsubscribe = subscribeCoinbase('TEST-RECONNECT-USD', (state) => states.push(state))
    const firstWs = FakeWebSocket.instances[0]

    try {
      firstWs.receive({
        type: 'snapshot',
        product_id: 'TEST-RECONNECT-USD',
        bids: [['10', '5']],
        asks: [['11', '5']],
      })
      firstWs.disconnect()
      expect(states.at(-1)?.status).toBe('error')

      await waitUntil(() => FakeWebSocket.instances.length === 2)
      expect(FakeWebSocket.instances).toHaveLength(2)
      const secondWs = FakeWebSocket.instances[1]
      secondWs.receive({
        type: 'snapshot',
        product_id: 'TEST-RECONNECT-USD',
        bids: [['20', '2']],
        asks: [['21', '3']],
      })

      expect(states.at(-1)).toMatchObject({
        status: 'live',
        bids: [{ price: 20, size: 2 }],
        asks: [{ price: 21, size: 3 }],
      })
    } finally {
      unsubscribe()
    }
  })
})
