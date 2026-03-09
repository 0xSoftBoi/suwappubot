import { test, expect } from '@playwright/test'

test.describe('Points Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the points API endpoints so tests render with data
    await page.route('**/webapp/points/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          xp: 3500,
          level: 8,
          tier: 'Silver',
          nextLevelXp: 5000,
          currentLevelXp: 3000,
          streak: 5,
          longestStreak: 12,
          lastCheckin: null,
          rank: 42,
        }),
      })
    )

    await page.route('**/webapp/points/milestones', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          milestones: [
            { id: 'm1', title: 'First Swap', description: 'Complete your first swap', icon: '\u21C4', category: 'trading', progress: 1, target: 1, completed: true, xpReward: 50 },
            { id: 'm2', title: 'Swap Master', description: 'Complete 10 swaps', icon: '\u26A1', category: 'trading', progress: 7, target: 10, completed: false, xpReward: 200 },
            { id: 'm3', title: 'Chain Hopper', description: 'Swap on 3 chains', icon: '\u26D3', category: 'trading', progress: 2, target: 3, completed: false, xpReward: 150 },
          ],
        }),
      })
    )

    await page.route('**/webapp/points/rewards', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rewards: [
            { id: 'r1', name: 'Fee Discount 10%', description: '10% off fees', cost: 500, stock: 100, category: 'discount' },
            { id: 'r2', name: 'Custom Username', description: 'Set a custom name', cost: 2000, stock: 999, category: 'cosmetic' },
          ],
          userXp: 3500,
        }),
      })
    )

    await page.route('**/webapp/points/leaderboard**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [
            { rank: 1, address: '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12', xp: 125000, level: 42, tier: 'Diamond' },
            { rank: 2, address: '0x2b3c4d5e6f7890abcdef1234567890abcdef1234', xp: 98500, level: 38, tier: 'Platinum' },
            { rank: 3, address: '0x3c4d5e6f7890abcdef1234567890abcdef123456', xp: 87200, level: 35, tier: 'Platinum' },
          ],
        }),
      })
    )

    await page.goto('/points')
  })

  test('renders all four tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Milestones' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rewards' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leaderboard' })).toBeVisible()
  })

  test('overview tab shows XP bar', async ({ page }) => {
    const xpBar = page.getByTestId('xp-bar')
    await expect(xpBar).toBeVisible()
    await expect(xpBar).toContainText('XP')
  })

  test('overview tab shows tier badge', async ({ page }) => {
    const badge = page.getByTestId('tier-badge')
    await expect(badge.first()).toBeVisible()
  })

  test('overview tab shows streak tracker', async ({ page }) => {
    const streak = page.getByTestId('streak-tracker')
    await expect(streak).toBeVisible()
    await expect(streak).toContainText('Current Streak')
    await expect(streak).toContainText('Longest')
  })

  test('milestones tab renders milestone cards', async ({ page }) => {
    await page.getByRole('button', { name: 'Milestones' }).click()

    const cards = page.getByTestId('milestone-card')
    await expect(cards.first()).toBeVisible()
    const count = await cards.count()
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test('rewards tab renders reward cards', async ({ page }) => {
    await page.getByRole('button', { name: 'Rewards' }).click()

    const cards = page.getByTestId('reward-card')
    await expect(cards.first()).toBeVisible()
    const count = await cards.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('leaderboard tab renders rows', async ({ page }) => {
    await page.getByRole('button', { name: 'Leaderboard' }).click()

    const rows = page.getByTestId('leaderboard-row')
    await expect(rows.first()).toBeVisible()
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(3)
  })
})
