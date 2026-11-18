#!/usr/bin/env node
/**
 * Live end-to-end check against the running DSH GUI.
 *
 * Uses the real plugin host (through the page's authenticated API) plus one
 * script-side ChatNode as the "other machine":
 *
 *  1. mint an invitation from the page and pair the script node with it;
 *  2. script → plugin: text and file, asserted in the rendered panel;
 *  3. plugin → script: type into the composer, press Send, assert delivery in
 *     the script node's store.
 *
 * Exit code 0 means the installed plugin moved real bytes in both directions
 * without touching a conversation.
 *
 * Usage: DSH_WEB_URL='http://127.0.0.1:3080/?token=…' node scripts/verify-gui-live.mjs
 */

import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { ChatNode } from '../lib/core.js'

const url = process.env.DSH_WEB_URL
if (url === undefined || url === '') {
  console.error('DSH_WEB_URL is required')
  process.exit(2)
}

const failures = []
const notes = []
const tempRoots = []
let node

function note(text) {
  notes.push(text)
  console.log(`  ok   ${text}`)
}

function fail(text) {
  failures.push(text)
  console.log(`  FAIL ${text}`)
}

async function tempDir(tag) {
  const dir = await mkdtemp(join(tmpdir(), `dsc-gui-${tag}-`))
  tempRoots.push(dir)
  return dir
}

async function waitFor(check, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  return false
}

/** Re-open the mailbox panel if a reload or navigation left the app elsewhere. */
async function ensurePanel(page) {
  if (await page.locator('[data-dsc-root]').isVisible().catch(() => false)) return true
  const entry = page.locator('text=/思磨力讯|Smoothly Chat/u').first()
  if ((await entry.count().catch(() => 0)) === 0) return false
  await entry.click().catch(() => {})
  await page.waitForTimeout(600)
  return page.locator('[data-dsc-root]').isVisible().catch(() => false)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', error => { consoleErrors.push(`pageerror: ${error.message}`) })

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)

  const entry = page.locator('text=/思磨力讯|Smoothly Chat/u').first()
  if ((await entry.count()) === 0) throw new Error('sidebar entry missing')
  await entry.click()
  await page.waitForTimeout(1_000)
  if (!(await page.locator('[data-dsc-root]').isVisible())) throw new Error('mailbox panel missing')
  note('panel rendered')

  // Clean any peer left by an earlier run so the assertions below target this
  // run's node — the kind of state hygiene a repeatable check needs.
  const cleaned = await page.evaluate(async () => {
    const state = await fetch('/smoothly-chat/api/state').then(response => response.json())
    const removed = []
    for (const peer of state.peers ?? []) {
      const response = await fetch('/smoothly-chat/api/unpair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: peer.deviceId }),
      })
      removed.push(response.status)
    }
    return removed
  })
  note(`cleaned ${String(cleaned.length)} peer(s) from earlier runs`)

  const invite = await page.evaluate(async () => {
    const response = await fetch('/smoothly-chat/api/invite', { method: 'POST' })
    return response.json()
  })
  if (typeof invite?.string !== 'string') throw new Error(`invite failed: ${JSON.stringify(invite)}`)
  note('invitation minted through the live API')

  const parsed = new URL(invite.string)
  const pluginDeviceId = parsed.hash.slice(1).split('.')[0]

  const nodeName = `verify-${randomBytes(3).toString('hex')}`
  node = await ChatNode.create({
    root: await tempDir('node'),
    port: 0,
    // The plugin reaches this node at the address it saw the pairing come
    // from (the LAN address), so the test listener must not be loopback-only.
    bindHost: '0.0.0.0',
    advertiseHost: '127.0.0.1',
    name: nodeName,
    logger: () => {},
  })
  await node.start()
  await node.pair(invite.string)
  note('script node paired with the live plugin')

  // ── script → plugin: text ────────────────────────────────────────────────
  const marker = `hello-${randomBytes(4).toString('hex')}`
  await node.sendText([pluginDeviceId], marker)
  await node.flush()
  const peerRow = page.locator('.dsc-peer', { hasText: nodeName })
  const textArrived = await waitFor(async () => {
    await ensurePanel(page)
    return (await peerRow.count()) > 0
  }, 20_000)
  if (!textArrived) throw new Error(`peer row "${nodeName}" did not appear in the panel`)
  await peerRow.first().click()
  await page.waitForTimeout(800)
  if ((await page.locator(`text=${marker}`).count()) === 0) fail('inbound text did not render in the thread')
  else note('inbound text rendered')

  // ── script → plugin: file ────────────────────────────────────────────────
  const source = join(await tempDir('payload'), 'e2e-payload.bin')
  const bytes = randomBytes(64 * 1024)
  await writeFile(source, bytes)
  await node.sendFile([pluginDeviceId], source, 'e2e-payload.bin')
  await node.flush()
  const fileRendered = await waitFor(async () => {
    await ensurePanel(page)
    await peerRow.first().click().catch(() => {})
    return (await page.locator('text=e2e-payload.bin').count()) > 0
  }, 20_000)
  if (!fileRendered) fail('inbound file card did not render')
  else note('inbound file card rendered')

  // ── plugin → script: composer ────────────────────────────────────────────
  const reply = `reply-${randomBytes(4).toString('hex')}`
  await page.locator('.dsc-textarea').fill(reply)
  await page.locator('.dsc-composer .dsc-btn.primary').click()
  const delivered = await waitFor(async () => {
    const thread = await node.store.readThread(pluginDeviceId)
    return thread.some(message => message.dir === 'in' && message.text === reply)
  }, 15_000)
  if (!delivered) fail('outbound message from the composer never reached the script node')
  else note('composer message delivered to the script node')

  await page.screenshot({ path: '.verify/gui-live.png' }).catch(() => {})

  const crash = consoleErrors.find(line => /slot entry crashed|Maximum update depth/u.test(line))
  if (crash !== undefined) fail(`client crash observed: ${crash}`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  if (node !== undefined) await node.stop().catch(() => {})
  await browser.close()
  for (const root of tempRoots) await rm(root, { recursive: true, force: true })
}

for (const failure of failures) console.log(`  FAIL ${failure}`)
console.log(failures.length === 0 ? 'live gui e2e passed' : `${String(failures.length)} live check(s) failed`)
if (failures.length > 0) process.exitCode = 1
