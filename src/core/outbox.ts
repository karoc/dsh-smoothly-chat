/**
 * Outbound delivery queue.
 *
 * Every logical message gets one durable record under `outbox/` *and* one
 * thread row with status `pending`. Delivery is per peer: a dead peer only
 * stalls its own queue, never the others, and a restart resumes whatever is
 * still on disk. Permanent failures (auth, wrong endpoint) stop retrying and
 * surface as `failed`; transport failures keep retrying with capped backoff.
 */

import type { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  FILE_NAME_HEADER,
  FILE_SHA_HEADER,
  FILE_SIZE_HEADER,
  originOf,
  randomId,
  sha256Hex,
} from './protocol.ts'
import { signedHeaderSet } from './server.ts'
import type { Store, OutboxRecord } from './store.ts'
import type { ThreadMessage } from './types.ts'

/** Options for one outbox instance. */
export interface OutboxOptions {
  store: Store
  fetch?: typeof fetch
  logger?: (line: string) => void
  now?: () => number
  /** Called after a status transition so the UI can refresh. */
  onStatus?: (peerId: string, id: string, status: 'sent' | 'failed', error?: string) => void
  /** Called while a file streams to the peer (throttled) so the panel can draw a bar. */
  onProgress?: (peerId: string, id: string, sent: number, total: number) => void
}

/** What one delivery attempt concluded. */
type Outcome =
  | { kind: 'sent' }
  | { kind: 'retry'; error: string }
  | { kind: 'permanent'; error: string }

/** Outbound queue owned by one ChatNode. */
export class Outbox {
  private readonly store: Store
  private readonly fetchImpl: typeof fetch
  private readonly logger: (line: string) => void
  private readonly now: () => number
  private readonly onStatus: OutboxOptions['onStatus']
  private readonly onProgress: OutboxOptions['onProgress']
  private timer: NodeJS.Timeout | undefined
  private inflight: Promise<void> | undefined
  private running = false
  private stopped = false

  constructor(options: OutboxOptions) {
    this.store = options.store
    this.fetchImpl = options.fetch ?? fetch
    this.logger = options.logger ?? (() => {})
    this.now = options.now ?? (() => Date.now())
    this.onStatus = options.onStatus
    this.onProgress = options.onProgress
  }

  /** Queue one text message for one peer and return its thread row. */
  async enqueueText(peerId: string, text: string, batchId?: string): Promise<ThreadMessage> {
    const id = randomId(16)
    const at = this.now()
    const message = await this.store.appendMessage(peerId, {
      id,
      dir: 'out',
      kind: 'text',
      at,
      text,
      ...(batchId === undefined ? {} : { batchId }),
    })
    await this.store.saveOutbox({
      id,
      peerId,
      kind: 'text',
      at,
      attempts: 0,
      ...(batchId === undefined ? {} : { batchId }),
      text,
    })
    this.wake()
    return message
  }

  /** Queue one file for one peer. The digest is computed once, up front. */
  async enqueueFile(peerId: string, path: string, name: string | undefined, batchId?: string): Promise<ThreadMessage> {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`not a file: ${path}`)
    const digest = await hashFile(path)
    const id = randomId(16)
    const at = this.now()
    const fileName = (name ?? basename(path)).slice(0, 120)
    const message = await this.store.appendMessage(peerId, {
      id,
      dir: 'out',
      kind: 'file',
      at,
      file: { name: fileName, size: info.size, sha256: digest },
      ...(batchId === undefined ? {} : { batchId }),
    })
    await this.store.saveOutbox({
      id,
      peerId,
      kind: 'file',
      at,
      attempts: 0,
      ...(batchId === undefined ? {} : { batchId }),
      file: { path, name: fileName, size: info.size, sha256: digest },
    })
    this.wake()
    return message
  }

  /** Run one delivery pass now, ignoring backoff (used by tests and "retry"). */
  async flush(): Promise<void> {
    if (this.inflight !== undefined) await this.inflight
    await this.launch(true)
  }

  /** Stop scheduling further retries. */
  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Schedule a pass soon; safe to call repeatedly. */
  wake(delayMs = 0): void {
    if (this.stopped) return
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.inflight !== undefined) {
        this.wake(200)
        return
      }
      void this.launch(false)
    }, delayMs)
    this.timer.unref?.()
  }

  /** Run one pass, remembering it so flush() can wait for an in-flight pass. */
  private launch(ignoreSchedule: boolean): Promise<void> {
    if (this.inflight !== undefined) return this.inflight
    const run = this.pass(ignoreSchedule).finally(() => {
      if (this.inflight === run) this.inflight = undefined
    })
    this.inflight = run
    return run
  }

  private async pass(ignoreSchedule: boolean): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      const records = await this.store.listOutbox()
      let nextWake = Number.POSITIVE_INFINITY
      for (const record of records) {
        if (this.stopped) return
        const due = (record as OutboxRecord & { nextAt?: number }).nextAt ?? 0
        if (!ignoreSchedule && due > this.now()) {
          nextWake = Math.min(nextWake, due)
          continue
        }
        // One peer at a time keeps broadcasts from interleaving and makes a
        // single dead peer's queue obviously separate.
        const siblings = records.filter(candidate => candidate.peerId === record.peerId)
        if (siblings[0]?.id !== record.id) continue
        for (const candidate of siblings) {
          const outcome = await this.attempt(candidate)
          if (outcome.kind === 'sent') {
            await this.store.appendStatus(candidate.peerId, candidate.id, 'sent', this.now())
            await this.store.deleteOutbox(candidate.id)
            if (candidate.kind === 'file' && candidate.file !== undefined && this.store.isStaged(candidate.file.path)) {
              await rm(candidate.file.path, { force: true })
            }
            this.onStatus?.(candidate.peerId, candidate.id, 'sent')
            continue
          }
          const attempts = candidate.attempts + 1
          if (outcome.kind === 'permanent') {
            await this.store.appendStatus(candidate.peerId, candidate.id, 'failed', this.now(), outcome.error)
            await this.store.patchPeer(candidate.peerId, { lastError: outcome.error })
            await this.store.deleteOutbox(candidate.id)
            if (candidate.kind === 'file' && candidate.file !== undefined && this.store.isStaged(candidate.file.path)) {
              await rm(candidate.file.path, { force: true })
            }
            this.onStatus?.(candidate.peerId, candidate.id, 'failed', outcome.error)
            this.logger(`[smoothly-chat] delivery failed permanently: ${outcome.error}`)
            continue
          }
          const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))
          const nextAt = this.now() + Math.round(delay / 2 + Math.random() * delay / 2)
          await this.store.saveOutbox({ ...candidate, attempts, nextAt })
          nextWake = Math.min(nextWake, nextAt)
          this.logger(`[smoothly-chat] delivery retry in ${String(Math.round((nextAt - this.now()) / 1000))}s: ${outcome.error}`)
          break
        }
      }
      if (Number.isFinite(nextWake)) this.wake(Math.max(250, nextWake - this.now()))
    } finally {
      this.running = false
    }
  }

  private async attempt(record: OutboxRecord): Promise<Outcome> {
    const peer = this.store.peer(record.peerId)
    if (peer === undefined) return { kind: 'permanent', error: 'peer is no longer paired' }
    try {
      if (record.kind === 'text') return await this.deliverText(record, peer)
      return await this.deliverFile(record, peer)
    } catch (error) {
      return { kind: 'retry', error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async deliverText(record: OutboxRecord, peer: { host: string; port: number; key: string }): Promise<Outcome> {
    const body = JSON.stringify({
      v: 1,
      id: record.id,
      ...(record.batchId === undefined ? {} : { batchId: record.batchId }),
      from: { ...this.store.self },
      to: { deviceId: record.peerId },
      at: record.at,
      kind: 'text',
      text: record.text ?? '',
    })
    const digest = sha256Hex(body)
    const headers = signedHeaderSet({
      deviceId: this.store.self.deviceId,
      key: peer.key,
      method: 'POST',
      pathname: '/peer/v1/messages',
      bodySha: digest,
    })
    const response = await this.fetchImpl(`${originOf(peer.host, peer.port)}/peer/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      body,
      signal: AbortSignal.timeout(15_000),
    })
    return this.classify(response)
  }

  private async deliverFile(record: OutboxRecord, peer: { host: string; port: number; key: string }): Promise<Outcome> {
    if (record.file === undefined) return { kind: 'permanent', error: 'outbox record has no file' }
    const info = await stat(record.file.path)
    if (info.size !== record.file.size) return { kind: 'permanent', error: 'source file changed after it was queued' }
    const headers = signedHeaderSet({
      deviceId: this.store.self.deviceId,
      key: peer.key,
      method: 'POST',
      pathname: '/peer/v1/files',
      bodySha: record.file.sha256,
    })
    const response = await this.fetchImpl(`${originOf(peer.host, peer.port)}/peer/v1/files`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        'content-length': String(record.file.size),
        'x-dsc-msg-id': record.id,
        [FILE_NAME_HEADER]: encodeURIComponent(record.file.name),
        [FILE_SIZE_HEADER]: String(record.file.size),
        [FILE_SHA_HEADER]: record.file.sha256,
      },
      body: this.progressStream(record, record.file.size) as unknown as BodyInit,
      duplex: 'half',
      signal: AbortSignal.timeout(120_000),
    } as RequestInit)
    return this.classify(response)
  }

  /** Count bytes on their way to the peer and report a throttled ratio. */
  private progressStream(record: OutboxRecord, total: number): Readable {
    let sent = 0
    let lastAt = 0
    return createReadStream(record.file?.path ?? '').pipe(new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        sent += chunk.length
        const now = this.now()
        if (sent === total || now - lastAt > 150) {
          lastAt = now
          this.onProgress?.(record.peerId, record.id, sent, total)
        }
        callback(null, chunk)
      },
    }))
  }

  private async classify(response: Response): Promise<Outcome> {
    if (response.ok) return { kind: 'sent' }
    const detail = await response.text().catch(() => '')
    const error = `HTTP ${String(response.status)}${detail === '' ? '' : `: ${detail.slice(0, 200)}`}`
    if (response.status === 401 || response.status === 403) return { kind: 'permanent', error }
    if (response.status === 400 || response.status === 404 || response.status === 405 || response.status === 413) {
      return { kind: 'permanent', error }
    }
    return { kind: 'retry', error }
  }
}

/** Stream-hash one file (used once per queued file). */
async function hashFile(path: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => { hash.update(chunk) })
    stream.on('error', reject)
    stream.on('end', () => { resolve() })
  })
  return hash.digest('hex')
}
