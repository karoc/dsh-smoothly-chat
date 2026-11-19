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
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ChatNode, createApiHandler, type ApiHandler, type UpdateInfo } from './core/public.ts'

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

/**
 * Resolve the mailbox data root. It follows DSH_HOME (the desktop app keeps its
 * own runtime home, so the mailbox must not leak into ~/.dsh there), with an
 * explicit DSH_SMOOTHLY_CHAT_DIR winning over everything.
 */
function dataRoot(): string {
  const explicit = process.env.DSH_SMOOTHLY_CHAT_DIR
  if (explicit !== undefined && explicit.trim() !== '') return explicit
  const home = process.env.DSH_HOME?.trim()
  const base = home === undefined || home === '' ? join(homedir(), '.dsh') : home
  return join(base, 'smoothly-chat')
}

/** Resolve the peer-server port. */
function peerPort(): number {
  const raw = Number(process.env.DSH_SMOOTHLY_CHAT_PORT ?? '47811')
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 47811
}

/** Repository the update check compares against. */
const REPOSITORY = 'karoc/dsh-smoothly-chat'

/** Cached update answer, so a curious click cannot burn the anonymous rate limit. */
let updateCache: { at: number; value: UpdateInfo } | undefined

/**
 * Compare the installed build stamp (version + git commit baked at build time)
 * with the repository's current main. Read-only: it never installs anything.
 */
async function checkUpdate(): Promise<UpdateInfo> {
  const now = Date.now()
  if (updateCache !== undefined && now - updateCache.at < 10 * 60_000) return updateCache.value
  let installed: UpdateInfo['installed'] = { version: 'unknown' }
  try {
    const stamp = JSON.parse(await readFile(new URL('./build-stamp.json', import.meta.url), 'utf8')) as {
      commit?: string
      builtAt?: string
      package?: { version?: string }
    }
    installed = {
      version: stamp.package?.version ?? 'unknown',
      ...(stamp.commit === undefined ? {} : { commit: stamp.commit }),
      ...(stamp.builtAt === undefined ? {} : { builtAt: stamp.builtAt }),
    }
  } catch {
    // A hand-built copy may lack the stamp; the answer then names only the version.
  }
  let value: UpdateInfo
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-smoothly-chat' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}`)
    const data = await response.json() as { sha: string; commit?: { author?: { date?: string }; message?: string } }
    value = {
      installed,
      latest: {
        commit: data.sha,
        ...(data.commit?.author?.date === undefined ? {} : { date: data.commit.author.date }),
        ...(data.commit?.message === undefined ? {} : { message: data.commit.message.split('\n')[0] }),
      },
      upToDate: installed.commit !== undefined && data.sha === installed.commit,
    }
  } catch (error) {
    value = { installed, upToDate: false, error: error instanceof Error ? error.message : String(error) }
  }
  updateCache = { at: now, value }
  return value
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
    api = createApiHandler(created, { updateSource: checkUpdate })
    console.log(`[smoothly-chat] mailbox root: ${dataRoot()} (device ${created.self.deviceId.slice(0, 8)}…)`)
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
