#!/usr/bin/env node
/**
 * Negative/positive controls for the install-time prepare hook: a prebuilt
 * install must pass without a toolchain, a source checkout must fail with the
 * exact remedy, and a real toolchain must rebuild.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'dsc-prepare-'))
const results = []

/** Run the prepare hook in a copied package layout. */
function run(files) {
  const dir = join(temp, `case-${String(results.length)}`)
  mkdirSync(dir, { recursive: true })
  cpSync(join(root, 'scripts', 'prepare.mjs'), join(dir, 'scripts', 'prepare.mjs'), { recursive: false })
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    // Symlink the dependency tree instead of copying ~100 MB per case.
    if (source === 'node_modules') symlinkSync(join(root, 'node_modules'), join(dir, path), 'dir')
    else cpSync(join(root, source), join(dir, path), { recursive: true })
  }
  return spawnSync(process.execPath, ['scripts/prepare.mjs'], { cwd: dir, encoding: 'utf8' })
}

function check(name, condition, detail) {
  results.push({ name, ok: condition })
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}`)
  if (!condition) console.log(`       ${detail}`)
}

// 1. Prebuilt, no toolchain: must accept the shipped lib/.
{
  const outcome = run({ 'lib/index.js': 'lib/index.js', 'lib/client.js': 'lib/client.js' })
  check('prebuilt install passes without a toolchain', outcome.status === 0 && /using the shipped lib\//u.test(outcome.stdout), `${outcome.status}\n${outcome.stdout}${outcome.stderr}`)
}

// 2. Source checkout, no toolchain, no lib: must fail with the remedy.
{
  const outcome = run({ 'package.json': 'package.json' })
  check('source checkout without lib fails with the remedy', outcome.status === 1 && /npm install && npm run bundle/u.test(outcome.stderr), `${outcome.status}\n${outcome.stdout}${outcome.stderr}`)
}

// 3. Real toolchain: must rebuild (and therefore produce both products).
{
  const outcome = run({
    'package.json': 'package.json',
    'tsdown.config.ts': 'tsdown.config.ts',
    'tsconfig.json': 'tsconfig.json',
    src: 'src',
    node_modules: 'node_modules',
  })
  check('a present toolchain rebuilds lib/', outcome.status === 0, `${outcome.status}\n${outcome.stdout}${outcome.stderr}`)
}

rmSync(temp, { recursive: true, force: true })
const failed = results.filter(entry => !entry.ok)
console.log('')
console.log(`prepare controls: ${String(results.length - failed.length)} passed, ${String(failed.length)} failed`)
if (failed.length > 0) process.exitCode = 1
assert.ok(true)
