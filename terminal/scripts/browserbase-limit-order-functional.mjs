import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const apiKey = process.env.BROWSERBASE_API_KEY
const projectId = process.env.BROWSERBASE_PROJECT_ID
const terminalUrl = process.env.QA_TERMINAL_URL || 'https://terminal.suwappu.bot'
const apiUrl = process.env.QA_API_URL || 'https://api.suwappu.bot'
const outDir = path.resolve(process.env.QA_OUTPUT_DIR || 'qa-screenshots/browserbase-limit-order-prod')

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

let createPayload = null
let cancelStatus = null

try {
  await page.goto(terminalUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await signIn(page, context)

  await page.getByRole('button', { name: 'Limit', exact: true }).click({ timeout: 30000 })
  await page.getByTestId('limit-order-panel').waitFor({ state: 'visible', timeout: 30000 })
  await screenshot(page, '01-limit-panel')

  const panel = page.getByTestId('limit-order-panel')
  await panel.locator('input').first().fill('5')
  await panel.getByRole('button', { name: '-20%', exact: true }).click({ timeout: 30000 })
  await page.waitForFunction(
    () => {
      const input = document.querySelector('[data-testid="limit-target-price"]')
      return input && input.value && Number(input.value) > 0
    },
    null,
    { timeout: 30000 },
  )

  const createResponsePromise = page.waitForResponse(
    response => response.url() === `${apiUrl}/webapp/limit-orders` && response.request().method() === 'POST',
    { timeout: 30000 },
  )
  await page.getByTestId('create-limit-order').click({ timeout: 30000 })
  const createResponse = await createResponsePromise
  createPayload = await createResponse.json()
  if (createResponse.status() !== 200) {
    failures.push(`/webapp/limit-orders create failed: ${createResponse.status()} ${JSON.stringify(createPayload)}`)
  }

  await page.getByTestId('active-limit-orders').waitFor({ state: 'visible', timeout: 30000 })
  await screenshot(page, '02-limit-order-created')

  page.once('dialog', dialog => dialog.accept())
  const cancelResponsePromise = page.waitForResponse(
    response => response.url() === `${apiUrl}/webapp/limit-orders/${createPayload.id}/cancel` && response.request().method() === 'POST',
    { timeout: 30000 },
  )
  await page.getByTestId('active-limit-orders').getByRole('button', { name: 'Cancel', exact: true }).first().click()
  const cancelResponse = await cancelResponsePromise
  cancelStatus = cancelResponse.status()
  if (cancelStatus !== 200) {
    failures.push(`/webapp/limit-orders cancel failed: ${cancelStatus}`)
  }
  await screenshot(page, '03-limit-order-cancelled')
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
  createPayload,
  cancelStatus,
  apiResponses,
  failures,
}, null, 2))

if (failures.length) process.exit(1)
