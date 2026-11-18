/**
 * Same-origin UI API for DSH Smoothly Chat.
 *
 * These routes are registered on DSH's own web server (so the page talks to its
 * own origin with the normal boot token) and only manipulate the local mailbox.
 * The peer-facing listener is a different server entirely; nothing here is
 * reachable from another machine.
 *
 * The handler is deliberately DSH-free (plain node:http) so the repository
 * scripts can mount it on a throwaway server and test it end to end.
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ChatNode } from './node.ts'
import type { ThreadMessage } from './types.ts'

/** Default ceiling for one uploaded file. */
const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
/** Ceiling for JSON request bodies. */
const MAX_JSON_BYTES = 2 * 1024 * 1024

/** One API failure mapped to an HTTP response. */
class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return
  const text = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', String(Buffer.byteLength(text)))
  res.end(text)
}

/** Read and parse a JSON body with a hard ceiling. */
async function readJson<T>(req: IncomingMessage, limit = MAX_JSON_BYTES): Promise<T> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw new ApiError(413, 'request body is too large')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const bytes = chunk as Buffer
    total += bytes.length
    if (total > limit) throw new ApiError(413, 'request body is too large')
    chunks.push(bytes)
  }
  if (total === 0) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new ApiError(400, 'request body must be JSON')
  }
}

/** Public view of a peer: never leaks the pair key. */
function publicPeer(peer: {
  deviceId: string; name: string; host: string; port: number; addedAt: number
  pairedAt?: number; lastSeenAt?: number; lastError?: string
}, extras: { unread: number; reachable: boolean }): Record<string, unknown> {
  return {
    deviceId: peer.deviceId,
    name: peer.name,
    host: peer.host,
    port: peer.port,
    addedAt: peer.addedAt,
    ...(peer.pairedAt === undefined ? {} : { pairedAt: peer.pairedAt }),
    ...(peer.lastSeenAt === undefined ? {} : { lastSeenAt: peer.lastSeenAt }),
    ...(peer.lastError === undefined ? {} : { lastError: peer.lastError }),
    unread: extras.unread,
    reachable: extras.reachable,
  }
}

/** A mounted API handler plus its disposer. */
export interface ApiHandler {
  (req: IncomingMessage, res: ServerResponse): void
  /** Release the SSE fan-out when the host plugin unloads. */
  dispose(): void
}

/** Options for {@link createApiHandler}. */
export interface ApiHandlerOptions {
  /** Route prefix owned by the host adapter. */
  prefix?: string
  maxUploadBytes?: number
  now?: () => number
}

/**
 * Build the request handler. The caller owns authentication (DSH's route
 * policy) and the route prefix registration.
 */
export function createApiHandler(node: ChatNode, options: ApiHandlerOptions = {}): ApiHandler {
  const prefix = options.prefix ?? '/smoothly-chat/api'
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES
  const now = options.now ?? (() => Date.now())
  const streams = new Set<ServerResponse>()

  // Fan mailbox events out to every open SSE stream.
  const unsubscribe = node.subscribe((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const stream of streams) {
      if (stream.writableEnded || stream.destroyed) {
        streams.delete(stream)
        continue
      }
      stream.write(payload)
    }
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://smoothly-chat.local')
    if (!url.pathname.startsWith(prefix)) throw new ApiError(404, 'not found')
    const route = url.pathname.slice(prefix.length).replace(/\/+$/u, '') || '/'
    const method = req.method ?? 'GET'

    if (route === '/state' && method === 'GET') {
      const unread = node.store.unreadCounts()
      const presence = node.presenceSnapshot()
      const addresses = node.addresses()
      const peers = node.store.peers().map(peer => publicPeer(peer, {
        unread: unread[peer.deviceId] ?? 0,
        reachable: presence[peer.deviceId]?.reachable ?? false,
      }))
      sendJson(res, 200, {
        ok: true,
        protocolVersion: 1,
        self: { ...node.self, port: node.port },
        addresses,
        lanReachable: addresses.some(row => !row.internal && row.scope === 'private'),
        peers,
        settings: { port: node.port, maxUploadBytes },
        serverError: node.lastError ?? null,
      })
      return
    }

    if (route === '/invite' && method === 'POST') {
      sendJson(res, 200, { ok: true, ...await node.invite() })
      return
    }

    if (route === '/pair' && method === 'POST') {
      const body = await readJson<{ invitation?: string }>(req)
      if (typeof body.invitation !== 'string' || body.invitation.trim() === '') {
        throw new ApiError(400, 'invitation is required')
      }
      const peer = await node.pair(body.invitation.trim())
      sendJson(res, 200, { ok: true, peer: publicPeer(peer, { unread: 0, reachable: false }) })
      return
    }

    if (route === '/unpair' && method === 'POST') {
      const body = await readJson<{ deviceId?: string }>(req)
      if (typeof body.deviceId !== 'string' || body.deviceId === '') throw new ApiError(400, 'deviceId is required')
      await node.unpair(body.deviceId)
      sendJson(res, 200, { ok: true })
      return
    }

    if (route === '/send' && method === 'POST') {
      const body = await readJson<{ peerIds?: string[]; text?: string }>(req)
      const text = typeof body.text === 'string' ? body.text : ''
      if (text.trim() === '') throw new ApiError(400, 'text is required')
      const peerIds = Array.isArray(body.peerIds) && body.peerIds.length > 0
        ? body.peerIds.filter((id): id is string => typeof id === 'string')
        : node.store.peers().filter(peer => peer.pairedAt !== undefined).map(peer => peer.deviceId)
      if (peerIds.length === 0) throw new ApiError(400, 'no paired peer to send to')
      const sent = await node.sendText(peerIds, text)
      sendJson(res, 200, { ok: true, batchId: sent.batchId, ids: sent.messages.map(message => message.id) })
      return
    }

    if (route === '/upload' && method === 'POST') {
      const peerId = url.searchParams.get('peer') ?? ''
      const rawName = url.searchParams.get('name') ?? 'file'
      if (peerId === '') throw new ApiError(400, 'peer is required')
      const declared = Number(req.headers['content-length'])
      if (Number.isFinite(declared) && declared > maxUploadBytes) throw new ApiError(413, 'file is too large')
      const staged = node.store.tmpPath(`upload-${Date.now().toString(36)}`)
      let received = 0
      try {
        await pipeline(
          req,
          async function* (source: AsyncIterable<Buffer>) {
            for await (const chunk of source) {
              received += chunk.length
              if (received > maxUploadBytes) throw new ApiError(413, 'file is too large')
              yield chunk
            }
          },
          createWriteStream(staged, { mode: 0o600 }),
        )
        const sent = await node.sendFile([peerId], staged, rawName)
        sendJson(res, 200, { ok: true, batchId: sent.batchId, ids: sent.messages.map(message => message.id) })
      } catch (error) {
        await rm(staged, { force: true })
        throw error
      }
      return
    }

    if (route === '/thread' && method === 'GET') {
      const peerId = url.searchParams.get('peer') ?? ''
      if (peerId === '') throw new ApiError(400, 'peer is required')
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? '200') || 200))
      const beforeRaw = url.searchParams.get('before')
      const before = beforeRaw === null ? undefined : Number(beforeRaw)
      const messages = await node.store.readThread(peerId, {
        limit,
        ...(before !== undefined && Number.isFinite(before) && before > 0 ? { beforeSeq: before } : {}),
      })
      const peer = node.store.peer(peerId)
      sendJson(res, 200, {
        ok: true,
        peer: peer === undefined ? null : publicPeer(peer, { unread: node.store.unreadCounts()[peerId] ?? 0, reachable: false }),
        messages,
      })
      return
    }

    if (route === '/read' && method === 'POST') {
      const body = await readJson<{ peerId?: string }>(req)
      if (typeof body.peerId !== 'string' || body.peerId === '') throw new ApiError(400, 'peerId is required')
      await node.store.markRead(body.peerId)
      sendJson(res, 200, { ok: true })
      return
    }

    if (route === '/retry' && method === 'POST') {
      await node.flush()
      sendJson(res, 200, { ok: true })
      return
    }

    if (route === '/file' && method === 'GET') {
      const peerId = url.searchParams.get('peer') ?? ''
      const id = url.searchParams.get('id') ?? ''
      if (peerId === '' || id === '') throw new ApiError(400, 'peer and id are required')
      const message: ThreadMessage | undefined = await node.store.messageById(peerId, id)
      if (message?.file === undefined) throw new ApiError(404, 'file not found')
      const path = join(node.store.fileDir(id), message.file.name)
      const info = await stat(path).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw new ApiError(404, 'file not found')
      res.statusCode = 200
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-length', String(info.size))
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(message.file.name)}`)
      await pipeline(createReadStream(path), res).catch(() => {})
      return
    }

    if (route === '/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write('retry: 3000\n\n')
      res.write(`data: ${JSON.stringify({ type: 'ready', at: now() })}\n\n`)
      streams.add(res)
      const heartbeat = setInterval(() => {
        if (res.writableEnded || res.destroyed) return
        res.write(': keep-alive\n\n')
      }, 20_000)
      heartbeat.unref?.()
      const close = (): void => {
        clearInterval(heartbeat)
        streams.delete(res)
      }
      req.on('close', close)
      res.on('close', close)
      return
    }

    if (route === '/settings' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        settings: { name: node.self.name, port: node.port, maxUploadBytes },
      })
      return
    }

    if (route === '/settings' && method === 'POST') {
      const body = await readJson<{ name?: string }>(req)
      if (typeof body.name === 'string' && body.name.trim() !== '') await node.store.setName(body.name)
      sendJson(res, 200, { ok: true, settings: { name: node.self.name, port: node.port, maxUploadBytes } })
      return
    }

    throw new ApiError(404, `unknown route ${method} ${route}`)
  }

  const mounted = ((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((error: unknown) => {
      const status = error instanceof ApiError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      if (status >= 500) console.error('[smoothly-chat] api error:', error)
      sendJson(res, status, { ok: false, error: message })
      req.resume()
    })
  }) as ApiHandler
  mounted.dispose = () => {
    unsubscribe()
    for (const stream of streams) {
      try {
        stream.end()
      } catch {
        // Already closed.
      }
    }
    streams.clear()
  }
  return mounted
}
