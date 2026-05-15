import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const apiKey = process.env.BROWSERBASE_API_KEY
const projectId = process.env.BROWSERBASE_PROJECT_ID
const terminalUrl = process.env.QA_TERMINAL_URL || 'https://terminal.suwappu.bot'
const apiUrl = process.env.QA_API_URL || 'https://api.suwappu.bot'
const outDir = path.resolve(process.env.QA_OUTPUT_DIR || 'qa-screenshots/browserbase-feature-sweep-prod')

if (!apiKey) throw new Error('BROWSERBASE_API_KEY is required')
if (!projectId) throw new Error('BROWSERBASE_PROJECT_ID is required')

mkdirSync(outDir, { recursive: true })

async function createBrowserbaseSession() {
  const response = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bb-api-key': apiKey,
    },
    body: JSON.stringify({
      projectId,
      browserSettings: {
        viewport: { width: 1440, height: 900 },
      },
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Browserbase session create failed: ${response.status} ${JSON.stringify(body)}`)
  }
  const connectUrl = body.connectUrl || body.connect_url
  if (!connectUrl) throw new Error(`Browserbase response did not include connectUrl: ${JSON.stringify(body)}`)
  return { ...body, connectUrl }
}

async function signIn(page, context) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  await page.locator('button[title="Create a Turnkey passkey wallet"]').click({ timeout: 30000 })
  await page.waitForFunction(
    () => window.localStorage.getItem('suwappu_terminal_token'),
    null,
    { timeout: 60000 },
  )
}

async function clickBottomTab(page, label) {
  await page.getByTestId('bottom-tabs').getByRole('button', { name: label, exact: true }).click({ timeout: 30000 })
  await page.waitForTimeout(900)
}

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

const session = await createBrowserbaseSession()
const browser = await chromium.connectOverCDP(session.connectUrl)
const context = browser.contexts()[0] || await browser.newContext()
const page = context.pages()[0] || await context.newPage()

const apiResponses = []
const failures = []
const consoleErrors = []

page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) {
    consoleErrors.push({ type: message.type(), text: message.text() })
  }
})

page.on('response', (response) => {
  const url = response.url()
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    failures.push(`local request leaked: ${url}`)
  }
  if (url.startsWith(apiUrl)) {
    apiResponses.push({ url, status: response.status() })
    if ([401, 404, 500, 502, 503].includes(response.status())) {
      failures.push(`bad API response ${response.status()}: ${url}`)
    }
  }
})

const tabs = [
  'Portfolio',
  'Discovery',
  'Watchlist',
  'Copy Trading',
  'Wallet Tracker',
  'Tweets',
  'DeFi Center',
  'AI Co-Pilot',
]

const tabResults = []

try {
  await page.goto(terminalUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await signIn(page, context)

  await page.waitForFunction(
    () => !document.body.innerText.includes('Chart provider is not connected yet.'),
    null,
    { timeout: 30000 },
  ).catch(() => failures.push('chart still shows provider-not-connected state'))
  await page.waitForFunction(
    () => !document.body.innerText.includes('Order book provider is not connected yet.'),
    null,
    { timeout: 30000 },
  ).catch(() => failures.push('order book still shows provider-not-connected state'))
  await page.waitForFunction(
    () => !document.body.innerText.includes('Recent trades provider is not connected yet.'),
    null,
    { timeout: 30000 },
  ).catch(() => failures.push('recent trades still shows provider-not-connected state'))

  await screenshot(page, '00-authenticated-chart')

  for (const tab of tabs) {
    await clickBottomTab(page, tab)
    const bodyText = await page.locator('body').innerText({ timeout: 30000 })
    const file = await screenshot(page, `tab-${tab.toLowerCase().replaceAll(' ', '-')}`)
    tabResults.push({
      tab,
      screenshot: file,
      hasContent: bodyText.trim().length > 0,
      visibleTextSample: bodyText.split('\n').slice(-12).join(' | '),
    })

    if (tab === 'Copy Trading') {
      for (const subTab of ['Top Traders', 'Following', 'Copy Feed']) {
        await page.getByRole('button', { name: subTab, exact: true }).click({ timeout: 30000 })
        await page.waitForTimeout(700)
        tabResults.push({
          tab: `Copy Trading / ${subTab}`,
          screenshot: await screenshot(page, `tab-copy-trading-${subTab.toLowerCase().replaceAll(' ', '-')}`),
          visibleTextSample: (await page.locator('body').innerText()).split('\n').slice(-12).join(' | '),
        })
      }
    }

    if (tab === 'Wallet Tracker') {
      const qaAddress = '0x0000000000000000000000000000000000000293'
      const qaLabel = `BB Wallet ${Date.now()}`
      await page.getByTestId('wallet-address-input').fill(qaAddress)
      await page.getByTestId('wallet-label-input').fill(qaLabel)
      await page.getByTestId('add-wallet-btn').click()
      await page.getByText(qaLabel, { exact: true }).waitFor({ state: 'visible', timeout: 30000 })
      tabResults.push({
        tab: 'Wallet Tracker / Add persisted wallet',
        screenshot: await screenshot(page, 'tab-wallet-tracker-add-wallet'),
        visibleTextSample: (await page.locator('body').innerText()).split('\n').slice(-12).join(' | '),
      })

      await page.getByText(qaLabel, { exact: true }).click()
      await page.getByTestId('wallet-profile').waitFor({ state: 'visible', timeout: 30000 })
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      await page.getByText(qaLabel, { exact: true }).waitFor({ state: 'hidden', timeout: 30000 })
      tabResults.push({
        tab: 'Wallet Tracker / Remove persisted wallet',
        screenshot: await screenshot(page, 'tab-wallet-tracker-remove-wallet'),
        visibleTextSample: (await page.locator('body').innerText()).split('\n').slice(-12).join(' | '),
      })
    }

    if (tab === 'Tweets') {
      const qaHandle = `bbtweet${Date.now().toString().slice(-8)}`
      await page.getByTestId('add-account-btn').click({ timeout: 30000 })
      await page.getByTestId('add-account-modal').waitFor({ state: 'visible', timeout: 30000 })
      await page.getByTestId('account-input').fill(qaHandle)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByText(`@${qaHandle}`, { exact: true }).waitFor({ state: 'visible', timeout: 30000 })
      tabResults.push({
        tab: 'Tweets / Add persisted account',
        screenshot: await screenshot(page, 'tab-tweets-add-account'),
        visibleTextSample: (await page.locator('body').innerText()).split('\n').slice(-12).join(' | '),
      })

      await page.getByTestId('tracked-account')
        .filter({ hasText: `@${qaHandle}` })
        .getByTestId('remove-account')
        .click()
      await page.getByText(`@${qaHandle}`, { exact: true }).waitFor({ state: 'hidden', timeout: 30000 })
      await page.keyboard.press('Escape')
      tabResults.push({
        tab: 'Tweets / Remove persisted account',
        screenshot: await screenshot(page, 'tab-tweets-remove-account'),
        visibleTextSample: (await page.locator('body').innerText()).split('\n').slice(-12).join(' | '),
      })
    }
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify({
  terminalUrl,
  apiUrl,
  browserbase: {
    sessionId: session.id,
    dashboardUrl: `https://www.browserbase.com/sessions/${session.id}`,
  },
  outDir,
  tabs: tabResults,
  apiResponses,
  consoleErrors: consoleErrors.slice(0, 20),
  failures,
}, null, 2))

if (failures.length) process.exit(1)
