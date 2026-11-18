/**
 * Client half of DSH Smoothly Chat (思磨力讯).
 *
 * Registers two additive slots and nothing else:
 *  - `sidebar.panellist` — the mail icon (with unread dot) that opens the panel;
 *  - `main` — the mailbox page itself, keyed by the same panel id.
 *
 * No conversation slot, no session scope: the panel cannot read or write a
 * conversation even by accident.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only imports pull the slot declarations these registrations ride on.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Module-top-level side effect: design-token styles for the panel.
import './styles.ts'
import { InboxPage, type InboxPageProps } from './InboxPage.tsx'
import { InboxIcon, type InboxIconProps } from './InboxIcon.tsx'
import { startClient } from './state.ts'
import { en, NS, zh, type ChatKey } from './locales.ts'

/** Panel id; the sidebar row and the main panel share it. */
const PANEL_ID = 'smoothly-chat' as MainPanelId

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Smoothly Chat panel copy. */
    'smoothly.chat': ChatKey
  }
}

/** Required client services: additive slots and the locale registry. */
export const inject = ['slots', 'locale']

/** Client entry point. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'smoothly-chat: locale')

  const t = ctx.locale.bind(NS)
  // `slots.inject` owns its own effect/disposal — do not wrap it in ctx.effect.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, InboxPage as unknown as never))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 45,
    locale: NS,
    label: () => t('panel'),
  }, InboxIcon as unknown as never))

  // Freshness starts with the plugin, not with the panel: the unread dot has to
  // be right while the user is looking at a conversation.
  startClient()
}

/** Kept for the type checker: both component prop shapes are exported. */
export type { InboxPageProps, InboxIconProps }
