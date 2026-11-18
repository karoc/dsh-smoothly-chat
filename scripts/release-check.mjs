#!/usr/bin/env node
/**
 * Release structure gate.
 *
 * It checks what a script *can* check: bilingual README parity, a CHANGELOG
 * entry for the current version, the `files` whitelist matching the working
 * tree, build freshness, a clean tree and (optionally) that the version is not
 * already on npm. It cannot check whether a sentence is true — that walkthrough
 * is a human step documented in CONTRIBUTING.md.
 *
 * Usage: node scripts/release-check.mjs [--allow-dirty] [--no-registry]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { sourceHash } from './lib/source-hash.mjs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const flags = new Set(process.argv.slice(2))
const allowDirty = flags.has('--allow-dirty')
const noRegistry = flags.has('--no-registry')
const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function sectionCount(text, marker) {
  return text.split('\n').filter(line => line.startsWith(marker)).length
}

// ── 1. bilingual README parity ─────────────────────────────────────────────
for (const file of ['README.md', 'README.zh.md']) {
  if (!existsSync(join(root, file))) fail(`missing ${file}`)
}
if (existsSync(join(root, 'README.md')) && existsSync(join(root, 'README.zh.md'))) {
  const en = sectionCount(read('README.md'), '## ')
  const zh = sectionCount(read('README.zh.md'), '## ')
  if (en !== zh) fail(`README section count differs: README.md has ${en}, README.zh.md has ${zh}`)
  else notes.push(`README parity: ${en} sections in both`)
}

// ── 2. CHANGELOG entry for the current version ─────────────────────────────
const pkg = JSON.parse(read('package.json'))
if (!existsSync(join(root, 'CHANGELOG.md'))) {
  fail('missing CHANGELOG.md')
} else {
  const changelog = read('CHANGELOG.md')
  const heading = `## v${pkg.version}`
  const index = changelog.indexOf(heading)
  if (index === -1) {
    fail(`CHANGELOG.md has no "${heading}" entry`)
  } else {
    const rest = changelog.slice(index + heading.length)
    const next = rest.search(/^## /mu)
    const body = (next === -1 ? rest : rest.slice(0, next)).trim()
    const words = body.replace(/[#`*\-\s]/gu, '')
    if (words.length < 60) fail(`CHANGELOG entry for ${pkg.version} is too thin (${words.length} characters)`)
    else notes.push(`CHANGELOG entry for ${pkg.version} present`)
  }
}

// ── 3. files whitelist matches the working tree ────────────────────────────
if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
  fail('package.json "files" whitelist is missing')
} else {
  for (const entry of pkg.files) {
    if (!existsSync(join(root, entry))) fail(`files entry does not exist: ${entry}`)
  }
  for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    if (!pkg.files.includes(required)) fail(`files whitelist is missing ${required}`)
  }
}

// ── 4. loader manifest wiring ──────────────────────────────────────────────
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package.json dsh.bundle.patch is not ./cordis.patch.yml')
if (pkg.dsh?.client === undefined) fail('package.json dsh.client block is missing')
if (existsSync(join(root, 'cordis.patch.yml'))) {
  const patch = read('cordis.patch.yml')
  if (!patch.includes(pkg.name)) fail('cordis.patch.yml does not name the package')
}

// ── 5. build freshness (content stamp, not mtime) ─────────────────────────
const stampPath = join(root, 'lib', 'build-stamp.json')
if (!existsSync(stampPath)) {
  fail('missing lib/build-stamp.json — run npm run bundle')
} else {
  let stamp
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
  } catch {
    fail('lib/build-stamp.json is not valid JSON — run npm run bundle')
  }
  if (stamp !== undefined) {
    const current = sourceHash(root)
    if (stamp.hash !== current.hash) {
      fail('build products are stale relative to src/ — run npm run bundle and commit lib/')
    } else {
      notes.push('lib/ build products match the recorded source hash')
    }
  }
}

// ── 6. clean tree (release mode) ───────────────────────────────────────────
if (!allowDirty) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
    if (status !== '') fail('working tree is not clean')
    else notes.push('working tree is clean')
  } catch {
    notes.push('git unavailable: clean-tree check skipped')
  }
}

// ── 7. version not already published ───────────────────────────────────────
if (!noRegistry) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name).replace('%40', '@')}`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (response.status === 200) {
      const document = await response.json()
      if (document.versions?.[pkg.version] !== undefined) {
        fail(`${pkg.name}@${pkg.version} is already published — bump the version`)
      } else {
        notes.push(`${pkg.name}@${pkg.version} is not published yet`)
      }
    } else if (response.status === 404) {
      notes.push(`${pkg.name} is not on npm yet — safe to publish`)
    } else {
      notes.push(`registry answered ${response.status}: publish state not checked`)
    }
  } catch {
    notes.push('registry unreachable: publish state not checked')
  }
}

// ── report ─────────────────────────────────────────────────────────────────
console.log(`release-check ${pkg.name}@${pkg.version}`)
for (const note of notes) console.log(`  ok   ${note}`)
for (const failure of failures) console.log(`  FAIL ${failure}`)
if (failures.length === 0) {
  console.log('release check passed')
} else {
  console.log(`${failures.length} check(s) failed`)
  process.exitCode = 1
}
