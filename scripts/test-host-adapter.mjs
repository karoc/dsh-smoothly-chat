#!/usr/bin/env node
/**
 * Host-adapter test: loads the *built* `lib/index.js` with a structural fake
 * Cordis context (no DSH process) and drives it the way the loader would.
 *
 * This is the test the static gate cannot be: it proves the shipped host entry
 * actually imports, registers the API route on the host web server, boots the
 * peer listener from the environment, answers `/state`, and shuts both down
 * through its disposal effect.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'dsc-adapter-'))
const failures = []
let passed = 0

async function scenario(name, body) {
  try {
    await body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`  FAIL ${name}`)
    console.error(String(error?.stack ?? error).split('\n').slice(0, 6).map(line => `       ${line}`).join('\n'))
  }
}

/** Pick a free TCP port. */
async function freePort() {
  const probe = createServer()
  const port = await new Promise((resolve) => {
    probe.listen(0, '127.0.0.1', () => { resolve(probe.address().port) })
  })
  await new Promise(resolve => { probe.close(resolve) })
  return port
}

/** Minimal structural stand-in for the client Cordis context. */
function makeContext() {
  const routes = []
  const disposers = []
  const webServer = { register(route) { routes.push(route); return () => {} } }
  const scope = {
    get: name => name === 'webServer' ? webServer : undefined,
    effect: (factory) => { disposers.push(factory()); return () => {} },
  }
  const ctx = {
    inject: (_services, callback) => { callback(scope) },
    effect: (factory) => { const dispose = factory(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} },
    get: name => name === 'webServer' ? webServer : undefined,
  }
  return { ctx, routes, disposers }
}

await scenario('the built host entry loads, registers and serves, then disposes', async () => {
  const peerPort = await freePort()
  const apiPort = await freePort()
  process.env.DSH_SMOOTHLY_CHAT_DIR = join(root, 'mailbox')
  process.env.DSH_SMOOTHLY_CHAT_PORT = String(peerPort)
  process.env.DSH_SMOOTHLY_CHAT_BIND = '127.0.0.1'
  process.env.DSH_SMOOTHLY_CHAT_NAME = 'adapter-test'

  const module = await import('../lib/index.js')
  assert.equal(module.name, 'dsh-smoothly-chat')
  assert.deepEqual(module.inject, ['webServer'])
  assert.equal(typeof module.apply, 'function')

  const { ctx, routes, disposers } = makeContext()
  module.apply(ctx)

  assert.equal(routes.length, 1, 'exactly one route is registered')
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/smoothly-chat/api')

  const api = createServer((req, res) => { routes[0].handler(req, res) })
  await new Promise(resolve => { api.listen(apiPort, '127.0.0.1', resolve) })

  const deadline = Date.now() + 15_000
  let state
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/smoothly-chat/api/state`)
      if (response.ok) { state = await response.json(); break }
    } catch {
      // The boot promise is still settling.
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(state, '/state never became ready')
  assert.equal(state.ok, true)
  assert.equal(state.self.name, 'adapter-test')
  assert.equal(state.self.port, peerPort, 'the mailbox uses the configured peer port')
  assert.equal(state.serverError, null)

  // The peer listener is a different port and answers its own protocol.
  const hello = await fetch(`http://127.0.0.1:${peerPort}/peer/v1/hello`)
  assert.equal(hello.status, 401, 'an unsigned hello is refused')

  for (const dispose of disposers.reverse()) {
    if (typeof dispose === 'function') await dispose()
  }
  await new Promise(resolve => { api.close(resolve) })

  const gone = await fetch(`http://127.0.0.1:${peerPort}/peer/v1/hello`).then(() => false).catch(() => true)
  assert.equal(gone, true, 'the lifecycle effect closes the peer listener')
})

await rm(root, { recursive: true, force: true })
console.log('')
console.log(`adapter scenarios: ${String(passed)} passed, ${String(failures.length)} failed`)
if (failures.length > 0) process.exitCode = 1
