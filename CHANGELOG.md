# Changelog

## v0.1.0 — unreleased

First release: the machine-level inbox for DSH instances on one LAN.

### Added
- Peer protocol v1 over plain HTTP: `GET /peer/v1/hello`,
  `POST /peer/v1/pair`, `POST /peer/v1/messages`, `POST /peer/v1/files`,
  `POST /peer/v1/unpair` — HMAC-SHA256 per-pair signatures over method, path,
  timestamp, nonce and body digest; ±90 s clock window; nonce replay guard.
- Pairing is mutual in one paste: the second machine confirms with the
  invitation key it was given, and the first records it after the signature
  verifies — no manual accept step, both directions usable immediately.
- Broadcast: one independent message per peer sharing a `batchId`; a dead peer
  only stalls its own delivery queue.
- Durable outbox under the data root: pending deliveries survive a restart and
  retry with capped backoff; permanent failures stop and surface as `failed`.
- Files stream to disk with SHA-256 verification and an atomic rename; names are
  reduced to a safe basename and each file lands under its message id — a
  hostile name cannot escape the directory.
- Address self-heal: a verified request updates the peer's recorded address, so
  a DHCP change does not strand a conversation.
- Local store (`~/.dsh/smoothly-chat`): `config.json` (0600), append-only thread
  JSONL, received files, outbox records; unread counts and read marks.
