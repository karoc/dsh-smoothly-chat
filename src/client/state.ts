/**
 * Client-side mailbox store.
 *
 * One module-level snapshot consumed through `useSyncExternalStore` (the
 * snapshot object is replaced only on publish, satisfying React's stable-
 * reference contract). Freshness comes from SSE with a 5-second polling
 * fallback, so a dropped stream degrades to "a few seconds late" instead of a
 * silently frozen panel.
 */

import { useSyncExternalStore } from 'react'

/** API prefix owned by the host half. */
const API = '/smoothly-chat/api'

/** One peer row as the API reports it (never includes the pair key). */
export interface PeerView {
  deviceId: string
  name: string
  host: string
  port: number
  addedAt: number
  pairedAt?: number
  lastSeenAt?: number
  lastError?: string
  unread: number
  reachable: boolean
}

/** One local interface address. */
export interface AddressView {
  address: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
  scope: 'loopback' | 'private' | 'public'
}

/** Whole-mailbox state as the API reports it. */
export interface StateView {
  ok: true
  protocolVersion: number
  self: { deviceId: string; name: string; port: number }
  addresses: AddressView[]
  lanReachable: boolean
  peers: PeerView[]
  settings: { port: number; maxUploadBytes: number }
  serverError: string | null
}

/** One message in a thread. */
export interface ThreadMessage {
  seq: number
  id: string
  dir: 'in' | 'out'
  kind: 'text' | 'file'
  peerId: string
  at: number
  batchId?: string
  text?: string
  file?: { name: string; size: number; sha256: string }
  status: 'pending' | 'sent' | 'failed'
  error?: string
}

/** Snapshot read by every component. */
export interface InboxSnapshot {
  state: StateView | undefined
  threads: Record<string, ThreadMessage[]>
  selected: string | null
  loading: boolean
  error: string | undefined
}

let snapshot: InboxSnapshot = {
  state: undefined,
  threads: {},
  selected: null,
  loading: true,
  error: undefined,
}
const listeners = new Set<() => void>()
let inflight: Promise<void> | undefined
let refreshSeq = 0
let started = false

/** Subscribe to snapshot replacements. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Current snapshot (stable until the next publish). */
export function getSnapshot(): InboxSnapshot {
  return snapshot
}

function publish(patch: Partial<InboxSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[smoothly-chat] store listener threw:', error)
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Call one API route and unwrap the `{ ok }` envelope. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text === '' ? {} : JSON.parse(text)
  } catch {
    throw new Error(`unexpected response (HTTP ${String(response.status)})`)
  }
  const record = body as { ok?: boolean; error?: unknown }
  if (!response.ok || record.ok === false) {
    throw new Error(typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`)
  }
  return body as T
}

/** Reload state and the selected thread. */
export function refresh(): Promise<void> {
  if (inflight !== undefined) return inflight
  const seq = ++refreshSeq
  inflight = (async () => {
    try {
      const state = await request<StateView>('/state')
      if (seq !== refreshSeq) return
      const selected = snapshot.selected ?? state.peers[0]?.deviceId ?? null
      const threads = { ...snapshot.threads }
      if (selected !== null) {
        const thread = await request<{ messages: ThreadMessage[] }>(
          `/thread?peer=${encodeURIComponent(selected)}&limit=300`,
        )
        threads[selected] = thread.messages
      }
      publish({ state, threads, selected, loading: false, error: undefined })
    } catch (error) {
      publish({ loading: false, error: messageOf(error) })
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}

/** Select one peer, load its thread and clear its unread mark. */
export async function selectPeer(deviceId: string): Promise<void> {
  publish({ selected: deviceId })
  try {
    const thread = await request<{ messages: ThreadMessage[] }>(
      `/thread?peer=${encodeURIComponent(deviceId)}&limit=300`,
    )
    publish({ threads: { ...snapshot.threads, [deviceId]: thread.messages } })
  } catch (error) {
    publish({ error: messageOf(error) })
    return
  }
  const unread = snapshot.state?.peers.find(peer => peer.deviceId === deviceId)?.unread ?? 0
  if (unread > 0) await markRead(deviceId)
}

/** Clear the unread mark of one peer. */
export async function markRead(deviceId: string): Promise<void> {
  try {
    await request('/read', { method: 'POST', body: JSON.stringify({ peerId: deviceId }) })
    await refresh()
  } catch (error) {
    publish({ error: messageOf(error) })
  }
}

/** Send text to the selected peer, or to every peer when `broadcast` is set. */
export async function sendText(text: string, broadcast: boolean): Promise<void> {
  const peerIds = broadcast
    ? undefined
    : snapshot.selected === null ? undefined : [snapshot.selected]
  await request('/send', {
    method: 'POST',
    body: JSON.stringify({
      text,
      ...(peerIds === undefined ? {} : { peerIds }),
    }),
  })
  await refresh()
}

/** Upload one file to the selected peer, or to every peer when `broadcast` is set. */
export async function sendFile(file: File, broadcast: boolean): Promise<void> {
  const target = broadcast
    ? (snapshot.state?.peers ?? []).filter(peer => peer.pairedAt !== undefined).map(peer => peer.deviceId)
    : snapshot.selected === null ? [] : [snapshot.selected]
  if (target.length === 0) throw new Error('no peer selected')
  for (const peerId of target) {
    await request(`/upload?peer=${encodeURIComponent(peerId)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
  await refresh()
}

/** Mint this machine's invitation string. */
export async function createInvite(): Promise<{ string: string; expiresAt: number }> {
  return request<{ string: string; expiresAt: number }>('/invite', { method: 'POST' })
}

/** Pair with the machine named by an invitation string. */
export async function pairWith(invitation: string): Promise<void> {
  await request('/pair', { method: 'POST', body: JSON.stringify({ invitation }) })
  await refresh()
}

/** Remove one pair. */
export async function unpairPeer(deviceId: string): Promise<void> {
  await request('/unpair', { method: 'POST', body: JSON.stringify({ deviceId }) })
  publish({ selected: null })
  await refresh()
}

/** Ask the host to run the outbox now. */
export async function retryDelivery(): Promise<void> {
  await request('/retry', { method: 'POST' })
  await refresh()
}

/** Fetch one received file as a blob and hand it to the browser. */
export async function downloadFile(message: ThreadMessage): Promise<void> {
  if (message.file === undefined) return
  const response = await fetch(
    `${API}/file?peer=${encodeURIComponent(message.peerId)}&id=${encodeURIComponent(message.id)}`,
    { credentials: 'same-origin' },
  )
  if (!response.ok) throw new Error(`download failed (HTTP ${String(response.status)})`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = message.file.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 15_000)
}

/**
 * Start freshness: one immediate load, then SSE (instant) with a polling
 * fallback (a dropped stream means "seconds late", never "frozen").
 */
export function startClient(): void {
  if (started || typeof window === 'undefined') return
  started = true
  void refresh()
  window.setInterval(() => {
    if (document.visibilityState !== 'hidden') void refresh()
  }, 5_000)
  window.addEventListener('focus', () => { void refresh() })
  window.addEventListener('online', () => { void refresh() })
  try {
    const source = new EventSource(`${API}/events`)
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { type?: string }
        if (data.type !== 'ready') void refresh()
      } catch {
        // Ignore malformed frames; polling still covers freshness.
      }
    }
  } catch {
    // EventSource unavailable: polling is the fallback.
  }
}

/** React hook over the snapshot. */
export function useInbox(): InboxSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Human-readable byte size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Short relative time for list rows and status lines. */
export function formatTime(at: number, now = Date.now()): string {
  const delta = Math.max(0, now - at)
  if (delta < 60_000) return 'now'
  if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))}m`
  if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))}h`
  return new Date(at).toLocaleDateString()
}
