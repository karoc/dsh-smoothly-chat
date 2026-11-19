#!/usr/bin/env node
/**
 * UI API test: mounts `createApiHandler` on throwaway HTTP servers (no DSH) and
 * drives every route the panel uses. This pins the contract the client half is
 * written against — especially the two things that must never regress: the
 * pair key never leaves the host, and the file route serves exactly the bytes
 * that were received.
 */

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatNode, createApiHandler, sha256Hex } from '../lib/core.js'

const roots = []
let passed = 0
const failed = []

async function scenario(name, body) {
  try {
    await body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed.push({ name, error })
    console.error(`  FAIL ${name}`)
    console.error(String(error?.stack ?? error).split('\n').slice(0, 6).map(line => `       ${line}`).join('\n'))
  }
}

async function makeNode(tag) {
  const root = await mkdtemp(join(tmpdir(), `dsc-api-${tag}-`))
  roots.push(root)
  const node = await ChatNode.create({
    root, port: 0, bindHost: '127.0.0.1', advertiseHost: '127.0.0.1', name: tag, logger: () => {},
  })
  await node.start()
  const handler = createApiHandler(node)
  const server = createServer((req, res) => { handler(req, res) })
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  return {
    node,
    port,
    handler,
    async close() {
      handler.dispose()
      await new Promise(resolve => { server.close(resolve) })
      await node.stop()
    },
  }
}

async function call(target, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${target.port}/smoothly-chat/api${path}`, options)
  const text = await response.text()
  const body = text === '' ? undefined : JSON.parse(text)
  return { status: response.status, body, text, response }
}

await scenario('state reports identity, addresses and peers without leaking keys', async () => {
  const a = await makeNode('state-a')
  try {
    const { status, body } = await call(a, '/state')
    assert.equal(status, 200)
    assert.equal(body.self.deviceId, a.node.self.deviceId)
    assert.ok(Array.isArray(body.addresses))
    assert.equal(typeof body.lanReachable, 'boolean')
    assert.equal(body.serverError, null)
    assert.deepEqual(body.peers, [])
  } finally {
    await a.close()
  }
})

await scenario('invite → pair over the API creates a working pair on both sides', async () => {
  const a = await makeNode('pair-a')
  const b = await makeNode('pair-b')
  try {
    const invite = await call(a, '/invite', { method: 'POST' })
    assert.equal(invite.status, 200)
    assert.match(invite.body.string, /^dsh-peer:\/\//u)

    const requested = await call(b, '/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invitation: invite.body.string }),
    })
    assert.equal(requested.status, 200)
    assert.equal(requested.body.peer.pairedAt, undefined, 'a request does not pair by itself')

    const pendingState = await call(a, '/state')
    assert.equal(pendingState.body.requests.length, 1, 'A sees the request')
    assert.equal(pendingState.body.requests[0].deviceId, b.node.self.deviceId)
    assert.equal(pendingState.body.requests[0].key, undefined, 'request rows never carry the key')

    const approved = await call(a, '/requests/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: b.node.self.deviceId }),
    })
    assert.equal(approved.status, 200)
    await b.node.retryPendingPairs()

    const stateA = await call(a, '/state')
    const stateB = await call(b, '/state')
    assert.equal(stateA.body.peers.length, 1)
    assert.equal(stateB.body.peers.length, 1)
    assert.equal(stateA.body.peers[0].key, undefined, 'the pair key must never reach the page')
    assert.equal(stateB.body.peers[0].key, undefined)
  } finally {
    await a.close()
    await b.close()
  }
})

await scenario('send → thread → unread → read works over the API', async () => {
  const a = await makeNode('send-a')
  const b = await makeNode('send-b')
  try {
    const invite = await call(a, '/invite', { method: 'POST' })
    await call(b, '/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invitation: invite.body.string }),
    })
    await call(a, '/requests/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: b.node.self.deviceId }),
    })
    await b.node.retryPendingPairs()
    const sent = await call(a, '/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peerIds: [b.node.self.deviceId], text: 'hello over the api' }),
    })
    assert.equal(sent.status, 200)
    await a.node.flush()

    const thread = await call(b, `/thread?peer=${encodeURIComponent(a.node.self.deviceId)}`)
    assert.equal(thread.status, 200)
    assert.equal(thread.body.messages.at(-1).text, 'hello over the api')
    assert.equal(thread.body.peer.unread, 1)

    const read = await call(b, '/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peerId: a.node.self.deviceId }),
    })
    assert.equal(read.status, 200)
    const after = await call(b, `/thread?peer=${encodeURIComponent(a.node.self.deviceId)}`)
    assert.equal(after.body.peer.unread, 0)
  } finally {
    await a.close()
    await b.close()
  }
})

await scenario('upload delivers the exact bytes and the file route serves them back', async () => {
  const a = await makeNode('upload-a')
  const b = await makeNode('upload-b')
  try {
    const invite = await call(a, '/invite', { method: 'POST' })
    await call(b, '/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invitation: invite.body.string }),
    })
    await call(a, '/requests/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: b.node.self.deviceId }),
    })
    await b.node.retryPendingPairs()
    const bytes = randomBytes(256 * 1024 + 3)
    const uploaded = await call(a, `/upload?peer=${encodeURIComponent(b.node.self.deviceId)}&name=${encodeURIComponent('报告.bin')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
    assert.equal(uploaded.status, 200)
    await a.node.flush()

    const thread = await call(b, `/thread?peer=${encodeURIComponent(a.node.self.deviceId)}`)
    const message = thread.body.messages.at(-1)
    assert.equal(message.kind, 'file')
    assert.equal(message.file.size, bytes.length)
    assert.equal(message.file.name, '报告.bin')

    const download = await fetch(`http://127.0.0.1:${b.port}/smoothly-chat/api/file?peer=${encodeURIComponent(a.node.self.deviceId)}&id=${encodeURIComponent(message.id)}`)
    assert.equal(download.status, 200)
    const served = Buffer.from(await download.arrayBuffer())
    assert.equal(sha256Hex(served), sha256Hex(bytes))
    assert.equal(message.file.sha256, sha256Hex(bytes))
  } finally {
    await a.close()
    await b.close()
  }
})

await scenario('the event stream announces an inbound message', async () => {
  const a = await makeNode('sse-a')
  const b = await makeNode('sse-b')
  try {
    const invite = await call(a, '/invite', { method: 'POST' })
    await call(b, '/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invitation: invite.body.string }),
    })
    await call(a, '/requests/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: b.node.self.deviceId }),
    })
    await b.node.retryPendingPairs()

    const controller = new AbortController()
    const response = await fetch(`http://127.0.0.1:${b.port}/smoothly-chat/api/events`, { signal: controller.signal })
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const readUntil = async (needle) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) return false
        buffer += decoder.decode(value, { stream: true })
        if (buffer.includes(needle)) return true
      }
      return false
    }
    assert.equal(await readUntil('"type":"ready"'), true, 'the stream must open')

    await call(a, '/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ping for the stream' }),
    })
    await a.node.flush()
    assert.equal(await readUntil('"type":"inbox"'), true, 'an inbound message must be announced')
    controller.abort()
  } finally {
    await a.close()
    await b.close()
  }
})

await scenario('unknown routes answer 404 and the retry route accepts', async () => {
  const a = await makeNode('misc-a')
  try {
    assert.equal((await call(a, '/nope')).status, 404)
    const retry = await call(a, '/retry', { method: 'POST' })
    assert.equal(retry.status, 200)
    const settings = await call(a, '/settings')
    assert.equal(settings.status, 200)
    assert.equal(typeof settings.body.settings.name, 'string')
  } finally {
    await a.close()
  }
})

for (const root of roots) await rm(root, { recursive: true, force: true })
console.log('')
console.log(`api scenarios: ${String(passed)} passed, ${String(failed.length)} failed`)
if (failed.length > 0) {
  for (const entry of failed) console.error(`  - ${entry.name}: ${entry.error?.message ?? entry.error}`)
  process.exitCode = 1
}
