/**
 * DSH Smoothly Chat (思磨力讯) — host half.
 *
 * Phase 1 wires the mailbox (ChatNode) into the DSH process. Phase 2 adds the
 * same-origin `/smoothly-chat/api` routes the panel talks to; the peer-facing
 * listener is owned by ChatNode and never shares DSH's web server.
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-smoothly-chat'

export const inject: string[] = []

/** Host entry point; the adapter is filled in by the next phase. */
export function apply(_ctx: Context): void {
  // Intentionally empty for now: the core (lib/core.js) is exercised by the
  // repository's E2E scripts before the DSH adapter is wired.
}
