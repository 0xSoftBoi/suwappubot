/**
 * Tests for lib/liveActivity.ts — Live Activity state management.
 */
import {
  startSwapActivity,
  updateSwapActivity,
  endSwapActivity,
  getCurrentActivity,
} from '../../lib/liveActivity'

beforeEach(async () => {
  await endSwapActivity()
})

describe('startSwapActivity', () => {
  it('creates an activity with correct data', async () => {
    await startSwapActivity({
      id: 'swap-1',
      fromToken: 'ETH',
      toToken: 'USDC',
      fromAmount: '1.0',
      fromChain: 'ethereum',
      toChain: 'ethereum',
      status: 'pending',
      startedAt: '2026-03-09T00:00:00Z',
    })

    const activity = await getCurrentActivity()
    expect(activity).not.toBeNull()
    expect(activity!.id).toBe('swap-1')
    expect(activity!.fromToken).toBe('ETH')
    expect(activity!.status).toBe('pending')
    expect(activity!.updatedAt).toBeDefined()
  })
})

describe('updateSwapActivity', () => {
  it('updates status and toAmount', async () => {
    await startSwapActivity({
      id: 'swap-2',
      fromToken: 'ETH',
      toToken: 'USDC',
      fromAmount: '1.0',
      fromChain: 'ethereum',
      toChain: 'base',
      status: 'pending',
      startedAt: '2026-03-09T00:00:00Z',
    })

    await updateSwapActivity('bridging')
    let activity = await getCurrentActivity()
    expect(activity!.status).toBe('bridging')

    await updateSwapActivity('completed', '3000.50')
    activity = await getCurrentActivity()
    expect(activity!.status).toBe('completed')
    expect(activity!.toAmount).toBe('3000.50')
  })

  it('does nothing when no active activity', async () => {
    await updateSwapActivity('completed')
    const activity = await getCurrentActivity()
    expect(activity).toBeNull()
  })
})

describe('endSwapActivity', () => {
  it('removes the current activity', async () => {
    await startSwapActivity({
      id: 'swap-3',
      fromToken: 'SOL',
      toToken: 'USDC',
      fromAmount: '10',
      fromChain: 'solana',
      toChain: 'solana',
      status: 'pending',
      startedAt: '2026-03-09T00:00:00Z',
    })

    await endSwapActivity()
    const activity = await getCurrentActivity()
    expect(activity).toBeNull()
  })
})
