/**
 * Wire protocol v1 for DSH Smoothly Chat (思磨力讯).
 *
 * Design constraints this file encodes:
 *  - plain HTTP, one request per action — no long-lived sockets;
 *  - every authenticated request is signed with the *per-pair* key, so a
 *    message from C can never be replayed to B;
 *  - the signature covers method, path, timestamp, nonce and the body digest,
 *    so a captured request cannot be re-aimed or re-sent;
 *  - files are signed through their SHA-256 header, which lets both sides
 *    stream the body instead of buffering it in memory.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Current protocol version. Both sides must agree before exchanging bodies. */
export const PROTOCOL_VERSION = 1

/** Header carrying the protocol version. */
export const PROTO_HEADER = 'x-dsc-proto'
/** Header carrying the sending device id. */
export const DEVICE_HEADER = 'x-dsc-device'
/** Header carrying the millisecond timestamp used by the signature. */
export const TS_HEADER = 'x-dsc-ts'
/** Header carrying the single-use nonce used by the signature. */
export const NONCE_HEADER = 'x-dsc-nonce'
/** Header carrying the base64url HMAC-SHA256 signature. */
export const SIG_HEADER = 'x-dsc-sig'
/** Header carrying the URI-encoded file name of a file upload. */
export const FILE_NAME_HEADER = 'x-dsc-file-name'
/** Header carrying the byte size of a file upload. */
export const FILE_SIZE_HEADER = 'x-dsc-file-size'
/** Header carrying the hex SHA-256 of a file upload body. */
export const FILE_SHA_HEADER = 'x-dsc-file-sha256'

/** Accepted clock skew for a signed request. */
export const TS_WINDOW_MS = 90_000
/** Default largest accepted text envelope. */
export const MAX_TEXT_BYTES = 1024 * 1024
/** Default largest accepted file body. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024
/** How long a pairing invitation stays usable. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000

/** Generate a random base64url identifier. */
export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

/** Hex SHA-256 of a string or byte view. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Canonical string a signature is computed over. */
export function canonical(method: string, pathname: string, ts: number, nonce: string, bodySha: string): string {
  return `${method.toUpperCase()}\n${pathname}\n${String(ts)}\n${nonce}\n${bodySha}`
}

/** HMAC-SHA256 signature (base64url) for one canonical string. */
export function sign(key: string, canonicalText: string): string {
  return createHmac('sha256', Buffer.from(key, 'base64url')).update(canonicalText).digest('base64url')
}

/** Constant-time signature comparison that never throws on length mismatch. */
export function verifySignature(key: string, canonicalText: string, signature: string): boolean {
  const expected = sign(key, canonicalText)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Render the invitation string a peer pastes into the other machine. */
export function formatPairingString(input: { host: string; port: number; deviceId: string; key: string }): string {
  const host = input.host.includes(':') ? `[${input.host}]` : input.host
  return `dsh-peer://${host}:${String(input.port)}#${input.deviceId}.${input.key}`
}

/** Parsed pairing invitation. */
export interface PairingInvitation {
  /** Address the inviting machine advertises. */
  host: string
  /** Port the inviting machine listens on. */
  port: number
  /** Inviting device id. */
  deviceId: string
  /** Per-pair shared key minted by the inviter. */
  key: string
}

/**
 * Parse a pasted invitation. Accepts only the `dsh-peer:` scheme and requires
 * a concrete host, a numeric port, a device id and a key; anything else is a
 * user-facing format error rather than a silent half-pairing.
 */
export function parsePairingString(value: string): PairingInvitation {
  const trimmed = value.trim()
  if (!trimmed.startsWith('dsh-peer://')) {
    throw new Error('pairing string must start with dsh-peer://')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('pairing string is not a valid URL')
  }
  if (url.protocol !== 'dsh-peer:') throw new Error('pairing string must start with dsh-peer://')
  const hash = url.hash.slice(1)
  const dot = hash.indexOf('.')
  if (dot <= 0) throw new Error('pairing string is missing the device id or key')
  const deviceId = hash.slice(0, dot)
  const key = hash.slice(dot + 1)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) throw new Error('pairing string has an invalid device id')
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error('pairing string has an invalid key')
  if (url.hostname === '') throw new Error('pairing string is missing the host')
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('pairing string has an invalid port')
  return { host: url.hostname.replace(/^\[|\]$/gu, ''), port, deviceId, key }
}

/**
 * Reduce an arbitrary file name to one safe path segment: no separators, no
 * control characters, no leading dots and a bounded length. The message id is
 * the directory, so even a hostile name cannot escape it.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/u).pop() ?? raw
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/gu, '_')
    .replace(/^\.+/u, '')
    .trim()
    .slice(0, 120)
  return cleaned === '' ? 'file' : cleaned
}

/** Normalize a socket remote address (`::ffff:1.2.3.4` → `1.2.3.4`). */
export function normalizeRemoteAddress(address: string | undefined): string {
  if (address === undefined) return ''
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

/** Format a host/port pair as an origin, bracketing IPv6 literals. */
export function originOf(host: string, port: number): string {
  return `http://${host.includes(':') ? `[${host}]` : host}:${String(port)}`
}
