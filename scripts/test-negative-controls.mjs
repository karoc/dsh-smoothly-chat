#!/usr/bin/env node
/**
 * Negative controls for the release gate.
 *
 * A gate nobody has seen fail is not evidence. This script clones the committed
 * repository into a temp directory, restores the (gitignored) build products,
 * and injects one defect per scenario; each scenario must make
 * `scripts/release-check.mjs` exit non-zero *and* mention the expected reason.
 * A final positive control proves the untouched clone passes — otherwise every
 * scenario could be "failing" for an unrelated reason.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'dsc-controls-'))
const clone = join(temp, 'repo')
const results = []

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Restore the clone to the committed state plus the build products. */
function reset() {
  git(['checkout', '--', '.'], clone)
  git(['clean', '-fdq'], clone)
  rmSync(join(clone, 'lib'), { recursive: true, force: true })
  cpSync(join(root, 'lib'), join(clone, 'lib'), { recursive: true })
}

function scenario(name, mutate, expected, extraFlags = ['--allow-dirty']) {
  reset()
  mutate()
  const outcome = run('node', [join(clone, 'scripts', 'release-check.mjs'), '--no-registry', ...extraFlags], clone)
  const output = `${outcome.stdout}\n${outcome.stderr}`
  const red = outcome.status !== 0
  const reason = output.includes(expected)
  const ok = red && reason
  results.push({ name, ok, red, reason, output })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) {
    console.log(`       expected the gate to fail mentioning: ${expected}`)
    console.log(`       gate exited ${outcome.status}; tail:\n${output.trim().split('\n').slice(-4).map(line => `       ${line}`).join('\n')}`)
  }
}

// ── prepare ────────────────────────────────────────────────────────────────
console.log('negative controls: release gate')
if (existsSync(join(root, '.git')) === false) {
  console.error('  FAIL not a git repository — controls need a committed HEAD')
  process.exit(1)
}
git(['clone', '--no-hardlinks', '--quiet', root, clone], temp)
reset()

// ── positive control ───────────────────────────────────────────────────────
{
  const outcome = run('node', [join(clone, 'scripts', 'release-check.mjs'), '--no-registry', '--allow-dirty'], clone)
  const ok = outcome.status === 0
  results.push({ name: 'positive control (clean clone passes)', ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} positive control (clean clone passes)`)
  if (!ok) console.log(`${outcome.stdout}\n${outcome.stderr}`)
}

// ── defect scenarios ───────────────────────────────────────────────────────
scenario('dirty working tree is refused', () => {
  const path = join(clone, 'README.md')
  writeFileSync(path, `${readFileSync(path, 'utf8')}\nlocal edit\n`)
}, 'working tree is not clean', [])

scenario('README section drift is refused', () => {
  const path = join(clone, 'README.zh.md')
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  const index = lines.findIndex(line => line.startsWith('## '))
  lines.splice(index, 1)
  writeFileSync(path, lines.join('\n'))
}, 'README section count differs')

scenario('missing CHANGELOG entry is refused', () => {
  const path = join(clone, 'CHANGELOG.md')
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, text.replace(/^## v[^\n]*$/mu, '## v0.0.0'))
}, 'has no "## v')

scenario('stale build products are refused', () => {
  const path = join(clone, 'src', 'core', 'protocol.ts')
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, `${text}\n// touch\n`)
  const now = new Date()
  execFileSync('touch', ['-d', new Date(now.getTime() + 60_000).toISOString(), path])
}, 'build products are stale')

scenario('a missing build product is refused', () => {
  rmSync(join(clone, 'lib', 'client.js'), { force: true })
}, 'missing build product lib/client.js')

scenario('a bogus files entry is refused', () => {
  const path = join(clone, 'package.json')
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  pkg.files.push('does-not-exist.txt')
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, { mode: 0o600 })
}, 'files entry does not exist: does-not-exist.txt')

scenario('a patch file that does not name the package is refused', () => {
  writeFileSync(join(clone, 'cordis.patch.yml'), '- insert:\n    - id: something-else\n      name: something-else\n')
}, 'cordis.patch.yml does not name the package')

scenario('a split chunk that is not shipped is refused', () => {
  const chunk = join(clone, 'lib', 'public-deadbeef.js')
  writeFileSync(chunk, 'export const x = 1\n')
  const path = join(clone, 'lib', 'index.js')
  writeFileSync(path, `${readFileSync(path, 'utf8')}\nimport './public-deadbeef.js'\n`)
}, 'which is not in the files whitelist')

scenario('a missing relative dependency is refused', () => {
  const path = join(clone, 'lib', 'index.js')
  writeFileSync(path, `${readFileSync(path, 'utf8')}\nimport './missing-chunk.js'\n`)
}, 'which does not exist')

// ── summary ────────────────────────────────────────────────────────────────
rmSync(temp, { recursive: true, force: true })
const failed = results.filter(entry => !entry.ok)
console.log('')
console.log(`controls: ${String(results.length - failed.length)} passed, ${String(failed.length)} failed`)
if (failed.length > 0) process.exitCode = 1
