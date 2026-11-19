/**
 * Sidebar entry for Smoothly Chat: a mail icon with an unread dot.
 *
 * The icon lives in a list slot that stays mounted while another panel is open,
 * so it is the one place the unread count is always visible — which is exactly
 * why freshness starts in the plugin entry rather than on first panel mount.
 */

import { EnvelopeIcon } from './EnvelopeIcon.tsx'
import { useInbox } from './state.ts'

/** Props the global panel row supplies to its icon entry. */
export interface InboxIconProps {
  /** Requested square edge in pixels. */
  size?: number
  /** Whether this panel is selected in the main column. */
  active?: boolean
}

/** The sidebar icon. */
export function InboxIcon({ size = 18 }: InboxIconProps) {
  const snapshot = useInbox()
  const unread = (snapshot.state?.peers ?? []).reduce((sum, peer) => sum + peer.unread, 0)
  const pendingRequests = snapshot.state?.requests?.length ?? 0
  return (
    <span className="dsc-icon" title={unread > 0 ? String(unread) : undefined}>
      <EnvelopeIcon size={size} />
      {(unread > 0 || pendingRequests > 0) && <span className="dsc-icon-dot" />}
    </span>
  )
}
