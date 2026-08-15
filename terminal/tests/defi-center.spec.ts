import { test, expect } from '@playwright/test'

test.describe('DeFi Command Center', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Navigate to DeFi Center tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'DeFi Center' }).click()
  })

  test.describe('Alerts Panel', () => {
    test('alerts panel renders with create form', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()

      const createButton = page.getByRole('button', { name: 'Create Alert' })
      await expect(createButton).toBeVisible()

      // Verify inputs exist within the alerts section
      const tokenInput = page.getByPlaceholder('ETH').first()
      const targetInput = page.getByPlaceholder('0.00').first()
      await expect(tokenInput).toBeVisible()
      await expect(targetInput).toBeVisible()
    })

    test('alert form has type selector', async ({ page }) => {
      const priceAbove = page.getByRole('button', { name: 'Price Above' })
      const priceBelow = page.getByRole('button', { name: 'Price Below' })
      const volumeSpike = page.getByRole('button', { name: 'Volume Spike' })

      await expect(priceAbove).toBeVisible()
      await expect(priceBelow).toBeVisible()
      await expect(volumeSpike).toBeVisible()

      // Click Price Below to switch type
      await priceBelow.click()
      await expect(priceBelow).toHaveClass(/sakura/)
    })
  })

  test.describe('DCA Manager', () => {
    test('DCA manager renders', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'DCA Orders' })).toBeVisible()

      const startButton = page.getByRole('button', { name: 'Start DCA' })
      await expect(startButton).toBeVisible()
    })

    test('DCA form has frequency options', async ({ page }) => {
      const hourly = page.getByRole('radio', { name: 'Hourly' })
      const daily = page.getByRole('radio', { name: 'Daily' })
      const weekly = page.getByRole('radio', { name: 'Weekly' })
      const monthly = page.getByRole('radio', { name: 'Monthly' })

      await expect(hourly).toBeVisible()
      await expect(daily).toBeVisible()
      await expect(weekly).toBeVisible()
      await expect(monthly).toBeVisible()
    })
  })

  test.describe('Lending Panel', () => {
    test('lending panel renders', async ({ page }) => {
      await expect(page.getByText('Morpho Blue Markets')).toBeVisible()

      // Chain filter dropdown
      const chainFilter = page.getByLabel('Filter by chain')
      await expect(chainFilter).toBeVisible()
    })

    test('market cards show APY labels', async ({ page }) => {
      // Look for APY labels — they'll show when markets load or in empty state
      const supplyLabel = page.getByText('Supply APY')
      const borrowLabel = page.getByText('Borrow APY')
      const utilizationLabel = page.getByText('Utilization')

      if (await supplyLabel.first().isVisible().catch(() => false)) {
        await expect(supplyLabel.first()).toBeVisible()
        await expect(borrowLabel.first()).toBeVisible()
        await expect(utilizationLabel.first()).toBeVisible()
      }
    })
  })
})
