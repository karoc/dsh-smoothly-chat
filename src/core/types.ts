/**
 * Persisted and wire-facing shapes of DSH Smoothly Chat. Kept free of Node and
 * DSH imports so the same file types the host half, the tests, and (structurally)
 * the client half.
 */

/** One paired peer machine. */
export interface PeerRecord {
  /** Stable device id minted by the peer on first start. */
  deviceId: string
  /** Display name the peer reports. */
  name: string
  /** Last known address. */
  host: string
  /** Last known peer-server port. */
  port: number
  /** Per-pair base64url HMAC key. */
  key: string
  /** Epoch ms when this machine first learned about the peer. */
  addedAt: number
  /** Epoch ms when both sides confirmed the pair; absent while pending. */
  pairedAt?: number
  /** Epoch ms of the last authenticated request from the peer. */
  lastSeenAt?: number
  /** Last transport/auth failure, cleared on the next success. */
  lastError?: string
}

/** One outstanding invitation minted by this machine. */
export interface InviteRecord {
  key: string
  createdAt: number
  expiresAt: number
  usedBy?: string
  usedAt?: number
}

/** Local identity plus the peer table. */
export interface ConfigFile {
  version: 1
  deviceId: string
  name: string
  peers: PeerRecord[]
  invites: InviteRecord[]
}

/** Tunables surfaced by the settings page. */
export interface ChatSettings {
  /** Peer-server port. */
  port: number
  /** Interface to bind; `0.0.0.0` covers every local interface. */
  bindHost: string
  /** Address advertised in invitation strings; empty means auto-detect. */
  advertiseHost: string
  /** Accepted file size ceiling in bytes. */
  maxFileBytes: number
}

/** Metadata of one transferred file. */
export interface FileMeta {
  name: string
  size: number
  sha256: string
}

/** One persisted thread row: a message or a delivery status update. */
export type ThreadRecord =
  | {
    t: 'msg'
    seq: number
    id: string
    dir: 'in' | 'out'
    kind: 'text' | 'file'
    peerId: string
    at: number
    batchId?: string
    text?: string
    file?: FileMeta
  }
  | { t: 'status'; id: string; status: 'sent' | 'failed'; error?: string; at: number }

/** One message as the UI consumes it (status folded in). */
export interface ThreadMessage {
  seq: number
  id: string
  dir: 'in' | 'out'
  kind: 'text' | 'file'
  peerId: string
  at: number
  batchId?: string
  text?: string
  file?: FileMeta
  status: 'pending' | 'sent' | 'failed'
  error?: string
}

/** Text message envelope carried by `POST /peer/v1/messages`. */
export interface TextEnvelope {
  v: 1
  id: string
  batchId?: string
  from: { deviceId: string; name: string }
  to: { deviceId: string }
  at: number
  kind: 'text'
  text: string
}

/** Body of `POST /peer/v1/pair`. */
export interface PairRequest {
  v: 1
  device: { deviceId: string; name: string; port: number }
  at: number
}

/** Body of `POST /peer/v1/unpair`. */
export interface UnpairRequest {
  v: 1
  device: { deviceId: string }
  at: number
}

/** Response of `GET /peer/v1/hello`. */
export interface HelloResponse {
  ok: true
  v: 1
  self: { deviceId: string; name: string; port: number }
  at: number
}

/** Uniform failure body. */
export interface ErrorBody {
  ok: false
  error: { code: string; message: string }
}
