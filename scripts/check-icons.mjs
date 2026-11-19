#!/usr/bin/env node
/**
 * Pin the DSH icon set this plugin may import.
 *
 * The renderer's slot error boundary *abdicates* an entry when its component
 * throws. A missing icon export renders `undefined` as a component, throws
 * "Element type is invalid", and silently removes the whole sidebar row — the
 * failure observed on the Mac under DSH 0.2.2-rc.3, where the `IconMail*`
 * family does not exist yet (it arrives in rc.4).
 *
 * The allowlist below was verified against rc.3's ui-primitives exports. Add a
 * name only after checking it exists on the OLDEST supported DSH version.
 * Icons the plugin draws itself (src/client/EnvelopeIcon.tsx) are not listed.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Icons verified present in DSH 0.2.2-rc.3. */
const ALLOWED = new Set([
  'IconCheckOutlineRegular',
  'IconCloseOutlineRegular',
  'IconCopyOutlineRegular',
  'IconPaperclipOutlineRegular',
  'IconPlusOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconSendOutlineRegular',
  'IconTrashOutlineRegular',
  'IconWarningTriangleOutlineRegular',
])

const used = new Set()
for (const file of readdirSync(join(root, 'src', 'client'))) {
  if (!/\.(ts|tsx)$/u.test(file)) continue
  const body = readFileSync(join(root, 'src', 'client', file), 'utf8')
  for (const match of body.matchAll(/\bIcon[A-Za-z0-9]+\b/gu)) used.add(match[0])
}

const unknown = [...used].filter(name => !ALLOWED.has(name))
if (unknown.length > 0) {
  console.error('icons not pinned as present on the oldest supported DSH (0.2.2-rc.3):')
  for (const name of unknown) console.error(`  - ${name}`)
  console.error('verify the export exists in rc.3 before adding it to ALLOWED, or draw the icon inline.')
  process.exitCode = 1
} else {
  console.log(`icon check: ${String(used.size)} icon(s) used, all pinned for DSH >= 0.2.2-rc.3`)
}
