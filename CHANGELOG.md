# Changelog

## v0.1.1 — unreleased

- **Transfer progress**: the composer shows the browser→host upload percentage
  (XMLHttpRequest upload events) and each outbound file card shows a thin bar for
  the host→peer stream, reported over SSE and throttled to ~150 ms.
- **Honest staged copies**: a failed permanent delivery now deletes the staged
  upload copy as well as the outbox record; a successful one already did.
- **Correct file wording**: the receiver already owns the file, so the card now
  offers "Save a copy" instead of "Download", plus "Show folder" which reveals
  the containing directory in the OS file manager (folder only — the received
  file is never executed).
- **Localized UI details**: relative times, the request address line and upload
  copy now come from the dictionaries — the panel follows the DSH language
  setting (zh/en, other languages fall back to English).
- **README**: documents the real file semantics — the receiver keeps its own
  copy, so deleting the sender's original after a successful send changes
  nothing; partial transfers are discarded.

## v0.1.0 — unreleased

First release: the machine-level inbox for DSH instances on one LAN.

Installable from the published npm tarball or straight from the Git URL: the
repository ships the built `lib/` plus a `build-stamp.json` source hash, so no
install-time build (and no Node toolchain on the target machine) is required.
`release:check` refuses to pass when the stamp does not match `src/`.

The mailbox data root follows `$DSH_HOME` (`~/.dsh` by default), so desktop
installs keep it inside their own runtime home.

Default peer port is **47811**; if it is busy the next nine ports are tried and
the panel reports the port actually bound.

### Added
- Peer protocol v1 over plain HTTP: `GET /peer/v1/hello`,
  `POST /peer/v1/pair`, `POST /peer/v1/messages`, `POST /peer/v1/files`,
  `POST /peer/v1/unpair` — HMAC-SHA256 per-pair signatures over method, path,
  timestamp, nonce and body digest; ±90 s clock window; nonce replay guard.
- Pairing is a two-step handshake: the invited machine signs its request with
  the invitation key, and the inviting machine's owner explicitly approves it in
  the panel (compact request row, not a modal). Holding an invitation only
  permits asking; nothing is auto-accepted and a refusal is reported back.
- Unread clears itself while a thread is actually on screen (visible window,
  panel showing that peer); a hidden window keeps counting.
- A **Check for updates** button compares the installed build (version + the git
  commit recorded in `lib/build-stamp.json`) with the repository's `main`; it
  only reports, never installs.
- Pair removals are now logged with device id and timestamp, so a vanished pair
  can be traced to the actor that removed it.
- The sidebar entry and empty state draw their own envelope SVG instead of the
  `IconMail*` family, which only exists from DSH 0.2.2-rc.4 on — on rc.3 the
  missing export made React throw and the renderer silently abdicated the whole
  sidebar row. `scripts/check-icons.mjs` now pins every DSH icon to rc.3.
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
