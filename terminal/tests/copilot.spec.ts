import { test, expect } from '@playwright/test'

test.describe('AI Co-Pilot Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Navigate to AI Co-Pilot tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'AI Co-Pilot' }).click()
  })

  test('panel renders with header', async ({ page }) => {
    const panel = page.getByTestId('copilot-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('AI Co-Pilot', { exact: true })).toBeVisible()
  })

  test('has input field', async ({ page }) => {
    const input = page.getByTestId('copilot-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', 'Ask the co-pilot...')
  })

  test('has send button', async ({ page }) => {
    const sendBtn = page.getByTestId('copilot-send')
    await expect(sendBtn).toBeVisible()
  })

  test('shows suggested commands', async ({ page }) => {
    const suggestions = page.getByTestId('suggested-commands')
    await expect(suggestions).toBeVisible()
    await expect(page.getByRole('button', { name: 'Swap ETH to USDC' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show my portfolio' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Price of SOL' })).toBeVisible()
  })

  test('can type in input', async ({ page }) => {
    const input = page.getByTestId('copilot-input')
    await input.fill('Swap 1 ETH to USDC')
    await expect(input).toHaveValue('Swap 1 ETH to USDC')
  })

  test('welcome message visible', async ({ page }) => {
    await expect(
      page.getByText('Welcome to the AI Co-Pilot', { exact: false })
    ).toBeVisible()
  })
})
