#!/usr/bin/env node
/**
 * Dual-instance end-to-end test for DSH Smoothly Chat.
 *
 * Two real ChatNodes (two stores, two HTTP listeners, loopback only) exercise
 * the whole wire protocol without DSH and without a second machine. The
 * scenarios are written as *falsifiable* assertions: each one would fail if
 * the corresponding guarantee were removed (unsigned request accepted, replay
 * accepted, duplicate stored, traversal escaping, offline message lost).
 *
 * Run: `pnpm bundle && node scripts/test-peer-e2e.mjs`
 */

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ChatNode,
  DEVICE_HEADER,
  FILE_NAME_HEADER,
  FILE_SHA_HEADER,
  FILE_SIZE_HEADER,
  NONCE_HEADER,
  PROTO_HEADER,
  SIG_HEADER,
  TS_HEADER,
  originOf,
  sha256Hex,
  signedHeaderSet,
} from '../lib/core.js'

const roots = []
let passed = 0
const failed = []

/** Run one scenario and record its outcome. */
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

/** Fresh data root under the OS temp dir. */
async function freshRoot(tag) {
  const root = await mkdtemp(join(tmpdir(), `dsc-${tag}-`))
  roots.push(root)
  return root
}

/** Create and start one loopback-only node. */
async function makeNode(tag, options = {}) {
  const root = await freshRoot(tag)
  const node = await ChatNode.create({
    root,
    port: 0,
    bindHost: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    name: tag,
    logger: () => {},
    ...options,
  })
  await node.start()
  return node
}

/** Close one node if it is still running. */
async function closeNode(node) {
  if (node !== undefined) await node.stop().catch(() => {})
}

/** Build signed headers for a raw request. */
function sign(deviceId, key, method, pathname, body = '', now = Date.now()) {
  return signedHeaderSet({ deviceId, key, method, pathname, bodySha: sha256Hex(body), now })
}

/** POST JSON to a node's peer server. */
async function post(node, pathname, body, headers) {
  return fetch(`${originOf('127.0.0.1', node.port)}${pathname}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body,
  })
}

// ── scenarios ────────────────────────────────────────────────────────────

await scenario('pairing is mutual and both directions work', async () => {
  const a = await makeNode('pair-a')
  const b = await makeNode('pair-b')
  try {
    const invitation = await a.invite()
    assert.match(invitation.string, /^dsh-peer:\/\//u)
    const paired = await b.pair(invitation.string)
    assert.equal(paired.pairedAt !== undefined, true, 'peer record on B must be confirmed')
    const back = a.store.peer(b.self.deviceId)
    assert.equal(back?.pairedAt !== undefined, true, 'peer record on A must be confirmed')
    assert.equal(back?.key, paired.key, 'both sides share the same per-pair key')
    assert.equal(back?.name, 'pair-b', 'A learns B\'s display name')

    await a.sendText([b.self.deviceId], 'from A')
    await b.sendText([a.self.deviceId], 'from B')
    await a.flush()
    await b.flush()
    const atB = await b.store.readThread(a.self.deviceId)
    const atA = await a.store.readThread(b.self.deviceId)
    assert.equal(atB.at(-1)?.text, 'from A')
    assert.equal(atA.at(-1)?.text, 'from B')
    assert.equal(atB.at(-1)?.dir, 'in')
    assert.equal(atA.at(-1)?.dir, 'in')
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('delivery status and unread counts follow the messages', async () => {
  const a = await makeNode('status-a')
  const b = await makeNode('status-b')
  try {
    await b.pair((await a.invite()).string)
    await a.sendText([b.self.deviceId], 'unread me')
    await a.flush()
    const outbound = (await a.store.readThread(b.self.deviceId)).at(-1)
    assert.equal(outbound?.status, 'sent', 'sender side flips to sent after the peer accepted')
    assert.equal(b.store.unreadCounts()[a.self.deviceId], 1)
    await b.store.markRead(a.self.deviceId)
    assert.equal(b.store.unreadCounts()[a.self.deviceId], 0)
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('a redelivered message id is stored exactly once', async () => {
  const a = await makeNode('dup-a')
  const b = await makeNode('dup-b')
  try {
    await b.pair((await a.invite()).string)
    const body = JSON.stringify({
      v: 1, id: 'fixed-id-1', from: { deviceId: a.self.deviceId, name: 'dup-a' },
      to: { deviceId: b.self.deviceId }, at: Date.now(), kind: 'text', text: 'once',
    })
    const headers = sign(a.self.deviceId, (await a.store.peer(b.self.deviceId)).key, 'POST', '/peer/v1/messages', body)
    const first = await post(b, '/peer/v1/messages', body, headers)
    assert.equal(first.status, 200)
    const second = await post(b, '/peer/v1/messages', body, sign(a.self.deviceId, (await a.store.peer(b.self.deviceId)).key, 'POST', '/peer/v1/messages', body))
    assert.equal(second.status, 200)
    assert.equal((await second.json()).duplicate, true)
    const thread = await b.store.readThread(a.self.deviceId)
    assert.equal(thread.filter(message => message.id === 'fixed-id-1').length, 1)
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('files arrive byte-identical with their digest verified', async () => {
  const a = await makeNode('file-a')
  const b = await makeNode('file-b')
  const source = join(await freshRoot('file-src'), 'payload.bin')
  try {
    const bytes = randomBytes(1024 * 1024 + 17)
    await writeFile(source, bytes)
    await b.pair((await a.invite()).string)
    await a.sendFile([b.self.deviceId], source, 'payload.bin')
    await a.flush()
    const message = (await b.store.readThread(a.self.deviceId)).at(-1)
    assert.equal(message?.kind, 'file')
    assert.equal(message?.file?.size, bytes.length)
    assert.equal(message?.file?.sha256, sha256Hex(bytes))
    const stored = await readFile(join(b.store.fileDir(message.id), 'payload.bin'))
    assert.equal(sha256Hex(stored), sha256Hex(bytes))
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('broadcast is N independent messages sharing one batch id', async () => {
  const a = await makeNode('cast-a')
  const b = await makeNode('cast-b')
  const c = await makeNode('cast-c')
  try {
    await b.pair((await a.invite()).string)
    await c.pair((await a.invite()).string)
    const sent = await a.sendText([b.self.deviceId, c.self.deviceId], 'to both')
    assert.equal(sent.messages.length, 2)
    assert.equal(new Set(sent.messages.map(message => message.id)).size, 2, 'each peer gets its own message id')
    assert.equal(new Set(sent.messages.map(message => message.batchId)).size, 1, 'one batch id groups the send')
    await a.flush()
    assert.equal((await b.store.readThread(a.self.deviceId)).at(-1)?.text, 'to both')
    assert.equal((await c.store.readThread(a.self.deviceId)).at(-1)?.text, 'to both')
  } finally {
    await closeNode(a)
    await closeNode(b)
    await closeNode(c)
  }
})

await scenario('unsigned and wrongly signed requests are rejected', async () => {
  const a = await makeNode('sig-a')
  const b = await makeNode('sig-b')
  try {
    await b.pair((await a.invite()).string)
    const key = (await a.store.peer(b.self.deviceId)).key
    const body = JSON.stringify({
      v: 1, id: 'sig-1', from: { deviceId: a.self.deviceId, name: 'sig-a' },
      to: { deviceId: b.self.deviceId }, at: Date.now(), kind: 'text', text: 'forged',
    })
    const unsigned = await post(b, '/peer/v1/messages', body, { 'content-type': 'application/json' })
    assert.equal(unsigned.status, 401)
    const headers = sign(a.self.deviceId, key, 'POST', '/peer/v1/messages', body)
    const tampered = { ...headers, [SIG_HEADER]: `${headers[SIG_HEADER].slice(0, -2)}xx` }
    const rejected = await post(b, '/peer/v1/messages', body, tampered)
    assert.equal(rejected.status, 401)
    assert.equal((await rejected.json()).error.code, 'bad-signature')
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('a replayed nonce and a stale timestamp are rejected', async () => {
  const a = await makeNode('replay-a')
  const b = await makeNode('replay-b')
  try {
    await b.pair((await a.invite()).string)
    const key = (await a.store.peer(b.self.deviceId)).key
    const body = JSON.stringify({
      v: 1, id: 'replay-1', from: { deviceId: a.self.deviceId, name: 'replay-a' },
      to: { deviceId: b.self.deviceId }, at: Date.now(), kind: 'text', text: 'replay',
    })
    const headers = sign(a.self.deviceId, key, 'POST', '/peer/v1/messages', body)
    assert.equal((await post(b, '/peer/v1/messages', body, headers)).status, 200)
    const replay = await post(b, '/peer/v1/messages', body, headers)
    assert.equal(replay.status, 401)
    assert.equal((await replay.json()).error.code, 'replayed-nonce')

    const staleBody = JSON.stringify({
      v: 1, id: 'stale-1', from: { deviceId: a.self.deviceId, name: 'replay-a' },
      to: { deviceId: b.self.deviceId }, at: Date.now(), kind: 'text', text: 'stale',
    })
    const stale = await post(b, '/peer/v1/messages', staleBody, sign(a.self.deviceId, key, 'POST', '/peer/v1/messages', staleBody, Date.now() - 10 * 60_000))
    assert.equal(stale.status, 401)
    assert.equal((await stale.json()).error.code, 'stale-timestamp')
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('an oversized text body is refused with 413', async () => {
  const a = await makeNode('big-a')
  const b = await makeNode('big-b')
  try {
    await b.pair((await a.invite()).string)
    const key = (await a.store.peer(b.self.deviceId)).key
    const body = JSON.stringify({
      v: 1, id: 'big-1', from: { deviceId: a.self.deviceId, name: 'big-a' },
      to: { deviceId: b.self.deviceId }, at: Date.now(), kind: 'text', text: 'x'.repeat(1024 * 1024 + 64),
    })
    const response = await post(b, '/peer/v1/messages', body, sign(a.self.deviceId, key, 'POST', '/peer/v1/messages', body))
    assert.equal(response.status, 413)
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('a traversal file name cannot escape the message directory', async () => {
  const a = await makeNode('trav-a')
  const b = await makeNode('trav-b')
  try {
    await b.pair((await a.invite()).string)
    const key = (await a.store.peer(b.self.deviceId)).key
    const bytes = Buffer.from('payload')
    const digest = sha256Hex(bytes)
    const headers = signedHeaderSet({ deviceId: a.self.deviceId, key, method: 'POST', pathname: '/peer/v1/files', bodySha: digest })
    const response = await fetch(`${originOf('127.0.0.1', b.port)}/peer/v1/files`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
        'x-dsc-msg-id': 'trav-1',
        [FILE_NAME_HEADER]: encodeURIComponent('../../etc/passwd'),
        [FILE_SIZE_HEADER]: String(bytes.length),
        [FILE_SHA_HEADER]: digest,
      },
      body: bytes,
    })
    assert.equal(response.status, 200)
    const names = await readdir(b.store.fileDir('trav-1'))
    assert.deepEqual(names, ['passwd'], 'only the basename is kept')
    assert.equal(await readFile(join(b.store.fileDir('trav-1'), 'passwd'), 'utf8'), 'payload')
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('an unpaired machine cannot send', async () => {
  const a = await makeNode('nopair-a')
  try {
    const body = JSON.stringify({
      v: 1, id: 'nopair-1', from: { deviceId: 'stranger', name: 'stranger' },
      to: { deviceId: a.self.deviceId }, at: Date.now(), kind: 'text', text: 'hi',
    })
    const headers = sign('stranger', Buffer.alloc(32).toString('base64url'), 'POST', '/peer/v1/messages', body)
    const response = await post(a, '/peer/v1/messages', body, headers)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, 'unknown-device')
  } finally {
    await closeNode(a)
  }
})

await scenario('an offline peer queues the message and receives it on return', async () => {
  const a = await makeNode('off-a')
  const b = await makeNode('off-b')
  const bPort = b.port
  const bRoot = b.store.root
  try {
    await b.pair((await a.invite()).string)
    await b.stop()
    await a.sendText([b.self.deviceId], 'while you were away')
    await a.flush()
    const pending = await a.store.readThread(b.self.deviceId)
    assert.equal(pending.at(-1)?.status, 'pending', 'the outbox keeps the message while the peer is down')
    assert.equal((await a.store.listOutbox()).length, 1)

    const revived = await ChatNode.create({
      root: bRoot, port: bPort, bindHost: '127.0.0.1', advertiseHost: '127.0.0.1', name: 'off-b', logger: () => {},
    })
    await revived.start()
    try {
      await a.flush()
      const delivered = await a.store.readThread(b.self.deviceId)
      assert.equal(delivered.at(-1)?.status, 'sent')
      assert.equal((await revived.store.readThread(a.self.deviceId)).at(-1)?.text, 'while you were away')
    } finally {
      await revived.stop()
    }
  } finally {
    await closeNode(a)
  }
})

await scenario('unpairing removes the pair on both sides', async () => {
  const a = await makeNode('unpair-a')
  const b = await makeNode('unpair-b')
  try {
    await b.pair((await a.invite()).string)
    await a.unpair(b.self.deviceId)
    assert.equal(a.store.peer(b.self.deviceId), undefined)
    assert.equal(b.store.peer(a.self.deviceId), undefined, 'the remote side dropped the pair too')
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

await scenario('a busy port falls through to the next free one', async () => {
  const blocker = createServer()
  const blockedPort = await new Promise((resolve) => {
    blocker.listen(0, '127.0.0.1', () => { resolve(blocker.address().port) })
  })
  const node = await ChatNode.create({
    root: await freshRoot('port'),
    port: blockedPort,
    bindHost: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    name: 'port-node',
    logger: () => {},
  })
  try {
    const bound = await node.start()
    assert.notEqual(bound, blockedPort, 'the occupied port must not be reported as bound')
    assert.ok(bound > blockedPort && bound <= blockedPort + 9, `expected a nearby fallback port, got ${bound}`)
    const state = await fetch(`http://127.0.0.1:${bound}/peer/v1/hello`).then(response => response.status).catch(() => 0)
    assert.equal(state, 401, 'the fallback listener answers (with the usual 401 for an unsigned probe)')
  } finally {
    await closeNode(node)
    await new Promise(resolve => { blocker.close(resolve) })
  }
})

await scenario('a peer row tracks the address a verified request came from', async () => {
  const a = await makeNode('heal-a')
  const b = await makeNode('heal-b')
  try {
    await b.pair((await a.invite()).string)
    // Simulate a DHCP change by pointing A's record at a dead address; B's
    // verified request must heal it back, because the signature proves identity.
    await a.store.patchPeer(b.self.deviceId, { host: '127.0.0.2' })
    await b.probe(a.self.deviceId) // B → A heals A's row for B? (B learns A's port/name)
    await a.probe(b.self.deviceId)
    const healed = a.store.peer(b.self.deviceId)
    assert.equal(healed?.host, '127.0.0.1', 'the address is corrected from the authenticated request')
  } finally {
    await closeNode(a)
    await closeNode(b)
  }
})

// ── summary ──────────────────────────────────────────────────────────────

for (const root of roots) await rm(root, { recursive: true, force: true })

console.log('')
console.log(`scenarios: ${String(passed)} passed, ${String(failed.length)} failed`)
if (failed.length > 0) {
  for (const entry of failed) console.error(`  - ${entry.name}: ${entry.error?.message ?? entry.error}`)
  process.exitCode = 1
}
