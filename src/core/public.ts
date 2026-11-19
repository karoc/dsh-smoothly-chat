/**
 * DSH-free public surface of the plugin. The repository's verification
 * scripts import this built file (`lib/core.js`) so they can exercise the
 * protocol, store, server and outbox without a DSH runtime.
 */

export { ChatNode } from './node.ts'
export { createApiHandler } from './api.ts'
export type { ApiHandler, ApiHandlerOptions, UpdateInfo } from './api.ts'
export type { ChatEvent, ChatNodeOptions, LocalAddress, Presence } from './node.ts'
export { Store, defaultDeviceName } from './store.ts'
export type { OutboxRecord } from './store.ts'
export { PeerServer, signedHeaderSet } from './server.ts'
export type { PeerServerOptions } from './server.ts'
export { Outbox } from './outbox.ts'
export type { OutboxOptions } from './outbox.ts'
export {
  canonical,
  DEVICE_HEADER,
  FILE_NAME_HEADER,
  FILE_SHA_HEADER,
  FILE_SIZE_HEADER,
  formatPairingString,
  INVITE_TTL_MS,
  MAX_FILE_BYTES,
  MAX_TEXT_BYTES,
  NONCE_HEADER,
  normalizeRemoteAddress,
  originOf,
  parsePairingString,
  PROTOCOL_VERSION,
  PROTO_HEADER,
  randomId,
  safeFileName,
  sha256Hex,
  SIG_HEADER,
  sign,
  TS_HEADER,
  TS_WINDOW_MS,
  verifySignature,
} from './protocol.ts'
export type { PairingInvitation } from './protocol.ts'
export type {
  ChatSettings,
  ConfigFile,
  ErrorBody,
  FileMeta,
  HelloResponse,
  InviteRecord,
  PairRequest,
  PeerRecord,
  TextEnvelope,
  ThreadMessage,
  ThreadRecord,
  UnpairRequest,
} from './types.ts'
