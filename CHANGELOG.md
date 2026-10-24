# Changelog

All notable changes to the OC Vote protocol and reference SDK.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — anchored ballots (polls with a deadline on or after 2026-11-15T00:00:00Z)

No canonicalization or signature change: polls, ballots and reveals keep their
bytes and ids.

- **§4.6, who anchors.** The section states the convenience anchorer's limits
  per run: at most 300 new stamps, round-robin across polls, at most 50 per
  poll in the order it first saw the ballots, and at most 50 polls read. Stamps
  it made are always upgraded. Voter clients anchor what falls outside them.

- **§4.6 (new).** In an anchored poll, whether a ballot is in time is decided by
  the Bitcoin block that anchors its `ballot_id`, through an OC Stamp over the
  ballot and its OpenTimestamps proof. The anchor decides that and nothing
  else. A final tally counts only ballots anchored at or below `H_close + G`
  (`G` = 36 blocks), and is final only once `H_close` is known and the chain
  tip reaches `H_close + G + 6`; before that it is provisional. Talliers MUST
  check each rebuilt stamp's `content.hash` against `"sha256:" || ballot_id`,
  and MUST keep every stamp over a ballot from every relay they query, taking
  the lowest verified anchor, from the earliest attestation each proof walks to
  a checked header. An anchor that could not be checked is not a missing one:
  no final tally until it can be. Any address may sign the stamp. Voter clients
  SHOULD anchor their ballots, and vote.ochk.io runs a convenience anchorer
  anyone can replace. The section states how late a ballot can still count:
  `median_time_past` trails the clock by about six blocks, so up to
  `H_close + G`.
- **§0, §3.3.** §0 defines `instant(t)`. `H_close` is the greatest block height whose
  `median_time_past` ≤ `deadline`, and `none` until a later block's
  `median_time_past` passes `deadline`. §3.3 now names it for
  `snapshot_block: "deadline"`, used once it has 6 confirmations.
- **§8.** The tally takes the chain tip, `H_close` and anchor heights. Every
  result carries `basis` (`"anchored"` or `"voter_clocks"`), and an anchored
  poll's results `close_height`. Tallies list the ballots they counted in
  `counted`; a provisional tally reports in `unanchored` how many of those are
  not yet anchored in time. A ballot found after a tally is shown apart from
  it, and `counted` excludes nothing from another tally. A tally whose snapshot
  block is unknown or has fewer than 6 confirmations returns
  `{ "state": "deferred", "code": "E_REORG" }`. `choose_by_tiebreak` orders an
  anchored poll's ballots by anchor height first. Step 3 keeps each voter's
  revealed option apart from the ballot, so `ballot_id` still names the ballot
  as received.
- **§9, §10.5.** New error `E_NOT_ANCHORED`. `E_REORG` also covers a snapshot
  block that is not yet known.
- **§10.3, §10.8.** An anchored poll's reveal is accepted only once the tip
  reaches `H_close + G + 6`, never while `H_close` is `none`. Final tallies count
  only anchored ballots.
- **§15.** Checklist lines for stamp copies and `content.hash`, `basis`,
  `counted`, and ballots found after a tally.
- **`LIFECYCLE.md`, `SECURITY.md`, `PROTOCOL.md`, `README.md`.** Same rules,
  how late a ballot can count, the liveness assumption on calendars and
  anchorers, and `basis` and `counted` in the walkthrough's results.
- **Vectors.** v01–v07 results gain `"basis": "voter_clocks"` and `counted`
  (v05's pre-reveal result gains `basis`); their counts do not change. New
  v08–v15 cover anchored polls, an open anchored poll, and a deferred tally;
  v16 pins the order of `counted`.
  `scripts/validate-vectors.mjs` checks every result has `basis` and a sorted
  `counted` drawn from the vector's ballots.

## [Unreleased] — 2026-10-22 — errata: times are iso8601_utc; reveals are checked by the tallier's clock and the poll's key

**Errata.** No canonicalization or signature change. Every vector keeps its
tally; v05's ids change (below).

- **§3.3, §4.3, §8.** A poll's `deadline` and a ballot's `created_at` MUST be
  `iso8601_utc` (§0). The tally drops a ballot whose `created_at` is not,
  including a time with no zone, an offset, or a date that does not exist, and
  compares instants. Every tallier then reads the same times from the same
  inputs, as §8 requires.
- **§6.4 step 1, §10.3.** A tallier accepts a reveal only once its own clock
  reads at or after `deadline`; the reveal's `revealed_at` does not decide. The
  tallier MUST also check that `reveal_sk` is the X25519 secret key for the
  poll's `reveal_pk`, which SECURITY Scenario 13 already required.
- **`LIFECYCLE.md` §1.1.** A reveal published before `deadline` no longer
  "closes" a secret poll early: no poll closes before `deadline`, and creators
  SHOULD NOT reveal before it.
- **v05.** Its `reveal_pk` was a placeholder that no `reveal_sk` matches. It is
  now the X25519 public key of the vector's `reveal_sk`, so `poll_id`,
  `ballot_id`, `commit` and `reveal_id` change. The tally does not.
- **New vector v07.** Ballots dated `late-15`, with no zone, and on 31 April are
  dropped, whatever the order or the tallier's time zone.
- **`scripts/validate-vectors.mjs`** checks a secret vector's reveal key.

Reference implementation: `@orangecheck/vote-core` 1.6.0.

## [Unreleased] — 2026-10-21 — reference relay set

- **§3.4** names the relays the reference client now uses. `relay.snort.social` and `offchain.pub` left it on 2026-10-21: snort kept none of the family events it accepted, and offchain refused events signed by fresh keys. `relay.damus.io` and `nostr.oxtr.dev` joined. Non-normative; nothing a client MUST do changes.

## [Unreleased] — 2026-10-21 — errata: relays keep every ballot; the tiebreak decides

**Errata. No envelope, canonicalization, signature or tally-algorithm change —
every existing test vector keeps its verdict.** §4.5 said a voter's new ballot
replaces the old one at conforming relays, so the transport implemented
`tiebreak: latest`. NIP-01 replaces an addressable event only by one with the
same `kind`, `d` tag and Nostr `pubkey`, and ballot events are signed with a
fresh key each (the reference client and CLI use a random key per event), so
relays keep every ballot. The §8 tiebreak is what decides, and always was.

- **§4.5.** States the NIP-01 rule and that a tallier MUST apply the tiebreak
  to every ballot it collects, never assume a relay returns only the latest.
  `tiebreak: first` polls still need several relays, now for the right reason:
  a client that reuses one key can let a relay drop the earlier ballot.
- **§6.5 discovery note, §14.** No longer call kind 30081 "replaceable per
  voter".
- **`LIFECYCLE.md`.** Same correction. It also named the tiebreak `last` (the
  value is `latest`), cited §5 for it (it is §8), called the field `option_id`
  (it is `option`), and gave no rule for equal `created_at`.
- **`WHY.md` H9, `PROTOCOL.md`, `README.md`.** Same correction.
- **New vector v06.** `tiebreak: first`, one voter, three ballots, two at the
  same earliest time: the lesser `ballot_id` decides. An implementation that
  applies `latest`, or breaks the tie the other way, gets a different tally.
- **CI.** A job fails on an absolute home-directory path in any tracked file.

Reference implementation: `@orangecheck/vote-core` 1.5.1 passes v06 unchanged.

## [Unreleased] — 2026-10-08 — reference relay set

- **§3.4** names the five relays the reference client actually uses. It listed `relay.damus.io`, which the shared default set has never included. Non-normative; nothing a client MUST do changes.

## [Unreleased] — 2026-09-24 — §8 tally clarifications

**Clarification. No envelope, canonicalization or signature changes — every
existing test vector keeps its verdict.** The §8 pseudo-code now states rules
that §3.3, §4.3 and §10.1 already required.

- Step 1 verifies the poll's `sig` against `creator` (§10.1) and drops
  ballots whose `voter` is not a mainnet address (§4.3).
- Step 3 unseals each voter's de-duplicated ballot only, and drops a revealed
  option that is not one of `poll.options` or `withdraw` (`E_UNKNOWN_OPTION`).
- New text after §8: option ids are plain strings, never inherited object
  properties; and when relays return several poll or reveal events for one
  `d` tag, selection is by content hash and signature, not recency.

Reference implementation: `@orangecheck/vote-core` 1.3.0.

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
