/**
 * ChatNode — one machine's mailbox: identity, peer table, peer-facing server,
 * outbox and presence. Everything the host half and the tests drive lives
 * here; the DSH plugin entry is a thin adapter over this class.
 */

import { networkInterfaces } from 'node:os'
import {
  formatPairingString,
  INVITE_TTL_MS,
  normalizeRemoteAddress,
  originOf,
  parsePairingString,
  randomId,
  sha256Hex,
} from './protocol.ts'
import { Outbox } from './outbox.ts'
import { PeerServer, signedHeaderSet } from './server.ts'
import { Store } from './store.ts'
import type { HelloResponse, PeerRecord, ThreadMessage } from './types.ts'

/** Runtime reachability of one peer (never persisted: it is a live fact). */
export interface Presence {
  reachable: boolean
  at: number
}

/** One local interface address, for the "can the LAN reach this machine" self-check. */
export interface LocalAddress {
  address: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
  /** Loopback, private (LAN/VPN), or public. */
  scope: 'loopback' | 'private' | 'public'
}

/** Events the host half forwards to the UI (and SSE subscribers). */
export type ChatEvent =
  | { type: 'inbox'; peerId: string; messageId: string }
  | { type: 'status'; peerId: string; messageId: string; status: 'sent' | 'failed'; error?: string }
  | { type: 'peers' }

/** Options for one ChatNode. */
export interface ChatNodeOptions {
  /** Data root (holds config, threads, files, outbox). */
  root: string
  /** Peer-server port; 0 asks the OS for a free one. */
  port?: number
  /** Interface to bind; omitted means every interface. */
  bindHost?: string
  /** Address advertised in invitations; omitted means auto-detect. */
  advertiseHost?: string
  /** Display name; defaults to the OS hostname. */
  name?: string
  logger?: (line: string) => void
  fetch?: typeof fetch
  now?: () => number
  onEvent?: (event: ChatEvent) => void
  maxFileBytes?: number
}

/** Whether an address belongs to a private (LAN / VPN / NAT) range. */
function isPrivate(address: string): boolean {
  if (address.includes(':')) return address.startsWith('fd') || address.startsWith('fc') || address.startsWith('fe80')
  const [a, b] = address.split('.').map(Number)
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

/** One machine's mailbox. */
export class ChatNode {
  readonly store: Store
  readonly server: PeerServer
  readonly outbox: Outbox
  private readonly logger: (line: string) => void
  private readonly now: () => number
  private readonly onEvent: ((event: ChatEvent) => void) | undefined
  private readonly advertiseHost: string | undefined
  private readonly presence = new Map<string, Presence>()
  private readonly listeners = new Set<(event: ChatEvent) => void>()
  private started = false
  private startFailure: string | undefined

  private constructor(options: ChatNodeOptions, store: Store) {
    this.store = store
    this.logger = options.logger ?? (() => {})
    this.now = options.now ?? (() => Date.now())
    this.onEvent = options.onEvent
    this.advertiseHost = options.advertiseHost
    this.server = new PeerServer({
      store,
      port: options.port ?? 47810,
      ...(options.bindHost === undefined ? {} : { host: options.bindHost }),
      logger: this.logger,
      ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
      now: this.now,
      onInbox: (peerId, messageId) => { this.emit({ type: 'inbox', peerId, messageId }) },
    })
    this.outbox = new Outbox({
      store,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      logger: this.logger,
      now: this.now,
      onStatus: (peerId, messageId, status, error) => {
        this.emit(error === undefined
          ? { type: 'status', peerId, messageId, status }
          : { type: 'status', peerId, messageId, status, error })
      },
    })
  }

  /** Open the store and construct the node (does not listen yet). */
  static async create(options: ChatNodeOptions): Promise<ChatNode> {
    const store = await Store.open(options.root)
    if (options.name !== undefined) await store.setName(options.name)
    return new ChatNode(options, store)
  }

  /** Add a listener for mailbox events (the UI's SSE hub). */
  subscribe(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Fan an event out to the constructor callback and every subscriber. */
  private emit(event: ChatEvent): void {
    this.onEvent?.(event)
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A broken subscriber must not break delivery.
      }
    }
  }

  /** Identity of this machine. */
  get self(): { deviceId: string; name: string } {
    return this.store.self
  }

  /** Port the peer server listens on (0 before start). */
  get port(): number {
    return this.server.port
  }

  /** Why the listener failed to start, if it did. */
  get lastError(): string | undefined {
    return this.startFailure
  }

  /** Start listening and resume whatever the outbox still holds. */
  async start(): Promise<number> {
    if (this.started) return this.server.port
    let port: number
    try {
      port = await this.server.start()
    } catch (error) {
      this.startFailure = error instanceof Error ? error.message : String(error)
      throw error
    }
    this.started = true
    void this.resume()
    return port
  }

  /** Stop listening and cancel retries. */
  async stop(): Promise<void> {
    this.outbox.stop()
    await this.server.stop()
    this.started = false
  }

  /** Run one outbox pass immediately (tests, or the UI's retry button). */
  async flush(): Promise<void> {
    await this.outbox.flush()
  }

  /** Retry pair confirmations that never completed, then drain the outbox. */
  private async resume(): Promise<void> {
    for (const peer of this.store.peers()) {
      if (peer.pairedAt !== undefined) continue
      try {
        await this.confirm(peer.deviceId)
      } catch (error) {
        this.logger(`[smoothly-chat] pending pair with ${peer.name || peer.deviceId.slice(0, 8)} still failing: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.outbox.wake(50)
  }

  /** Local addresses, for the reachability self-check shown in the UI. */
  addresses(): LocalAddress[] {
    const rows: LocalAddress[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const info of list ?? []) {
        if (info.family !== 'IPv4' && info.family !== 'IPv6') continue
        const address = info.address
        const scope = address === '::1' || address.startsWith('127.') || address === '::'
          ? 'loopback'
          : isPrivate(address) ? 'private' : 'public'
        rows.push({ address, family: info.family, internal: info.internal, scope })
      }
    }
    return rows.sort((left, right) => Number(left.internal) - Number(right.internal))
  }

  /** Address to advertise in invitations. */
  private advertisedHost(): string {
    if (this.advertiseHost !== undefined && this.advertiseHost !== '') return this.advertiseHost
    const lan = this.addresses().find(row => !row.internal && row.scope === 'private' && row.family === 'IPv4')
    const any = this.addresses().find(row => !row.internal && row.family === 'IPv4')
    return lan?.address ?? any?.address ?? '127.0.0.1'
  }

  /** Mint an invitation string for another machine. */
  async invite(): Promise<{ string: string; key: string; expiresAt: number }> {
    if (!this.started) throw new Error('start the peer server before minting an invitation')
    const invite = await this.store.createInvite(INVITE_TTL_MS, this.now())
    return {
      string: formatPairingString({
        host: this.advertisedHost(),
        port: this.server.port,
        deviceId: this.store.self.deviceId,
        key: invite.key,
      }),
      key: invite.key,
      expiresAt: invite.expiresAt,
    }
  }

  /**
   * Paste an invitation from the other machine. Stores the pending peer first
   * (so the pairing survives an offline peer) and then confirms it.
   */
  async pair(invitation: string): Promise<PeerRecord> {
    if (!this.started) throw new Error('start the peer server before pairing')
    const parsed = parsePairingString(invitation)
    if (parsed.deviceId === this.store.self.deviceId) throw new Error('this is this machine\'s own invitation')
    const existing = this.store.peer(parsed.deviceId)
    await this.store.upsertPeer({
      deviceId: parsed.deviceId,
      name: existing?.name ?? '',
      host: parsed.host,
      port: parsed.port,
      key: parsed.key,
      addedAt: existing?.addedAt ?? this.now(),
      ...(existing?.pairedAt === undefined ? {} : { pairedAt: existing.pairedAt }),
    })
    return this.confirm(parsed.deviceId)
  }

  /** Send (or retry) the confirmation half of a pairing. */
  async confirm(deviceId: string): Promise<PeerRecord> {
    const peer = this.store.peer(deviceId)
    if (peer === undefined) throw new Error('unknown peer')
    const body = JSON.stringify({
      v: 1,
      device: { ...this.store.self, port: this.server.port },
      at: this.now(),
    })
    const headers = signedHeaderSet({
      deviceId: this.store.self.deviceId,
      key: peer.key,
      method: 'POST',
      pathname: '/peer/v1/pair',
      bodySha: sha256Hex(body),
    })
    const response = await fetch(`${originOf(peer.host, peer.port)}/peer/v1/pair`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const error = `pairing rejected: HTTP ${String(response.status)} ${detail.slice(0, 200)}`
      await this.store.patchPeer(deviceId, { lastError: error })
      throw new Error(error)
    }
    const reply = await response.json() as HelloResponse & { paired?: boolean }
    const updated = await this.store.patchPeer(deviceId, {
      name: reply.self.name,
      port: reply.self.port,
      pairedAt: peer.pairedAt ?? this.now(),
      lastError: undefined,
    })
    this.logger(`[smoothly-chat] paired with ${reply.self.name} (${deviceId.slice(0, 8)}…)`)
    this.emit({ type: 'peers' })
    return updated ?? peer
  }

  /** Remove one pair on both sides (remote best effort). */
  async unpair(deviceId: string): Promise<void> {
    const peer = this.store.peer(deviceId)
    if (peer !== undefined) {
      const body = JSON.stringify({ v: 1, device: { deviceId: this.store.self.deviceId }, at: this.now() })
      const headers = signedHeaderSet({
        deviceId: this.store.self.deviceId,
        key: peer.key,
        method: 'POST',
        pathname: '/peer/v1/unpair',
        bodySha: sha256Hex(body),
      })
      try {
        await fetch(`${originOf(peer.host, peer.port)}/peer/v1/unpair`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(5_000),
        })
      } catch {
        // The remote side keeps its stale entry and will mark it broken on the
        // next 401; local removal is what the user asked for.
      }
    }
    await this.store.removePeer(deviceId)
    this.presence.delete(deviceId)
    this.emit({ type: 'peers' })
  }

  /** Queue one text message for each peer; returns one row per peer. */
  async sendText(peerIds: readonly string[], text: string): Promise<{ batchId: string; messages: ThreadMessage[] }> {
    const batchId = randomId(8)
    const messages: ThreadMessage[] = []
    for (const peerId of peerIds) {
      const peer = this.store.peer(peerId)
      if (peer === undefined || peer.pairedAt === undefined) continue
      messages.push(await this.outbox.enqueueText(peerId, text, batchId))
    }
    if (messages.length === 0) throw new Error('no paired peer to send to')
    void this.outbox.flush().catch(() => {})
    return { batchId, messages }
  }

  /** Queue one file for each peer; returns one row per peer. */
  async sendFile(peerIds: readonly string[], path: string, name?: string): Promise<{ batchId: string; messages: ThreadMessage[] }> {
    const batchId = randomId(8)
    const messages: ThreadMessage[] = []
    for (const peerId of peerIds) {
      const peer = this.store.peer(peerId)
      if (peer === undefined || peer.pairedAt === undefined) continue
      messages.push(await this.outbox.enqueueFile(peerId, path, name, batchId))
    }
    if (messages.length === 0) throw new Error('no paired peer to send to')
    void this.outbox.flush().catch(() => {})
    return { batchId, messages }
  }

  /** Probe one peer's peer server; updates the live presence map. */
  async probe(deviceId: string): Promise<boolean> {
    const peer = this.store.peer(deviceId)
    if (peer === undefined || peer.pairedAt === undefined) return false
    const headers = signedHeaderSet({
      deviceId: this.store.self.deviceId,
      key: peer.key,
      method: 'GET',
      pathname: '/peer/v1/hello',
      bodySha: sha256Hex(''),
    })
    try {
      const response = await fetch(`${originOf(peer.host, peer.port)}/peer/v1/hello`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) {
        this.presence.set(deviceId, { reachable: false, at: this.now() })
        return false
      }
      const reply = await response.json() as HelloResponse
      this.presence.set(deviceId, { reachable: true, at: this.now() })
      const patch: Partial<PeerRecord> = { lastSeenAt: this.now(), lastError: undefined }
      if (reply.self.name !== peer.name) patch.name = reply.self.name
      if (reply.self.port !== peer.port) patch.port = reply.self.port
      if (Object.keys(patch).length > 2 || reply.self.name !== peer.name || reply.self.port !== peer.port) {
        await this.store.patchPeer(deviceId, patch)
      }
      return true
    } catch {
      this.presence.set(deviceId, { reachable: false, at: this.now() })
      return false
    }
  }

  /** Probe every paired peer. */
  async probeAll(): Promise<Record<string, Presence>> {
    await Promise.all(this.store.peers().map(peer => this.probe(peer.deviceId)))
    return this.presenceSnapshot()
  }

  /** Current presence snapshot. */
  presenceSnapshot(): Record<string, Presence> {
    return Object.fromEntries(this.presence)
  }

  /** Persisted settings view (read-only for now). */
  configPath(): string {
    return `${this.store.root}/config.json`
  }

  /** Remote address helper used by the host adapter when logging. */
  static remoteOf(address: string | undefined): string {
    return normalizeRemoteAddress(address)
  }
}
