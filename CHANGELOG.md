# Changelog

All notable changes to the OC Vote protocol and reference SDK.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-09-02 — errata: ballots were undiscoverable

**Errata. No envelope, canonicalization, signature or tally-algorithm changes
— every existing test vector keeps its verdict.** The Nostr tag section
specified only multi-letter tags, which relays do not index, so the one query
a tally depends on could never match.

### Fixes

- **§3.4 / §3.6 / §6.3 event tags.** Poll, ballot and reveal events now
  normatively carry indexed `t` tags (`poll_id`, a family marker, and the
  creator/voter address) alongside the existing multi-letter tags. The
  multi-letter tags are readable diagnostics; a verifier MUST NOT depend on
  them.
- **New §6.5, "Discovering the ballots in a poll."** States the constraint
  (relays index single-letter names only; tag filters are exact-match, so a
  ballot's `oc-vote:ballot:<poll_id>:<voter>` d-tag cannot enumerate voters),
  gives the three working `#t` queries, and requires the tallier to confirm
  `content.poll_id` and de-duplicate by `ballot_id` because `t` is a shared
  namespace on these events.
- **§6.3** promised that "observers MAY still enumerate the ballots" while the
  wire format made enumeration impossible. It now points at §6.5.

### Impact before the fix

`@orangecheck/vote-cli`'s `fetchBallotEvents` and `vote.ochk.io/api/tally`
both filtered `#poll_id` — as specified — and returned zero ballots for every
poll. `vote.ochk.io` had already fixed the *emission* half (its ballots do
carry `['t', poll_id]`) but not the read half, so it was publishing findable
ballots and then failing to find them.

### Migration

**None.** A sweep of `relay.ochk.io`, `relay.damus.io`, `nos.lol`,
`relay.snort.social` and `relay.primal.net` on 2026-09-02 found zero
kind-3008x events carrying an `oc-vote:` `d`-tag prefix.


## [Unreleased] — 2026-04

### Added
- **`LIFECYCLE.md`** — normative companion document specifying per-kind lifecycles for poll (30080), ballot (30081), and reveal (30082). Polls are non-revocable post-publication (orphans ballot consumers); ballots are replaceable per `(poll, voter)` per existing §5.2 with `tiebreak`-governed precedence; reveals are one-shot — the secret cannot be unpublished. Bond / weight withdrawal works via UTXO spend before `snapshot_block`. Dashboard-local hide flags and NIP-09 deletion-request events have no protocol force. No protocol changes; clarification only.
- **`SPEC-v0.1-draft.md`** — design draft for threshold reveal (drand tlock + n-of-m trustee Shamir) and single-poll delegation attestation. Non-normative; `SPEC.md` v0 remains the canonical spec. Proposes new Nostr kinds 30083 (trustee share) + 30084 (delegation attestation), a scheme-aware `reveal` field in the poll object, and planned test vectors v06–v10. Comments welcome at `security@ochk.io` prefix `[protocol-v0.1]`.

## [0.1.0] — 2026-04

Initial public specification of OC Vote v0.

### Added
- Poll object (§3), ballot object (§4), reveal object (§6.3), and their canonical forms.
- Content-addressed ids via SHA-256 of canonical bytes with `sig.value` emptied.
- Three canonical weight modes: `one_per_address`, `sats`, `sats_days` (§5).
- Secret-ballot mode via OC Lock envelope + creator-held reveal key (§6).
- Deterministic tally algorithm (§8) with explicit tiebreak semantics.
- Nostr kinds 30080 (poll), 30081 (ballot, replaceable per voter per poll), 30082 (reveal).
- Canonicalization scheme (§7) based on RFC 8785 with explicit constraints on `options[]` order.
- Error codes (§9) and compliance checklist (§15).
- `WHY.md` — hypothesis-by-hypothesis design rationale; alternatives considered and retired.
- `PROTOCOL.md` — narrative walkthrough of five flows (public, threshold-heavy one-per-address, secret ballot, multi-address voter, dispute).
- `SECURITY.md` — threat model, attack scenarios 1–14, report channel.
- `LICENSE` — MIT for all specification prose.
- Test vectors `v01` … `v05` in `test-vectors/`.

### Design principles frozen for v0
- Bitcoin weight is load-bearing (no Ed25519-equivalent).
- Offline-verifiable tally (pure function of poll + ballots + UTXO snapshot).
- Content-addressed artifacts (id before storage).
- No token, no authority, no custody.
- Small canonical surface: 3 weight modes, 2 tiebreaks, 2 modes (public/secret).
- Creator-held reveal is a named trust anchor, not hidden.
- Secret-mode ballots are OC Lock envelopes (compositional, no new primitives).

### Known limitations accepted in v0
- Creator of a secret-mode poll can decrypt ballots before deadline (not publish them without leaking the key, but can know privately).
- Creator of a secret-mode poll can refuse to reveal; poll is abandoned.
- No receipt-freeness / coercion resistance after reveal.
- No post-quantum crypto.
- No delegation or liquid democracy.
- No quadratic mode in the canonical set (registry available for extensions).

See `WHY.md` §"What v0 explicitly does NOT solve" and `SPEC.md` §13 "Future work."
