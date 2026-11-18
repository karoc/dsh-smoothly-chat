# DSH Smoothly Chat (思磨力讯)

Peer-to-peer text and file messaging between DeepSeek Harness instances on the
same LAN. Every machine keeps its own **machine-level inbox**: messages land in
a panel — never in a conversation, never in a prompt, never in a token bill.

- **Panel**: a mail icon in the left sidebar with an unread dot, opening a full
  mailbox page (peer list, per-peer threads, composer, attachments).
- **Bidirectional by construction**: pairing is mutual in one paste; every pair
  shares its own key, so any paired machine can send to any other. One-to-many,
  many-to-one and many-to-many are all the same data model (one queue and one
  thread per peer).
- **Broadcast**: send to every peer at once — implemented as N independent
  messages sharing a batch id, so one dead peer cannot hold up the others.
- **Never touches a session**: no conversation is created, appended to, or
  resumed; the model never sees this traffic.

## Install

```sh
dsh plugin --profile web add dsh-smoothly-chat
```

Restart `dsh web` afterwards (a new bundle only loads at startup), then open the
mail icon in the left sidebar.

Local development install: add `"dsh-smoothly-chat": "link:/path/to/dsh-smoothly-chat"`
to the profile's `package.json` dependencies and `dsh-smoothly-chat` to its
`dsh.profile.bundles` list, then reinstall and restart.

## Pairing (once per machine pair)

1. Machine A: **Add peer → Create invitation** → copy the `dsh-peer://…` string.
2. Machine B: **Add peer → paste** → Pair.

B signs its confirmation with the invitation key; A records B as soon as that
signature verifies, so both directions work immediately after the paste. No
manual accept step on A (holding the key *is* the credential), no second paste.
Invitations expire after 24 hours. Unpairing drops the pair here immediately and
tells the other side; if that machine is offline it learns the next time it
tries to send (the request is refused and the message is marked failed).

## Network

- The mailbox listens on **port 47811** by default (`DSH_SMOOTHLY_CHAT_PORT`,
  `DSH_SMOOTHLY_CHAT_BIND`, `DSH_SMOOTHLY_CHAT_DIR`, `DSH_SMOOTHLY_CHAT_NAME`).
- It binds every interface so a machine with several addresses (WSL mirrored
  networking, VPN, multiple NICs) stays reachable. The exposed surface is only
  the four signed endpoints; DSH's own web server is untouched.
- Every machine must be reachable **inbound** on its mailbox port. A WSL2 distro
  in the default NAT mode is not: pair with it only after setting up a Windows
  port forward (`netsh interface portproxy`) and a firewall rule. The panel shows
  the address and port it advertises for pairing, and warns when none of this
  machine's addresses is a private LAN address.
- Firewall: allow inbound TCP 47811 on each machine.

## Security model

- Every request is signed with the **per-pair** HMAC-SHA256 key over method,
  path, timestamp, nonce and body digest; ±90 s clock window; a nonce is
  accepted once. A message from C cannot be replayed to B (different key), and a
  captured request cannot be re-sent or re-aimed.
- Traffic is plain HTTP: signatures stop forgery and replay, **not** a
  same-subnet sniffer. Treat the LAN as trusted, or put the machines on a VPN.
- The mailbox API can only store and serve messages/files. It cannot start a
  session, run a tool, or read a conversation.
- Files stream to disk with a SHA-256 check and an atomic rename; the name is
  reduced to a single safe path segment under the message id, so `../` cannot
  escape. Default ceiling 200 MB per file.
- Pair keys never leave the host: the panel API strips them from every response.

## Data layout

`~/.dsh/smoothly-chat/` (directory `0700`, `config.json` `0600`):

```
config.json           device identity, peers (with keys), invitations
state.json            per-peer read marks
threads/<peer>.jsonl  append-only messages and delivery statuses
files/<msgId>/<name>  received file bodies
outbox/<msgId>.json   pending deliveries (survive restarts)
```

## Delivery semantics

- Outbound messages are persisted before the first attempt; a restart resumes
  them.
- Transport failures retry with capped exponential backoff (1 s → 60 s cap).
- Permanent failures (auth rejected, unknown endpoint, size refused) stop
  retrying and surface as `failed` in the thread.
- A verified request updates the peer's recorded address, so a DHCP change heals
  itself the next time that peer contacts this machine.

## Not in v0.1.0

Group rooms, a relay/hub mode (every machine must be directly reachable), TLS,
mDNS discovery, read receipts, message editing/recall, and forwarding messages
into an agent session (deliberately: the inbox is isolated).

## Development

```sh
npm install
npm run bundle
npm test          # dual-instance protocol E2E + UI API scenarios
npm run typecheck
npm run release:check
```

`lib/core.js` is the DSH-free core the test scripts import; `lib/index.js` is
the host half; `lib/client.js` is the browser bundle. Verification scripts never
need a DSH process except the GUI checks.

Live GUI checks (they use the running instance; they never start a server):

```sh
DSH_WEB_URL='http://127.0.0.1:3080/?token=…' npm run verify:gui       # entry + panel render
DSH_WEB_URL='http://127.0.0.1:3080/?token=…' npm run verify:gui:live  # two-way text + file against a script node
```
