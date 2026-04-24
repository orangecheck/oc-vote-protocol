# Changelog

All notable changes to the OC Vote protocol and reference SDK.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
