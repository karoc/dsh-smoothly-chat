/**
 * Disk store for DSH Smoothly Chat.
 *
 * Layout under the plugin data root (default `~/.dsh/smoothly-chat`):
 *
 *   config.json           0600 — device identity, peer table (with keys), invites
 *   state.json            0600 — per-peer read marks
 *   threads/<peer>.jsonl  append-only message + delivery-status rows
 *   files/<msgId>/<name>  received file bodies, one directory per message
 *   outbox/<msgId>.json   pending outbound deliveries (survive restarts)
 *   tmp/                  staging for atomic writes and incoming streams
 *
 * Every mutation goes through one mutex and lands with write-temp + rename, so
 * a crash leaves either the old or the new file, never half of one. Thread
 * rows are append-only and folded on read; the message id index is rebuilt at
 * open, which is what makes redelivery idempotent.
 */

import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { randomId } from './protocol.ts'
import type {
  ConfigFile,
  FileMeta,
  InviteRecord,
  PeerRecord,
  ThreadMessage,
  ThreadRecord,
} from './types.ts'

/** Serializes every state mutation in one process. */
class Mutex {
  private chain: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task)
    this.chain = next.then(() => undefined, () => undefined)
    return next
  }
}

/** Read marks file. */
interface StateFile {
  version: 1
  read: Record<string, number>
}

/** One outbound delivery that has not been acknowledged yet. */
export interface OutboxRecord {
  id: string
  peerId: string
  kind: 'text' | 'file'
  at: number
  attempts: number
  batchId?: string
  text?: string
  file?: { path: string; name: string; size: number; sha256: string }
  /** Earliest epoch ms at which the next retry may run. */
  nextAt?: number
}

/** Derive the default display name of this machine. */
export function defaultDeviceName(): string {
  const raw = hostname().trim()
  return raw === '' ? 'dsh' : raw
}

/** Parse one JSONL file into rows, ignoring torn trailing lines. */
async function readJsonl(path: string): Promise<ThreadRecord[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const rows: ThreadRecord[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      rows.push(JSON.parse(line) as ThreadRecord)
    } catch {
      // A torn last line is expected after a crash mid-append: skip it.
    }
  }
  return rows
}

/** Fold raw thread rows into messages with their latest delivery status. */
function foldThread(rows: readonly ThreadRecord[]): ThreadMessage[] {
  // Status rows are appended *after* the message they describe, so the fold
  // must collect them first — a single pass would report every outbound
  // message as pending forever.
  const status = new Map<string, { status: 'sent' | 'failed'; error?: string }>()
  for (const row of rows) {
    if (row.t !== 'status') continue
    status.set(row.id, row.error === undefined ? { status: row.status } : { status: row.status, error: row.error })
  }
  const messages: ThreadMessage[] = []
  for (const row of rows) {
    if (row.t === 'status') continue
    messages.push({
      seq: row.seq,
      id: row.id,
      dir: row.dir,
      kind: row.kind,
      peerId: row.peerId,
      at: row.at,
      ...(row.batchId === undefined ? {} : { batchId: row.batchId }),
      ...(row.text === undefined ? {} : { text: row.text }),
      ...(row.file === undefined ? {} : { file: row.file }),
      status: row.dir === 'in' ? 'sent' : status.get(row.id)?.status ?? 'pending',
      ...(status.get(row.id)?.error === undefined ? {} : { error: status.get(row.id)?.error }),
    })
  }
  return messages.sort((left, right) => left.seq - right.seq)
}

/** The disk-backed domain store. */
export class Store {
  readonly root: string
  private readonly mutex = new Mutex()
  private config: ConfigFile
  private read: Record<string, number>
  private readonly seqs = new Map<string, number>()
  private readonly messageIds = new Map<string, Set<string>>()
  private readonly unread = new Map<string, number>()

  private constructor(root: string, config: ConfigFile, read: Record<string, number>) {
    this.root = root
    this.config = config
    this.read = read
  }

  /** Open (or initialize) the store at `root`. */
  static async open(root: string): Promise<Store> {
    await mkdir(root, { recursive: true, mode: 0o700 })
    for (const dir of ['threads', 'files', 'outbox', 'tmp']) {
      await mkdir(join(root, dir), { recursive: true, mode: 0o700 })
    }
    const config = await loadConfig(root)
    const state = await loadState(root)
    const store = new Store(root, config, state.read)
    await store.reindex()
    return store
  }

  /** This machine's identity. */
  get self(): { deviceId: string; name: string } {
    return { deviceId: this.config.deviceId, name: this.config.name }
  }

  /** Peer table (defensive copy). */
  peers(): PeerRecord[] {
    return this.config.peers.map(peer => ({ ...peer }))
  }

  /** One peer by device id. */
  peer(deviceId: string): PeerRecord | undefined {
    const peer = this.config.peers.find(candidate => candidate.deviceId === deviceId)
    return peer === undefined ? undefined : { ...peer }
  }

  /** Rename this machine. */
  async setName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('device name must not be empty')
    await this.mutex.run(async () => {
      this.config = { ...this.config, name: trimmed.slice(0, 64) }
      await this.saveConfig()
    })
  }

  /** Insert or replace one peer. */
  async upsertPeer(peer: PeerRecord): Promise<PeerRecord> {
    return this.mutex.run(async () => {
      const index = this.config.peers.findIndex(candidate => candidate.deviceId === peer.deviceId)
      const next = index === -1 ? [...this.config.peers, peer] : this.config.peers.map((candidate, at) => at === index ? peer : candidate)
      this.config = { ...this.config, peers: next }
      await this.saveConfig()
      return { ...peer }
    })
  }

  /** Merge a patch into an existing peer without dropping its key. */
  async patchPeer(deviceId: string, patch: Partial<PeerRecord>): Promise<PeerRecord | undefined> {
    return this.mutex.run(async () => {
      const current = this.config.peers.find(candidate => candidate.deviceId === deviceId)
      if (current === undefined) return undefined
      const next: PeerRecord = { ...current, ...patch, deviceId: current.deviceId, key: current.key }
      this.config = { ...this.config, peers: this.config.peers.map(candidate => candidate.deviceId === deviceId ? next : candidate) }
      await this.saveConfig()
      return { ...next }
    })
  }

  /** Remove one peer (history files stay on disk until cleared). */
  async removePeer(deviceId: string): Promise<void> {
    await this.mutex.run(async () => {
      this.config = { ...this.config, peers: this.config.peers.filter(peer => peer.deviceId !== deviceId) }
      await this.saveConfig()
    })
  }

  /** Mint a new invitation. */
  async createInvite(ttlMs: number, now: number): Promise<InviteRecord> {
    const invite: InviteRecord = {
      key: randomId(32),
      createdAt: now,
      expiresAt: now + ttlMs,
    }
    await this.mutex.run(async () => {
      // Drop invitations that expired more than a day ago; keep recent ones so
      // the UI can show a used invitation briefly.
      const kept = this.config.invites.filter(candidate => candidate.expiresAt > now - 24 * 60 * 60 * 1000)
      this.config = { ...this.config, invites: [...kept, invite] }
      await this.saveConfig()
    })
    return { ...invite }
  }

  /** Invitations that are still usable. */
  invites(now: number): InviteRecord[] {
    return this.config.invites
      .filter(invite => invite.usedBy === undefined && invite.expiresAt > now)
      .map(invite => ({ ...invite }))
  }

  /** Mark an invitation consumed by a peer. */
  async markInviteUsed(key: string, deviceId: string, now: number): Promise<void> {
    await this.mutex.run(async () => {
      this.config = {
        ...this.config,
        invites: this.config.invites.map(invite => invite.key === key
          ? { ...invite, usedBy: deviceId, usedAt: now }
          : invite),
      }
      await this.saveConfig()
    })
  }

  /** Append one message to a peer thread and return its stored form. */
  async appendMessage(peerId: string, input: {
    id: string
    dir: 'in' | 'out'
    kind: 'text' | 'file'
    at: number
    batchId?: string
    text?: string
    file?: FileMeta
  }): Promise<ThreadMessage> {
    return this.mutex.run(async () => {
      const seq = (this.seqs.get(peerId) ?? 0) + 1
      this.seqs.set(peerId, seq)
      const row: ThreadRecord = {
        t: 'msg',
        seq,
        id: input.id,
        dir: input.dir,
        kind: input.kind,
        peerId,
        at: input.at,
        ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.file === undefined ? {} : { file: input.file }),
      }
      await this.appendThreadRow(peerId, row)
      const ids = this.messageIds.get(peerId) ?? new Set<string>()
      ids.add(input.id)
      this.messageIds.set(peerId, ids)
      if (input.dir === 'in') this.unread.set(peerId, (this.unread.get(peerId) ?? 0) + 1)
      return {
        seq,
        id: input.id,
        dir: input.dir,
        kind: input.kind,
        peerId,
        at: input.at,
        ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.file === undefined ? {} : { file: input.file }),
        status: input.dir === 'in' ? 'sent' : 'pending',
      }
    })
  }

  /** Append one delivery-status row. */
  async appendStatus(peerId: string, id: string, status: 'sent' | 'failed', at: number, error?: string): Promise<void> {
    await this.mutex.run(async () => {
      await this.appendThreadRow(peerId, {
        t: 'status',
        id,
        status,
        at,
        ...(error === undefined ? {} : { error }),
      })
    })
  }

  /** Read one thread, newest window last. */
  async readThread(peerId: string, options: { limit?: number; beforeSeq?: number } = {}): Promise<ThreadMessage[]> {
    const rows = await readJsonl(this.threadPath(peerId))
    const folded = foldThread(rows)
    const before = options.beforeSeq ?? Number.POSITIVE_INFINITY
    const window = folded.filter(message => message.seq < before)
    const limit = options.limit ?? 200
    return window.slice(Math.max(0, window.length - limit))
  }

  /** Number of unread inbound messages per peer. */
  unreadCounts(): Record<string, number> {
    return Object.fromEntries(this.unread)
  }

  /** Mark a thread read up to its current end. */
  async markRead(peerId: string): Promise<void> {
    await this.mutex.run(async () => {
      this.read = { ...this.read, [peerId]: this.seqs.get(peerId) ?? 0 }
      this.unread.set(peerId, 0)
      await this.saveState()
    })
  }

  /** Whether a message id already landed in a thread (idempotent redelivery). */
  hasMessage(peerId: string, id: string): boolean {
    return this.messageIds.get(peerId)?.has(id) ?? false
  }

  /** Absolute directory that owns one message's files. */
  fileDir(msgId: string): string {
    return join(this.root, 'files', safeSegment(msgId))
  }

  /** Stage path for an incoming file stream. */
  tmpPath(tag: string): string {
    return join(this.root, 'tmp', `${safeSegment(tag)}-${randomId(6)}.part`)
  }

  /** Persist one outbox record. */
  async saveOutbox(record: OutboxRecord): Promise<void> {
    await this.mutex.run(async () => {
      await this.writeJsonAtomic(join(this.root, 'outbox', `${safeSegment(record.id)}.json`), record)
    })
  }

  /** All pending outbox records. */
  async listOutbox(): Promise<OutboxRecord[]> {
    const dir = join(this.root, 'outbox')
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const records: OutboxRecord[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        records.push(JSON.parse(await readFile(join(dir, name), 'utf8')) as OutboxRecord)
      } catch {
        // A torn record is dropped rather than wedging the queue.
      }
    }
    return records.sort((left, right) => left.at - right.at)
  }

  /** Drop a delivered (or abandoned) outbox record. */
  async deleteOutbox(id: string): Promise<void> {
    await this.mutex.run(async () => {
      await rm(join(this.root, 'outbox', `${safeSegment(id)}.json`), { force: true })
    })
  }

  // ── internals ──────────────────────────────────────────────────────────

  private threadPath(peerId: string): string {
    return join(this.root, 'threads', `${safeSegment(peerId)}.jsonl`)
  }

  private async appendThreadRow(peerId: string, row: ThreadRecord): Promise<void> {
    await writeFile(this.threadPath(peerId), `${JSON.stringify(row)}\n`, { flag: 'a', mode: 0o600 })
  }

  private async reindex(): Promise<void> {
    const dir = join(this.root, 'threads')
    const names = await readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const peerId = name.slice(0, -'.jsonl'.length)
      const rows = await readJsonl(join(dir, name))
      let lastSeq = 0
      const ids = new Set<string>()
      let unread = 0
      const readMark = this.read[peerId] ?? 0
      for (const row of rows) {
        if (row.t !== 'msg') continue
        lastSeq = Math.max(lastSeq, row.seq)
        ids.add(row.id)
        if (row.dir === 'in' && row.seq > readMark) unread += 1
      }
      this.seqs.set(peerId, lastSeq)
      this.messageIds.set(peerId, ids)
      if (unread > 0) this.unread.set(peerId, unread)
    }
  }

  private async saveConfig(): Promise<void> {
    await this.writeJsonAtomic(join(this.root, 'config.json'), this.config, 0o600)
  }

  private async saveState(): Promise<void> {
    const state: StateFile = { version: 1, read: this.read }
    await this.writeJsonAtomic(join(this.root, 'state.json'), state, 0o600)
  }

  private async writeJsonAtomic(path: string, value: unknown, mode = 0o600): Promise<void> {
    const staged = join(this.root, 'tmp', `${randomId(8)}.json`)
    await writeFile(staged, JSON.stringify(value, null, 2), { mode })
    await chmod(staged, mode)
    await rename(staged, path)
  }
}

/** Replace path separators and traversal dots in an id used as a path segment. */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 128)
}

async function loadConfig(root: string): Promise<ConfigFile> {
  const path = join(root, 'config.json')
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ConfigFile
    if (parsed.version !== 1 || typeof parsed.deviceId !== 'string' || !Array.isArray(parsed.peers)) {
      throw new Error('config.json has an unsupported shape')
    }
    return { ...parsed, invites: Array.isArray(parsed.invites) ? parsed.invites : [] }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
    const config: ConfigFile = {
      version: 1,
      deviceId: randomId(16),
      name: defaultDeviceName(),
      peers: [],
      invites: [],
    }
    await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 })
    await chmod(path, 0o600)
    return config
  }
}

async function loadState(root: string): Promise<StateFile> {
  try {
    const parsed = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) as StateFile
    if (parsed.version === 1 && typeof parsed.read === 'object' && parsed.read !== null) return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { version: 1, read: {} }
}
