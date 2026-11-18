/**
 * Content hash over every source file — shared by the build stamp and the
 * release gate so "stale build" is a deterministic question rather than an
 * mtime comparison (a clone gives every file the checkout time).
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Sorted list of source files under `<root>/src`. */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      sourceFiles(path, out)
      continue
    }
    if (!/\.(ts|tsx)$/u.test(entry.name)) continue
    out.push(path)
  }
  return out
}

/**
 * Hash every `.ts`/`.tsx` file under `<root>/src`.
 * @param root - repository root.
 * @returns the digest and the sorted relative file list.
 */
export function sourceHash(root) {
  const files = sourceFiles(join(root, 'src'))
    .map(path => ({ path: relative(root, path).split('\\').join('/'), body: readFileSync(path) }))
    .sort((left, right) => left.path.localeCompare(right.path))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.path)
    hash.update('\u0000')
    hash.update(file.body)
    hash.update('\u0000')
  }
  return { hash: hash.digest('hex'), files: files.map(file => file.path) }
}
