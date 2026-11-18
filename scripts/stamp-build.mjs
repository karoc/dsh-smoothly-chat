#!/usr/bin/env node
/** Write the build stamp that release-check compares against src/. */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceHash } from './lib/source-hash.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { hash, files } = sourceHash(root)
const stamp = { version: 1, hash, files, builtAt: new Date().toISOString() }
writeFileSync(join(root, 'lib', 'build-stamp.json'), `${JSON.stringify(stamp, null, 2)}\n`)
console.log(`build stamp: ${hash.slice(0, 12)}… (${String(files.length)} source files)`)
