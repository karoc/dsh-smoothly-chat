/**
 * DSH Smoothly Chat (思磨力讯) — host half.
 *
 * Owns two surfaces:
 *  - the peer-facing mailbox listener (ChatNode), on its own port and never
 *    sharing DSH's web server, so opening the LAN cannot reach an agent;
 *  - the same-origin `/smoothly-chat/api` routes the panel talks to, registered
 *    on DSH's web server and therefore behind its normal authentication.
 *
 * Data lives in `~/.dsh/smoothly-chat` (override: DSH_SMOOTHLY_CHAT_DIR).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ChatNode, createApiHandler, type ApiHandler } from './core/public.ts'

export const name = 'dsh-smoothly-chat'

export const inject = ['webServer']

/** Structural view of the host web server service (external bundles keep this dependency type-only). */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse, peer?: unknown) => void
  }): () => void
}

/** Resolve the mailbox data root. */
function dataRoot(): string {
  return process.env.DSH_SMOOTHLY_CHAT_DIR ?? join(homedir(), '.dsh', 'smoothly-chat')
}

/** Resolve the peer-server port. */
function peerPort(): number {
  const raw = Number(process.env.DSH_SMOOTHLY_CHAT_PORT ?? '47810')
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 47810
}

/** Host entry point. */
export function apply(ctx: Context): void {
  let node: ChatNode | undefined
  let api: ApiHandler | undefined

  const boot = (async (): Promise<ChatNode> => {
    const created = await ChatNode.create({
      root: dataRoot(),
      port: peerPort(),
      ...(process.env.DSH_SMOOTHLY_CHAT_BIND === undefined ? {} : { bindHost: process.env.DSH_SMOOTHLY_CHAT_BIND }),
      ...(process.env.DSH_SMOOTHLY_CHAT_NAME === undefined ? {} : { name: process.env.DSH_SMOOTHLY_CHAT_NAME }),
      logger: line => { console.log(line) },
    })
    node = created
    api = createApiHandler(created)
    try {
      await created.start()
    } catch (error) {
      // The mailbox API stays up so the panel can explain the failure instead
      // of the whole feature disappearing behind a missing route.
      console.error(`[smoothly-chat] peer server failed to start: ${error instanceof Error ? error.message : String(error)}`)
    }
    return created
  })()

  ctx.inject(['webServer'], (scope) => {
    const server = scope.get('webServer') as WebServerLike | undefined
    if (server === undefined) return
    scope.effect(() => server.register({
      kind: 'prefix',
      path: '/smoothly-chat/api',
      handler: (req, res) => {
        void boot
          .then(() => { api?.(req, res) })
          .catch((error: unknown) => {
            if (res.writableEnded) return
            res.statusCode = 503
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
          })
      },
    }), 'smoothly-chat: /smoothly-chat/api')
  })

  ctx.effect(() => () => {
    api?.dispose()
    void node?.stop()
  }, 'smoothly-chat: lifecycle')
}
