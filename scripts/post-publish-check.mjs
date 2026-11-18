#!/usr/bin/env node
/**
 * Post-publish check.
 *
 * The npm registry is eventually consistent: `npm publish` can print
 * `+ pkg@version` while the version document and tarball still 404 for minutes
 * (observed from ~4 minutes to ~2 hours). This script probes the *deterministic*
 * tarball URL — not the package document, which is the wrong signal — and
 * reports three states:
 *
 *   tarball present                     → published (exit 0)
 *   tarball missing, package doc present → ambiguous: still indexing (exit 0,
 *                                          or 1 with --strict so CI can gate)
 *   tarball and package doc both missing → not confirmed (exit 1)
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
const version = pkg.version
const name = pkg.name
const escaped = name.startsWith('@') ? `@${name.slice(1).replace('/', '%2F')}` : encodeURIComponent(name)
const basename = name.startsWith('@') ? name.split('/')[1] : name
const tarballUrl = `${registry}/${escaped}/-/${basename}-${version}.tgz`
const documentUrl = `${registry}/${escaped}`

async function probe(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) })
    return response.status
  } catch {
    return 0
  }
}

async function attempt() {
  const tarball = await probe(tarballUrl)
  if (tarball === 200) {
    console.log(`${name}@${version} is published (tarball is served)`)
    return true
  }
  const document = await probe(documentUrl)
  if (tarball === 404 && document === 200) {
    console.log(`${name}@${version}: package document is visible but the tarball is not yet — the registry is still indexing. Do NOT republish; rerun this check later.`)
    return !strict
  }
  if (tarball === 404 && document === 404) {
    console.log(`${name}@${version}: neither the version nor the package is visible — publish not confirmed. Check the publish log before retrying.`)
    return false
  }
  console.log(`${name}@${version}: registry answered tarball=${String(tarball)} document=${String(document)} — cannot judge; rerun later.`)
  return !strict
}

let ok = await attempt()
const deadline = Date.now() + waitSeconds * 1000
while (!ok && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 5_000))
  ok = await attempt()
}
if (!ok) process.exitCode = 1
