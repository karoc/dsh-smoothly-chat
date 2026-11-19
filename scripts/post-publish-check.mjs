#!/usr/bin/env node
/**
 * Post-publish check.
 *
 * The npm registry is eventually consistent: `npm publish` prints
 * `+ pkg@version` while the index can still be catching up, and a brand-new
 * package first appears with an npm-internal `0.0.0-stage` placeholder before
 * the real version lands. This script therefore reads the version document
 * (not only the tarball), ignores the staging placeholder, retries with a
 * visible progress line, and reports one of three states:
 *
 *   published          → the version is in the index and its tarball is served
 *   registered         → the version is indexed but the tarball is not served
 *                        yet: still propagating — do NOT republish
 *   not visible        → nothing to confirm yet; rerun later (a publish that
 *                        printed `+ pkg@version` is not lost)
 *
 * Exit codes: 0 when published or registered; 0 for "not visible" unless
 * `--strict` (CI mode) is passed.
 *
 * Usage: node scripts/post-publish-check.mjs [--strict] [--wait <seconds>]
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const flags = process.argv.slice(2)
const strict = flags.includes('--strict')
const waitIndex = flags.indexOf('--wait')
const waitSeconds = waitIndex === -1 ? 0 : Number(flags[waitIndex + 1] ?? '0')

const registry = 'https://registry.npmjs.org'
const name = pkg.name
const version = pkg.version
const documentUrl = `${registry}/${name.startsWith('@') ? `@${name.slice(1).replace('/', '%2F')}` : name}`

/** GET with a short timeout; undefined means the request itself failed. */
async function getJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status !== 200) return { status: response.status }
    return { status: 200, body: await response.json() }
  } catch {
    return { status: 0 }
  }
}

/** HEAD a deterministic URL; 405/501 fall back to a ranged GET. */
async function probeTarball(url) {
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) })
    if (head.status === 200) return 200
    if (head.status !== 405 && head.status !== 501) return head.status
  } catch {
    return 0
  }
  try {
    const ranged = await fetch(url, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(10_000) })
    return ranged.status === 206 || ranged.status === 200 ? 200 : ranged.status
  } catch {
    return 0
  }
}

/** One consistency read. */
async function checkOnce() {
  const document = await getJson(documentUrl)
  if (document.status === 0) return { state: 'network' }
  if (document.status !== 200) return { state: 'invisible', status: document.status }
  const versions = document.body?.versions ?? {}
  const record = versions[version]
  if (record === undefined) return { state: 'invisible', status: 200 }
  const latest = document.body?.['dist-tags']?.latest
  const tarball = record.dist?.tarball
  if (typeof tarball !== 'string') return { state: 'registered', latest }
  const status = await probeTarball(tarball)
  if (status !== 200) return { state: 'registered', latest, tarballStatus: status }
  return { state: 'published', latest, tarball }
}

const started = Date.now()
const deadline = started + waitSeconds * 1000
let attempt = 0
let result = await checkOnce()
while (result.state !== 'published' && Date.now() < deadline) {
  attempt += 1
  const waited = Math.round((Date.now() - started) / 1000)
  console.log(`waiting for the registry index — retry ${String(attempt)} (${String(waited)}s)`)
  await new Promise(resolve => setTimeout(resolve, 5_000))
  result = await checkOnce()
}

if (result.state === 'published') {
  console.log(`${name}@${version} is published${result.latest === version ? ' and is the latest tag' : ''}`)
  process.exitCode = 0
} else if (result.state === 'registered') {
  console.log(`${name}@${version} is in the index but its tarball is not served yet — the registry is still propagating. Do NOT republish; rerun this check later.`)
  process.exitCode = strict ? 1 : 0
} else if (result.state === 'network') {
  console.log(`could not reach the npm registry — publish state not checked; rerun later.`)
  process.exitCode = strict ? 1 : 0
} else {
  console.log(`${name}@${version} is not visible yet — the index is catching up. A publish that printed "+ ${name}@${version}" is not lost; rerun this check in a few minutes.`)
  process.exitCode = strict ? 1 : 0
}
