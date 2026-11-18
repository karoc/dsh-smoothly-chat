#!/usr/bin/env node
/**
 * Build-on-install hook that does not punish prebuilt installs.
 *
 * Three situations must all succeed or fail *clearly*:
 *  - a git dependency: pnpm installs devDependencies, then runs this — build;
 *  - a local directory install: no toolchain and no devDependencies there, but
 *    `lib/` travelled with the directory — accept the prebuilt output;
 *  - a source checkout without either — fail with the exact command to run.
 *
 * Publishing a tarball never runs this hook (npm excludes it from lifecycle on
 * installed tarballs), so published users need no toolchain at all.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const hasToolchain = existsSync('node_modules/tsdown')
const hasOutput = existsSync('lib/index.js') && existsSync('lib/client.js')

if (hasToolchain) {
  const result = spawnSync(process.execPath, ['node_modules/tsdown/dist/run.mjs', '--config', './tsdown.config.ts'], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('dsh-smoothly-chat: build failed')
    process.exit(result.status ?? 1)
  }
  process.exit(0)
}

if (hasOutput) {
  console.log('dsh-smoothly-chat: using the shipped lib/ (no build toolchain present)')
  process.exit(0)
}

console.error('dsh-smoothly-chat: lib/ is missing and no build toolchain is installed.')
console.error('dsh-smoothly-chat: run `npm install && npm run bundle` in the package, or install the published tarball.')
process.exit(1)
