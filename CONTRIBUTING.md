# Contributing

## What ships together

A version ships as one unit: code, both READMEs, CHANGELOG, and the tag. "Code
now, docs later" is treated as a defect, not as a follow-up, because the gate
can only check structure — it cannot tell whether a sentence still matches the
implementation.

Before tagging, walk the documentation against the implementation sentence by
sentence:

1. every configuration key (env var) and its default/bounds;
2. every wire surface (`/peer/v1/*` fields, headers, status codes) and every
   panel API route — what is returned, what is stripped;
3. every negative guarantee ("never", "cannot", "not reachable") — find the
   branch in the source that enforces it;
4. every known limitation (NAT'd WSL, plaintext HTTP, no relay, no discovery);
5. every version claim (DSH 0.2.x route policy, Node >= 18).

If a sentence cannot be verified against the code, fix the sentence or the code
before the tag. A published tag is never moved; an unreleased tag may be moved
after a documentation fix (`git tag -f` + `git push --force origin <tag>`).

## Verification before every release

```sh
npm test                 # protocol E2E (14) + UI API (6) + host adapter (1)
npm run bundle           # rebuild lib/ and refresh lib/build-stamp.json (commit both)
npm run typecheck
npm run bundle
npm run release:check    # structure gate: README parity, CHANGELOG, files, freshness, clean tree
npm run test:controls    # negative controls: the gate must actually go red
```

A green gate you have never seen fail is not evidence. `test:controls` clones
the repository, injects one defect per scenario, and asserts `release:check`
exits non-zero; it also asserts a positive control passes.

## Release steps

1. Update code and both READMEs and CHANGELOG in the same commit.
2. Bump the version, commit, tag `v<version>`, push commit and tag.
3. `npm run release:check` (must pass on a clean tree).
4. `npm pack --dry-run` and read the file list.
5. `npm publish` (runs the gate again through `prepublishOnly`).
6. `npm run verify:publish` — the registry is eventually consistent; a timeout
   is not a failed publish.

npm publishing is a human action when 2FA is enabled: an agent prepares
everything up to "one command to publish" and hands that command over.

## Security invariants (do not regress)

- The peer-facing listener never serves DSH routes, sessions, tools or the GUI.
- The panel API never returns a pair key.
- A file name is reduced to one path segment under its message id.
- Every message and file request is authenticated; a request without a known
  pair is refused before its body is buffered.
- Replay and clock window checks run before a message is persisted.
