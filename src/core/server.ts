/**
 * The peer-facing HTTP server: the only surface another machine can reach.
 *
 * It exists as its own listener (instead of a route on DSH's web server) on
 * purpose: DSH's server refuses wildcard binds precisely because it fronts an
 * agent that can run commands. This server exposes nothing but an inbox —
 * four signed endpoints — so opening it to the LAN cannot reach a session, a
 * tool, or the GUI.
 *
 * Every endpoint except `pair` requires an already established pair; `pair`
 * itself requires a key minted by this machine (the invitation), so an
 * unpaired machine cannot compute a valid signature at all.
 */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  canonical,
  DEVICE_HEADER,
  FILE_NAME_HEADER,
  FILE_SHA_HEADER,
  FILE_SIZE_HEADER,

  MAX_FILE_BYTES,
  MAX_TEXT_BYTES,
  NONCE_HEADER,
  normalizeRemoteAddress,
  PROTOCOL_VERSION,
  PROTO_HEADER,
  safeFileName,
  sha256Hex,
  SIG_HEADER,
  sign,
  TS_HEADER,
  TS_WINDOW_MS,
  verifySignature,
} from './protocol.ts'
import type { Store } from './store.ts'
import type { ErrorBody, HelloResponse, PairRequest, PeerRecord, TextEnvelope, UnpairRequest } from './types.ts'

/** Delay before a failed-auth IP is refused outright. */
const BAN_MS = 60_000
/** Failed authentications that trigger a ban. */
const FAILURES_TO_BAN = 5
/** Requests per IP per minute. */
const RATE_LIMIT = 240
/** Pairing candidate requests may be large enough for a long device name. */
const MAX_PAIR_BYTES = 64 * 1024

/** Transport-level failure mapped to one HTTP response. */
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

function errorBody(code: string, message: string): ErrorBody {
  return { ok: false, error: { code, message } }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return
  const text = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', String(Buffer.byteLength(text)))
  res.end(text)
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Read a request body with a hard byte ceiling. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(header(req, 'content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, 'too-large', `body exceeds ${String(limit)} bytes`)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const bytes = chunk as Buffer
    total += bytes.length
    if (total > limit) throw new HttpError(413, 'too-large', `body exceeds ${String(limit)} bytes`)
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

/** Options for one peer server instance. */
export interface PeerServerOptions {
  store: Store
  /** Port to listen on; 0 asks the OS for an ephemeral one. */
  port: number
  /** Interface to bind; defaults to every interface. */
  host?: string
  /** Logger line sink. */
  logger?: (line: string) => void
  /** Called after an inbound message has been persisted. */
  onInbox?: (peerId: string, messageId: string) => void
  maxTextBytes?: number
  maxFileBytes?: number
  now?: () => number
}

/** The mailbox listener owned by one ChatNode. */
export class PeerServer {
  readonly store: Store
  private readonly host: string
  private readonly logger: (line: string) => void
  private readonly onInbox: ((peerId: string, messageId: string) => void) | undefined
  private readonly maxTextBytes: number
  private readonly maxFileBytes: number
  private readonly now: () => number
  private readonly http
  private readonly rate = new Map<string, { count: number; resetAt: number }>()
  private readonly bans = new Map<string, number>()
  private readonly failures = new Map<string, number>()
  private readonly seenNonces = new Map<string, number>()
  private boundPort: number

  constructor(options: PeerServerOptions) {
    this.store = options.store
    this.host = options.host ?? '0.0.0.0'
    this.logger = options.logger ?? (() => {})
    this.onInbox = options.onInbox
    this.maxTextBytes = options.maxTextBytes ?? MAX_TEXT_BYTES
    this.maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES
    this.now = options.now ?? (() => Date.now())
    this.boundPort = options.port
    this.http = createServer((req, res) => { void this.handle(req, res) })
  }

  /** Port actually bound (useful when constructed with port 0). */
  get port(): number {
    return this.boundPort
  }

  /** Begin listening; resolves with the bound port. */
  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { reject(error) }
      this.http.once('error', onError)
      this.http.listen(this.boundPort, this.host, () => {
        this.http.off('error', onError)
        resolve()
      })
    })
    const address = this.http.address() as AddressInfo | null
    if (address !== null && typeof address === 'object') this.boundPort = address.port
    this.logger(`[smoothly-chat] peer server listening on ${this.host}:${String(this.boundPort)}`)
    return this.boundPort
  }

  /** Stop listening and drop open sockets. */
  async stop(): Promise<void> {
    if (!this.http.listening) return
    this.http.closeAllConnections()
    await new Promise<void>((resolve) => { this.http.close(() => { resolve() }) })
  }

  // ── dispatch ───────────────────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = normalizeRemoteAddress(req.socket.remoteAddress)
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', 'http://smoothly-chat.local').pathname
      if (!this.admit(remote)) throw new HttpError(429, 'rate-limited', 'too many requests')
      switch (pathname) {
        case '/peer/v1/pair':
          await this.handlePair(req, res, remote)
          break
        case '/peer/v1/hello':
          await this.handleHello(req, res, pathname, remote)
          break
        case '/peer/v1/messages':
          await this.handleText(req, res, pathname, remote)
          break
        case '/peer/v1/files':
          await this.handleFile(req, res, pathname, remote)
          break
        case '/peer/v1/unpair':
          await this.handleUnpair(req, res, pathname, remote)
          break
        default:
          throw new HttpError(404, 'not-found', 'unknown endpoint')
      }
    } catch (error) {
      const failure = error instanceof HttpError ? error : new HttpError(500, 'internal', error instanceof Error ? error.message : String(error))
      if (failure.status === 401 || failure.status === 403) this.noteAuthFailure(remote)
      this.logger(`[smoothly-chat] ${pathname} from ${remote} → ${String(failure.status)} ${failure.code}`)
      sendJson(res, failure.status, errorBody(failure.code, failure.message))
      req.resume()
    }
  }

  /** Token bucket plus temporary bans, keyed by connect address. */
  private admit(remote: string): boolean {
    const now = this.now()
    const bannedUntil = this.bans.get(remote)
    if (bannedUntil !== undefined) {
      if (bannedUntil > now) return false
      this.bans.delete(remote)
    }
    const bucket = this.rate.get(remote)
    if (bucket === undefined || bucket.resetAt <= now) {
      this.rate.set(remote, { count: 1, resetAt: now + 60_000 })
      return true
    }
    bucket.count += 1
    return bucket.count <= RATE_LIMIT
  }

  private noteAuthFailure(remote: string): void {
    if (remote === '') return
    const failures = (this.failures.get(remote) ?? 0) + 1
    this.failures.set(remote, failures)
    if (failures >= FAILURES_TO_BAN) {
      this.bans.set(remote, this.now() + BAN_MS)
      this.failures.delete(remote)
      this.logger(`[smoothly-chat] ${remote} banned for ${String(BAN_MS / 1000)}s after repeated auth failures`)
    }
  }

  /** Validate the signed-request headers that every route shares. */
  private signedRequest(req: IncomingMessage): { deviceId: string; ts: number; nonce: string; signature: string } {
    const deviceId = header(req, DEVICE_HEADER) ?? ''
    const ts = Number(header(req, TS_HEADER))
    const nonce = header(req, NONCE_HEADER) ?? ''
    const signature = header(req, SIG_HEADER) ?? ''
    // Missing credentials is an authentication problem (401); a *present but
    // unsupported* protocol version is a protocol problem (400).
    if (deviceId === '' || nonce === '' || signature === '' || !Number.isFinite(ts)) {
      throw new HttpError(401, 'unsigned', 'signed request headers are required')
    }
    const protocol = header(req, PROTO_HEADER)
    if (protocol !== String(PROTOCOL_VERSION)) {
      throw new HttpError(400, 'unsupported-protocol', `expected protocol ${String(PROTOCOL_VERSION)}`)
    }
    if (Math.abs(this.now() - ts) > TS_WINDOW_MS) {
      throw new HttpError(401, 'stale-timestamp', 'request timestamp is outside the accepted window')
    }
    return { deviceId, ts, nonce, signature }
  }

  /** Reject a nonce that was already accepted from this device. */
  private claimNonce(deviceId: string, nonce: string): void {
    this.pruneNonces()
    const key = `${deviceId}:${nonce}`
    if (this.seenNonces.has(key)) throw new HttpError(401, 'replayed-nonce', 'this request was already delivered')
    this.seenNonces.set(key, this.now())
  }

  private pruneNonces(): void {
    if (this.seenNonces.size < 4096) return
    const cutoff = this.now() - 2 * TS_WINDOW_MS
    for (const [key, at] of this.seenNonces) {
      if (at < cutoff) this.seenNonces.delete(key)
    }
  }

  /** Authenticate one request against the pair key; returns the peer row. */
  private async authenticate(req: IncomingMessage, pathname: string, bodySha: string, remote: string): Promise<PeerRecord> {
    const { deviceId, ts, nonce, signature } = this.signedRequest(req)
    const peer = this.store.peer(deviceId)
    if (peer === undefined) throw new HttpError(401, 'unknown-device', 'this machine is not paired with you')
    const text = canonical(req.method ?? 'GET', pathname, ts, nonce, bodySha)
    if (!verifySignature(peer.key, text, signature)) {
      throw new HttpError(401, 'bad-signature', 'request signature does not match the pair key')
    }
    this.claimNonce(deviceId, nonce)
    const patch: Partial<PeerRecord> = { lastSeenAt: this.now() }
    if (peer.lastError !== undefined) patch.lastError = undefined
    // Address self-heal: a verified request proves who is on the other end, so
    // a DHCP change is learned here instead of stranding the conversation.
    if (remote !== '' && remote !== peer.host) patch.host = remote
    await this.store.patchPeer(deviceId, patch)
    return peer
  }

  // ── endpoints ──────────────────────────────────────────────────────────

  /**
   * Accept a pairing confirmation. The caller signs with the invitation key,
   * which is the only credential that can exist before both sides know each
   * other — holding it *is* the authorization, so no manual accept step.
   */
  private async handlePair(req: IncomingMessage, res: ServerResponse, remote: string): Promise<void> {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'use POST')
    // Validate the credential headers before reading any bytes: an unsigned
    // caller must not be able to make this process buffer a body at all.
    const signed = this.signedRequest(req)
    const body = await readBody(req, MAX_PAIR_BYTES)
    const bodySha = sha256Hex(body)
    let parsed: PairRequest
    try {
      parsed = JSON.parse(body.toString('utf8')) as PairRequest
    } catch {
      throw new HttpError(400, 'bad-body', 'pair body must be JSON')
    }
    if (parsed.v !== PROTOCOL_VERSION || typeof parsed.device?.deviceId !== 'string'
      || typeof parsed.device.name !== 'string' || !Number.isInteger(parsed.device.port)
      || parsed.device.port < 1 || parsed.device.port > 65535) {
      throw new HttpError(400, 'bad-body', 'pair body is incomplete')
    }
    if (signed.deviceId !== parsed.device.deviceId) {
      throw new HttpError(401, 'bad-signature', 'device header does not match the pairing body')
    }
    if (parsed.device.deviceId === this.store.self.deviceId) {
      throw new HttpError(400, 'self-pairing', 'cannot pair a machine with itself')
    }
    const now = this.now()
    const text = canonical(req.method ?? 'POST', '/peer/v1/pair', signed.ts, signed.nonce, bodySha)
    const invites = this.store.invites(now)
    const candidates: { key: string; invite: string | undefined }[] = [
      ...invites.map(invite => ({ key: invite.key, invite: invite.key })),
      ...this.store.peers().map(peer => ({ key: peer.key, invite: undefined })),
    ]
    const matched = candidates.find(candidate => verifySignature(candidate.key, text, signed.signature))
    if (matched === undefined) throw new HttpError(401, 'bad-signature', 'no invitation on this machine matches the signature')
    this.claimNonce(signed.deviceId, signed.nonce)

    const existing = this.store.peer(parsed.device.deviceId)
    const peer: PeerRecord = {
      deviceId: parsed.device.deviceId,
      name: parsed.device.name.slice(0, 64),
      host: remote !== '' ? remote : existing?.host ?? '127.0.0.1',
      port: parsed.device.port,
      key: matched.key,
      addedAt: existing?.addedAt ?? now,
      pairedAt: existing?.pairedAt ?? now,
      lastSeenAt: now,
    }
    await this.store.upsertPeer(peer)
    if (matched.invite !== undefined) await this.store.markInviteUsed(matched.invite, parsed.device.deviceId, now)
    this.logger(`[smoothly-chat] paired with ${peer.name} (${peer.deviceId.slice(0, 8)}…) at ${peer.host}:${String(peer.port)}`)
    const reply: HelloResponse & { paired: true } = {
      ok: true,
      v: PROTOCOL_VERSION,
      self: { ...this.store.self, port: this.boundPort },
      at: now,
      paired: true,
    }
    sendJson(res, 200, reply)
  }

  /** Authenticated identity probe: presence plus address self-heal. */
  private async handleHello(req: IncomingMessage, res: ServerResponse, pathname: string, remote: string): Promise<void> {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'use GET')
    await this.authenticate(req, pathname, sha256Hex(''), remote)
    const reply: HelloResponse = {
      ok: true,
      v: PROTOCOL_VERSION,
      self: { ...this.store.self, port: this.boundPort },
      at: this.now(),
    }
    sendJson(res, 200, reply)
  }

  /** Persist one text message. */
  private async handleText(req: IncomingMessage, res: ServerResponse, pathname: string, remote: string): Promise<void> {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'use POST')
    this.signedRequest(req)
    const body = await readBody(req, this.maxTextBytes)
    const peer = await this.authenticate(req, pathname, sha256Hex(body), remote)
    if (peer.pairedAt === undefined) throw new HttpError(403, 'not-paired', 'pairing is not confirmed yet')
    let envelope: TextEnvelope
    try {
      envelope = JSON.parse(body.toString('utf8')) as TextEnvelope
    } catch {
      throw new HttpError(400, 'bad-body', 'message body must be JSON')
    }
    if (envelope.v !== PROTOCOL_VERSION || envelope.kind !== 'text' || typeof envelope.id !== 'string'
      || typeof envelope.text !== 'string' || envelope.from?.deviceId !== peer.deviceId) {
      throw new HttpError(400, 'bad-body', 'message envelope is incomplete')
    }
    if (envelope.to?.deviceId !== this.store.self.deviceId) {
      throw new HttpError(400, 'wrong-recipient', 'message is addressed to another machine')
    }
    if (this.store.hasMessage(peer.deviceId, envelope.id)) {
      sendJson(res, 200, { ok: true, duplicate: true })
      return
    }
    await this.store.appendMessage(peer.deviceId, {
      id: envelope.id,
      dir: 'in',
      kind: 'text',
      at: this.now(),
      text: envelope.text,
      ...(envelope.batchId === undefined ? {} : { batchId: envelope.batchId }),
    })
    this.onInbox?.(peer.deviceId, envelope.id)
    sendJson(res, 200, { ok: true })
  }

  /** Stream one file to disk, verify its digest, then persist the message. */
  private async handleFile(req: IncomingMessage, res: ServerResponse, pathname: string, remote: string): Promise<void> {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'use POST')
    const id = header(req, 'x-dsc-msg-id') ?? ''
    const rawName = header(req, FILE_NAME_HEADER) ?? ''
    const declaredSize = Number(header(req, FILE_SIZE_HEADER))
    const digest = header(req, FILE_SHA_HEADER) ?? ''
    if (id === '' || rawName === '' || !Number.isFinite(declaredSize) || !/^[0-9a-f]{64}$/u.test(digest)) {
      throw new HttpError(400, 'bad-headers', 'file upload headers are incomplete')
    }
    if (declaredSize > this.maxFileBytes) throw new HttpError(413, 'too-large', `file exceeds ${String(this.maxFileBytes)} bytes`)
    this.signedRequest(req)
    const name = safeFileName(decodeURIComponent(rawName))
    const peer = await this.authenticate(req, pathname, digest, remote)
    if (peer.pairedAt === undefined) throw new HttpError(403, 'not-paired', 'pairing is not confirmed yet')
    if (this.store.hasMessage(peer.deviceId, id)) {
      req.resume()
      sendJson(res, 200, { ok: true, duplicate: true })
      return
    }
    const staged = this.store.tmpPath(id)
    const hash = createHash('sha256')
    let received = 0
    try {
      await pipeline(
        req,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            received += chunk.length
            if (received > declaredSize) throw new HttpError(413, 'too-large', 'file body is larger than announced')
            hash.update(chunk)
            yield chunk
          }
        },
        createWriteStream(staged, { mode: 0o600 }),
      )
      if (received !== declaredSize) throw new HttpError(400, 'size-mismatch', 'file body is shorter than announced')
      if (hash.digest('hex') !== digest) throw new HttpError(400, 'digest-mismatch', 'file digest does not match the signed value')
      const dir = this.store.fileDir(id)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const finalPath = join(dir, name)
      await rename(staged, finalPath)
      await this.store.appendMessage(peer.deviceId, {
        id,
        dir: 'in',
        kind: 'file',
        at: this.now(),
        file: { name, size: declaredSize, sha256: digest },
      })
      this.onInbox?.(peer.deviceId, id)
      sendJson(res, 200, { ok: true, size: declaredSize })
    } catch (error) {
      await rm(staged, { force: true })
      throw error
    }
  }

  /** Remove a pair (the caller's side and ours). */
  private async handleUnpair(req: IncomingMessage, res: ServerResponse, pathname: string, remote: string): Promise<void> {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'use POST')
    // Validate the credential headers before reading any bytes: an unsigned
    // caller must not be able to make this process buffer a body at all.
    this.signedRequest(req)
    const body = await readBody(req, MAX_PAIR_BYTES)
    const peer = await this.authenticate(req, pathname, sha256Hex(body), remote)
    let parsed: UnpairRequest | undefined
    try {
      parsed = JSON.parse(body.toString('utf8')) as UnpairRequest
    } catch {
      throw new HttpError(400, 'bad-body', 'unpair body must be JSON')
    }
    if (parsed.v !== PROTOCOL_VERSION || parsed.device?.deviceId !== peer.deviceId) {
      throw new HttpError(400, 'bad-body', 'unpair body does not match the caller')
    }
    await this.store.removePeer(peer.deviceId)
    this.logger(`[smoothly-chat] unpaired ${peer.name}`)
    sendJson(res, 200, { ok: true })
  }
}

/** Compute the signed header set for an outbound call (also used by tests). */
export function signedHeaderSet(input: {
  deviceId: string
  key: string
  method: string
  pathname: string
  bodySha: string
  now?: number
}): Record<string, string> {
  const ts = input.now ?? Date.now()
  const nonce = `${ts.toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const text = canonical(input.method, input.pathname, ts, nonce, input.bodySha)
  return {
    [PROTO_HEADER]: String(PROTOCOL_VERSION),
    [DEVICE_HEADER]: input.deviceId,
    [TS_HEADER]: String(ts),
    [NONCE_HEADER]: nonce,
    [SIG_HEADER]: sign(input.key, text),
  }
}
