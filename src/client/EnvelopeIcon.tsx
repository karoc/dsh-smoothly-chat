/**
 * Inline envelope icon.
 *
 * Deliberately NOT a `@deepseek-ai/dsh-client-ui-primitives` icon: the mail
 * family only exists from DSH 0.2.2-rc.4 on, and we support ^0.2.2-rc.3. A
 * missing export renders `undefined` as a component, React throws, and the
 * renderer's slot error boundary **abdicates** the whole sidebar entry — the
 * silent "installed but invisible" failure observed on the Mac (rc.3).
 *
 * Drawing it here keeps the entry alive on every supported DSH version; the
 * other icons we use were verified present in rc.3 and are pinned by
 * `scripts/check-icons.mjs`.
 */

/** Props for {@link EnvelopeIcon}. */
export interface EnvelopeIconProps {
  /** Square edge in pixels. */
  size?: number
}

/** A 24-unit stroke envelope that follows the current text color. */
export function EnvelopeIcon({ size = 18 }: EnvelopeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7.2 7.1 5.1a1.6 1.6 0 0 0 1.8 0L20 7.2" />
    </svg>
  )
}
