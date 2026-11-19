#!/usr/bin/env node
/** Write the build stamp that release-check compares against src/. */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceHash } from './lib/source-hash.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { hash, files } = sourceHash(root)
let commit
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
} catch {
  commit = undefined
}
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
const stamp = {
  version: 1,
  hash,
  files,
  builtAt: new Date().toISOString(),
  ...(commit === undefined ? {} : { commit }),
  package: { name: pkg.name, version: pkg.version },
}
writeFileSync(join(root, 'lib', 'build-stamp.json'), `${JSON.stringify(stamp, null, 2)}\n`)
console.log(`build stamp: ${hash.slice(0, 12)}… (${String(files.length)} source files)`)
