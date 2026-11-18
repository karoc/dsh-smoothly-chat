#!/usr/bin/env node
/**
 * Live GUI check for the Smoothly Chat panel.
 *
 * Verifies against the running DSH web instance (never starts a server):
 *  - the plugin set loads without a failed/stuck entry banner;
 *  - the left sidebar shows the Smoothly Chat entry;
 *  - clicking it renders the mailbox panel (`[data-dsc-root]`);
 *  - no page error or slot crash is logged on the way.
 *
 * Usage: DSH_WEB_URL='http://127.0.0.1:3080/?token=…' node scripts/verify-gui.mjs
 * (the URL is read from the environment and never printed).
 */

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const url = process.env.DSH_WEB_URL
if (url === undefined || url === '') {
  console.error('DSH_WEB_URL is required')
  process.exit(2)
}

const failures = []
const notes = []
mkdirSync('.verify', { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => { consoleErrors.push(`pageerror: ${error.message}`) })

try {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  notes.push(`navigation status ${String(response?.status() ?? 'none')}`)
  await page.waitForTimeout(4_000)

  const bodyText = await page.locator('body').innerText().catch(() => '')
  if (/Failed to load plugins|entry did not activate|pending \(waiting for service/u.test(bodyText)) {
    failures.push(`plugin load failure banner: ${bodyText.match(/Failed to load plugins[\s\S]{0,200}/u)?.[0] ?? 'unknown'}`)
  }

  // The sidebar row is labelled from our dictionary (Chinese on this machine).
  const entry = page.locator('text=/思磨力讯|Smoothly Chat/u').first()
  const found = await entry.count().catch(() => 0)
  if (found === 0) {
    failures.push('sidebar entry not found (no "思磨力讯" / "Smoothly Chat" text)')
    const sidebar = await page.locator('nav, aside, [class*="sidebar"]').first().innerText().catch(() => '')
    notes.push(`sidebar text: ${sidebar.slice(0, 300)}`)
  } else {
    notes.push('sidebar entry found')
    await entry.click({ timeout: 10_000 }).catch(error => failures.push(`sidebar entry not clickable: ${error.message}`))
    await page.waitForTimeout(1_500)
    const panel = page.locator('[data-dsc-root]')
    const visible = await panel.isVisible().catch(() => false)
    if (!visible) failures.push('mailbox panel [data-dsc-root] did not render')
    else notes.push('mailbox panel rendered')
  }

  const crash = consoleErrors.find(line => /slot entry crashed|Maximum update depth|React #/u.test(line))
  if (crash !== undefined) failures.push(`client crash: ${crash}`)

  await page.screenshot({ path: '.verify/gui-panel.png', fullPage: false }).catch(() => {})
} finally {
  await browser.close()
}

for (const note of notes) console.log(`  ok   ${note}`)
for (const failure of failures) console.log(`  FAIL ${failure}`)
if (consoleErrors.length > 0) console.log(`  console errors: ${String(consoleErrors.length)}\n    ${consoleErrors.slice(0, 6).join('\n    ')}`)
console.log(failures.length === 0 ? 'gui check passed' : `${String(failures.length)} gui check(s) failed`)
if (failures.length > 0) process.exitCode = 1
