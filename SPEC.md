# OC Vote Protocol v0 — Specification

**Status:** Stable (v0)
**Date:** 2026-04
**Depends on:** OrangeCheck SPEC, OC Lock SPEC (for secret-ballot mode)

---

## 0. Notation

- All bytes serialized as lowercase hex unless marked `base64url`.
- `||` denotes byte concatenation.
- `SHA256()` = SHA-256 per FIPS 180-4.
- `BIP322(addr, msg)` = BIP-322 signature of `msg` by `addr`, encoded as base64.
- `ECDH(k, P)` = X25519 per RFC 7748. Output is 32 bytes.
- `AEAD()` = AES-256-GCM per NIST SP 800-38D (12-byte IV, 16-byte tag).
- `KDF()` = HKDF-SHA256 per RFC 5869.
- `iso8601_utc` = `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DDTHH:MM:SS.sssZ`.
- `instant(t)` = the moment an `iso8601_utc` string names. Times are compared as instants.
- `H_close` = the greatest block height whose `median_time_past` ≤ `deadline`; `none` until a block whose `median_time_past` is after `deadline` exists (§4.6). `G` = 36 blocks.
- Canonical JSON = UTF-8 encoded JSON with lexicographically sorted object keys, no insignificant whitespace, LF-terminated. See §7 and [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).

## 1. Actors

- **Creator** — the party who publishes a poll.
- **Voter** — the holder of a Bitcoin address who casts a ballot.
- **Tallier** — any party who computes a result from a poll + ballot set + UTXO snapshot. Not a trusted role.
- **Directory** — a Nostr relay (or set of relays) that stores poll / ballot / reveal events.
- **Observer** — any party who wants to verify the tally independently.

The creator and a voter may be the same party. The tallier is typically "whoever's looking at the page." There is no privileged server.

## 2. Terminology

- **Poll** — the canonical object describing a single question, its options, its rules, and its deadline.
- **Ballot** — one voter's signed choice for a single poll.
- **Tally** — the deterministic output of applying the weight function to the set of valid ballots.
- **Snapshot** — the Bitcoin block height at which UTXO state is evaluated for weight computation.
- **Weight mode** — the function that maps `(address, UTXOs at snapshot)` → `non-negative integer`.
- **Reveal** — in secret-ballot mode, the published secret key that unwraps all ballots.

## 3. Poll

### 3.1 Poll object

A poll is a canonical JSON object:

```json
{
  "v": 0,
  "kind": "oc-vote/poll",
  "creator": "<btc address>",
  "question": "<single-line UTF-8 question, <= 280 bytes>",
  "options": [
    { "id": "<option id, 1-32 bytes, matching [a-z0-9_\\-]>", "label": "<UTF-8 label, <= 140 bytes>" }
  ],
  "deadline": "<iso8601_utc>",
  "snapshot_block": <positive integer | "deadline">,
  "weight_mode": "one_per_address" | "sats" | "sats_days" | "<registry name>",
  "weight_params": <object | null>,
  "min_sats": <non-negative integer>,
  "min_days": <non-negative integer>,
  "mode": "public" | "secret",
  "reveal_pk": "<32-byte hex X25519 pubkey> | null",
  "tiebreak": "latest" | "first",
  "notes": "<optional UTF-8, <= 2048 bytes> | null",
  "created_at": "<iso8601_utc>",
  "sig": {
    "alg": "bip322",
    "pubkey": "<creator btc address>",
    "value": "<base64(BIP322(creator, poll_id))>"
  }
}
```

### 3.2 Poll id

`poll_id = SHA256(canonical_bytes(poll_with_sig.value_set_to_""))` expressed as lowercase hex.

Equivalently: compute the canonical serialization with `sig.value` set to the empty string, hash it, and use that as the poll id. This id is then committed to by the `sig.value` BIP-322 signature.

### 3.3 Required fields and constraints

- `v` — MUST be `0` for v0 compliance.
- `kind` — MUST be the literal string `oc-vote/poll`.
- `creator` — MUST be a valid Bitcoin mainnet address (P2WPKH, P2TR, P2WSH, or P2PKH).
- `question` — REQUIRED.
- `options` — MUST contain at least 2 entries. Option ids MUST be unique within the poll. Reserved option id: `"withdraw"` (see §4.3).
- `deadline` — MUST be an `iso8601_utc` string (§0), strictly in the future at the time of publication.
- `snapshot_block` — integer (a specific block height known at poll creation) or the literal string `"deadline"` (deferred to the last block at `deadline`). In the deferred case, the tallier MUST use `H_close` (§0), the greatest block height whose `median_time_past` ≤ `deadline`, and only once it has ≥ 6 confirmations.
- `weight_mode` — one of the canonical modes in §5, or a registered extension name (§11).
- `weight_params` — shape is weight_mode-dependent. See §5.
- `min_sats`, `min_days` — non-negative integers. A voter whose qualifying UTXOs do not meet `min_sats` (aged ≥ `min_days` at snapshot) contributes zero weight.
- `mode` — `"public"` means ballots contain a plaintext `option`. `"secret"` means ballots carry an encrypted option envelope; `reveal_pk` MUST be set.
- `reveal_pk` — REQUIRED when `mode == "secret"`, MUST be `null` otherwise.
- `tiebreak` — `"latest"` or `"first"`: which of a voter's ballots counts (§8 `choose_by_tiebreak`).
- `notes` — free-form UTF-8; MUST NOT affect tally.
- `created_at` — at or before publication time. SHOULD be UTC.
- `sig` — BIP-322 signature by `creator` over `poll_id`.

### 3.4 Poll publication (Nostr)

A poll is published as an **addressable** event of kind `30080`:

```
event.kind       = 30080
event.tags       = [
  ["d",          "oc-vote:poll:" || poll_id],
  ["t",          poll_id],
  ["t",          "oc-vote-poll"],
  ["t",          creator],
  ["poll_id",    poll_id],
  ["creator",    creator],
  ["deadline",   deadline],
  ["snapshot",   snapshot_block or "deadline"],
  ["mode",       "public" | "secret"]
]
event.content    = canonical_bytes(poll)     // the entire poll object as canonical JSON
event.pubkey     = ephemeral_nostr_pubkey    // per §3.5
event.created_at = unix_seconds
```

Clients SHOULD publish to at least three relays from a diverse set. The reference client uses `relay.ochk.io`, `nos.lol`, `relay.primal.net`, `relay.damus.io` and `nostr.oxtr.dev`, the default set in `@orangecheck/nostr-core`.

### 3.5 Nostr authorship

As in OC Lock, the Nostr event `pubkey` is not tied to the creator's Bitcoin identity; the authenticity proof is the `sig.value` BIP-322 signature verifiable against `creator`. A fresh ephemeral Nostr keypair SHOULD be derived deterministically from a poll-local secret chosen by the creator:

```
nostr_sk := HKDF(ikm=poll_local_secret, salt="oc-vote/v0/nostr-key", info=poll_id, L=32)
```

## 4. Ballot

### 4.1 Ballot object

```json
{
  "v": 0,
  "kind": "oc-vote/ballot",
  "poll_id": "<hex>",
  "voter": "<btc address>",
  "option": "<option id> | null",
  "attestation_id": "<hex of OC attestation id> | null",
  "secret": null | {
    "envelope": <oc-lock v2 envelope object>,
    "commit": "<hex sha256 of chosen option id, salted with voter + poll_id>"
  },
  "created_at": "<iso8601_utc>",
  "sig": {
    "alg": "bip322",
    "pubkey": "<voter btc address>",
    "value": "<base64(BIP322(voter, ballot_id))>"
  }
}
```

### 4.2 Ballot id

`ballot_id = SHA256(canonical_bytes(ballot_with_sig.value_set_to_""))` expressed as lowercase hex.

### 4.3 Required fields and constraints

- `v` — MUST be `0`.
- `kind` — MUST be the literal string `oc-vote/ballot`.
- `poll_id` — MUST match a known poll's id exactly. Clients MUST NOT count ballots whose `poll_id` does not resolve to a retrieved poll.
- `voter` — MUST be a valid Bitcoin mainnet address.
- `option`:
  - In `public` mode: REQUIRED. MUST be one of the poll's option ids, or the literal string `"withdraw"` (to explicitly cancel a prior ballot).
  - In `secret` mode: MUST be `null`. The real choice lives in `secret.envelope`.
- `attestation_id` — OPTIONAL. Non-normative: a client hint pointing at an existing OrangeCheck attestation by this voter. The authoritative check is always against the UTXO snapshot.
- `secret`:
  - In `public` mode: MUST be `null`.
  - In `secret` mode: REQUIRED. `envelope` is a valid OC Lock v2 envelope addressed to the poll's `reveal_pk` (see §6). `commit` is a binding commitment so the voter cannot claim a different option at reveal time.
- `created_at` — MUST be an `iso8601_utc` string (§0), and SHOULD be before `deadline`. The tally discards a ballot whose `created_at` is not `iso8601_utc` (for example a time with no zone, an offset, or a date that does not exist), and one with `created_at > deadline`. The voter writes `created_at`; in an anchored poll the ballot's anchor (§4.6) decides whether it is in time.
- `sig` — BIP-322 signature by `voter` over `ballot_id`.

### 4.4 The commitment in secret mode

```
commit_msg := "oc-vote/v0/commit\n"
           || "poll_id: "  || poll_id     || "\n"
           || "voter: "    || voter_addr  || "\n"
           || "option: "   || chosen_id   || "\n"
commit := hex(SHA256(commit_msg))
```

At reveal time, the tallier unseals `secret.envelope` to recover `chosen_id`, recomputes `commit_msg` + `commit`, and verifies byte-equality with `ballot.secret.commit`. Any mismatch causes the ballot to be dropped from the tally (error `E_COMMIT_MISMATCH`).

### 4.5 Ballot publication (Nostr)

A ballot is published as an addressable event of kind `30081`:

```
event.kind       = 30081
event.tags       = [
  ["d",          "oc-vote:ballot:" || poll_id || ":" || voter],
  ["t",          poll_id],
  ["t",          "oc-vote-ballot"],
  ["t",          voter],
  ["poll_id",    poll_id],
  ["voter",      voter],
  ["ballot_id",  ballot_id]
]
event.content    = canonical_bytes(ballot)
event.pubkey     = ephemeral_nostr_pubkey
event.created_at = unix_seconds
```

Relays replace an addressable event only by one with the same `kind`, `d` tag **and** Nostr `pubkey` (NIP-01). Each ballot event is signed with its own ephemeral key, so a voter's second ballot does not replace the first: relays keep both. The transport decides nothing about which ballot counts. The §8 tiebreak does, and a tallier MUST apply it to every valid ballot it collects for the voter rather than assume a relay returns only the latest.

A client that reuses one Nostr key for a voter's ballots lets a relay discard all but the newest event, which can lose the ballot a `tiebreak: first` poll counts. Talliers for `tiebreak: first` polls MUST therefore query multiple relays and keep every ballot they receive. Test vector v06 pins the tiebreak, including a tie broken by `ballot_id`.

### 4.6 Anchoring a ballot

A poll whose `deadline` is on or after **2026-11-15T00:00:00Z** is an
**anchored poll**: whether a ballot is in time is decided by the Bitcoin block
that commits to its `ballot_id`. A poll with an
earlier deadline is **clock-dated**: it is tallied as before, by `created_at`,
and its tally says so (§8). The poll's bytes are the same either way.

**The anchor.** A ballot is anchored by an [OC Stamp v1](https://github.com/orangecheck/oc-stamp-protocol)
envelope (kind 30083) over the ballot:

- `content.hash` = `"sha256:" || ballot_id`. The stamped bytes are the ballot's
  canonical bytes with `sig.value` emptied, the bytes `ballot_id` hashes (§7.2).
- `content.length` = the length of those bytes; `content.mime` =
  `application/vnd.oc-vote.ballot+json`.
- Any address may sign the stamp: the voter, the poll's creator, or anyone. The
  stamp proves only that `ballot_id` existed before its anchor block; who signed
  it says nothing about the ballot.

Stamps over a ballot are found with
`REQ { "kinds": [30083], "#t": ["sha256:<ballot_id>"] }` (OC Stamp §7.1).

**Anchor height.** `anchor_height(b)` is the lowest block height among the
stamps over `b` whose OpenTimestamps anchor the tallier verified itself. A stamp
counts toward it only if:

- its id reconstructs (OC Stamp §8.1 step 3);
- its `content.hash`, read from the rebuilt stamp, equals
  `"sha256:" || ballot_id(b)`. The tallier MUST check this: the `#t` tag that
  found the stamp is relay metadata, outside the stamp id. `content.length` and
  `content.mime` do not bear on priority;
- its proof walks from that id to a Bitcoin attestation whose block header the
  tallier checked itself (OC Stamp §6.3, §7.2 step 2). The height is that of
  the earliest such attestation in the proof, never a declared `block_height`
  that disagrees.

A tallier MUST query several relays and keep every stamp over a ballot that any
of them returns, never one per ballot or one per `d` tag: several stamps can
cover one ballot, and copies of one stamp carry different proofs as calendars
upgrade them. It takes the lowest height it verified across all of them, as
OC Stamp §7.2 does. The stamp's own signature (OC Stamp §8.1 step 4) does not
bear on priority, and a tallier MAY skip it. A ballot with no such stamp has no
anchor height.

An anchor the tallier could not check, because a block header could not be
read, is not a missing anchor. Until it can check every stamp it holds, a
tallier MUST NOT produce a final tally.

**What the anchor decides.** Whether a ballot's bytes existed in time, and
nothing else. When the ballot was published does not bear on it.

**Close.** `H_close` is the greatest block height whose `median_time_past` ≤
`deadline` (§0), the block §3.3 resolves for `snapshot_block: "deadline"`. It is
known once a block whose `median_time_past` is after `deadline` exists; until
then it is `none`. `G` is 36 blocks, about six hours, for calendar aggregation
and block inclusion.

- A final tally of an anchored poll counts a ballot only if
  `anchor_height(b) ≤ H_close + G`; any other ballot is dropped with
  `E_NOT_ANCHORED`.
- The tally is final only once `H_close` is known and the tallier's chain tip
  is at least `H_close + G + 6`. Before that it is **provisional** (§8): it
  counts every ballot that passes the other checks, anchored or not, and says
  how many of them are not yet anchored at or below `H_close + G`.

**How late a ballot can count.** `median_time_past` is the median of the last
eleven block times, so it trails the clock by about six blocks: `H_close` is
usually mined about an hour after `deadline`. A ballot dated at or before
`deadline` (§4.3) but cast after it can therefore still be anchored at or below
`H_close + G` and count.

**Who anchors.**

- A voter's client SHOULD stamp each ballot it publishes, submit the stamp id to
  at least two calendars (OC Stamp §6.1), publish the stamp, and republish it
  once upgraded (OC Stamp §7.2). As the deadline nears it SHOULD tell its voter
  when their ballot has no confirmed anchor yet.
- Anyone may anchor any ballot they can see. **vote.ochk.io runs a convenience
  anchorer** that stamps every ballot it observes for an open anchored poll and
  publishes the stamps. It is named here because a voter may rely on it for
  liveness; it is never required, anyone can run another, and a tally depends
  only on the anchors, not on who made them. It works within published limits,
  per run (every ten minutes): at most 300 new stamps, shared round-robin across
  polls, and at most 50 per poll, in the order it first saw the ballots (never
  by a date a publisher chose); at most 50 polls read, chosen at random when
  more are open. What a limit leaves waits for a later run, and every stamp it
  made is upgraded and republished whatever the limits. Its health page says
  when a limit left work, and voters' clients anchor their own ballots, as
  above.
- The OpenTimestamps calendars are trusted for liveness only: they can delay a
  proof, not backdate one (OC Stamp §11.3).

## 5. Weight modes

### 5.1 Definitions

Given a voter's address `a` and the set `U(a, H)` of UTXOs controlled by `a` at snapshot block height `H`:

```
qualifying_utxos(a, H, min_days) :=
  { u ∈ U(a, H) : age_days(u, H) ≥ min_days }

total_qualifying_sats(a, H, min_days) :=
  sum of u.value for u in qualifying_utxos(a, H, min_days)
```

where `age_days(u, H)` is `(H - u.confirmed_height) * 10 / (60 * 24)` rounded down, treating each Bitcoin block as 10 minutes on average. Implementations SHOULD use block timestamps where available; a canonical implementation is provided in §7.3.

### 5.2 `one_per_address`

```
if total_qualifying_sats(a, H, poll.min_days) >= poll.min_sats:
    weight(a) = 1
else:
    weight(a) = 0
```

No `weight_params`.

### 5.3 `sats`

```
let S = total_qualifying_sats(a, H, poll.min_days)
if S >= poll.min_sats:
    weight(a) = S
else:
    weight(a) = 0
```

No `weight_params`.

### 5.4 `sats_days`

```
let U = qualifying_utxos(a, H, poll.min_days)
let S = sum(u.value for u in U)
if S < poll.min_sats:
    weight(a) = 0
else:
    let cap = weight_params.cap_days    // positive integer; REQUIRED
    weight(a) = sum(
      u.value * min(age_days(u, H), cap)
      for u in U
    )
```

`weight_params` MUST be an object with `cap_days` (positive integer). The cap prevents a single ancient UTXO from drowning out all fresh commitments.

## 6. Secret-ballot mode

### 6.1 Reveal keypair

The poll creator generates a fresh X25519 keypair `(reveal_sk, reveal_pk)`. `reveal_pk` is published in the poll (`poll.reveal_pk`). `reveal_sk` MUST be stored securely and not published before `deadline`.

### 6.2 Sealing an option

The voter encrypts their chosen option id using the OC Lock v2 envelope format with a synthetic recipient whose `device_pk` is the poll's `reveal_pk`:

```
synthetic_recipient := {
  address:   "oc-vote:reveal:" || poll_id,
  device_id: "reveal",
  device_pk: poll.reveal_pk
}
```

The envelope plaintext is the UTF-8 bytes of `chosen_option_id`. Sealing follows OC Lock §4.2 verbatim except that:

- The synthetic recipient has no `binding_sig` (the reveal device is poll-local, not bound to a Bitcoin address). Voters' OC Lock implementations MUST accept this and skip the binding verification that would normally be required.
- The envelope `from.address` is the voter's address.

Conforming tallier implementations MUST accept envelopes sealed for this synthetic recipient.

### 6.3 Publishing the reveal

At or after `deadline`, the creator publishes the reveal as kind `30082`:

```
reveal_object := {
  "v": 0,
  "kind": "oc-vote/reveal",
  "poll_id": poll_id,
  "reveal_sk": "<32-byte hex X25519 secret>",
  "revealed_at": "<iso8601_utc>",
  "sig": {
    "alg": "bip322",
    "pubkey": creator_addr,
    "value": "<base64(BIP322(creator, reveal_id))>"
  }
}
reveal_id := SHA256(canonical_bytes(reveal_with_sig.value_set_to_""))
```

```
event.kind    = 30082
event.tags    = [
  ["d",       "oc-vote:reveal:" || poll_id],
  ["t",       poll_id],
  ["t",       "oc-vote-reveal"],
  ["poll_id", poll_id]
]
event.content = canonical_bytes(reveal_object)
```

### 6.4 Unsealing

Given a secret-mode ballot and the reveal_sk, the tallier:

1. Verifies the reveal (§10.3): its BIP-322 signature against the poll's `creator`, that `x25519_base(reveal_sk) == poll.reveal_pk`, and that the reveal is not premature. A reveal that fails any check is not a reveal, and the poll stays `awaiting reveal` (§6.5).
2. Derives `device_sk = reveal_sk` and runs OC Lock §4.3 decryption on `ballot.secret.envelope` to recover the plaintext option id.
3. Recomputes `commit` per §4.4 and compares to `ballot.secret.commit`. Rejects on mismatch (`E_COMMIT_MISMATCH`).
4. Substitutes the decrypted option id into the ballot for tally purposes.

### 6.5 Abandoned polls

If no valid reveal event exists for a secret-mode poll at tally time, the poll is **abandoned**. Clients MUST display the state as "awaiting reveal" and MUST NOT produce a tally. Observers MAY still enumerate the ballots (§6.5), which proves participation even if the choices are opaque.

### 6.5 Discovering the ballots in a poll

Relays index **single-letter** tag names only (NIP-12), and tag filters are
exact-match — NIP-01 defines no prefix operator. A ballot's `d`-tag is
`oc-vote:ballot:<poll_id>:<voter>`, so `#d` can only fetch a ballot whose
voter you already know, and enumerating the voters is precisely what a tally
needs. The indexed `t` tag is therefore the only route:

```
REQ { "kinds": [30081], "#t": ["<poll_id 64-hex>"] }     // every ballot in the poll
REQ { "kinds": [30080], "#t": ["<poll_id 64-hex>"] }     // the poll
REQ { "kinds": [30082], "#t": ["<poll_id 64-hex>"] }     // the reveal
```

Because `t` is a shared namespace on these events — poll id, family marker,
and voter or creator address all use it — a tallier MUST confirm each matched
event against its content and MUST NOT trust the tag alone: accept a ballot
only if `content.poll_id` equals the poll being tallied, and de-duplicate by
`ballot_id`. Expect several ballots per voter: each is its own Nostr event
(§4.5), and the §8 tiebreak picks one.

> **Errata (2026-09-02).** §3.4 / §3.6 / §6.3 previously specified only the
> multi-letter `poll_id` / `voter` / `creator` tags. A `#poll_id` filter
> matches nothing on a conforming relay, so ballot enumeration — and with it
> every tally — was impossible as specified, while §6.3 asserted that
> observers MAY enumerate ballots. `@orangecheck/vote-cli` and
> `vote.ochk.io/api/tally` both implemented the specified filter and returned
> zero ballots for every poll. The multi-letter tags are retained for
> readability; a verifier MUST NOT depend on them. No migration is required:
> a sweep of five relays on 2026-09-02 found zero kind-3008x events carrying
> an `oc-vote:` `d`-tag prefix.

## 7. Canonicalization

The canonical byte representation is required for computing all `*_id` values and for BIP-322 signing. Canonical form:

- UTF-8 JSON with keys sorted lexicographically at every level.
- No insignificant whitespace (no spaces after `:` or `,`, no leading / trailing whitespace).
- Arrays preserve insertion order. Within `poll.options[]`, implementations MUST preserve the order the creator chose.
- Numbers serialized with no fractional zeros and no exponents for integers within IEEE 754 double range.
- Strings: `\uXXXX` escapes only for control characters (U+0000–U+001F), `"` (U+0022), and `\` (U+005C). All other codepoints literal.
- Final byte is LF (`0x0a`).

Reference: [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) with the additional constraint on `options[]` order.

### 7.1 Computing `poll_id`

```
p := deep_copy(poll)
p.sig.value := ""
poll_id := hex(SHA256(canonical_bytes(p)))
```

### 7.2 Computing `ballot_id`

```
b := deep_copy(ballot)
b.sig.value := ""
ballot_id := hex(SHA256(canonical_bytes(b)))
```

### 7.3 Computing UTXO age

```
age_days(u, H) := max(0, floor((H - u.confirmed_height) * 600 / 86400))
```

`600 / 86400` is the average number of days per block assuming 10-minute blocks. Implementations MAY substitute block-timestamp-based ages in future versions but v0 uses the block-count approximation for reproducibility. Two implementations given the same `(H, u.confirmed_height)` MUST produce the same `age_days`.

## 8. Tally algorithm

```
function tally(poll, ballots[], utxos_at: (addr, H) -> UTXOSet, reveal_sk: optional,
               tip_height, close_height, anchor_height: (ballot_id) -> height | none):
  # reveal_sk comes from a reveal accepted under §10.3, else None.
  # close_height (H_close, none while unknown) and anchor_height are for an anchored poll only (§4.6).
  # 1. Drop unsignable / untrusted ballots
  if not verify_bip322(poll.creator, poll_id(poll), poll.sig.value):
    reject(E_BAD_SIG)             # §10.1
  if not is_iso8601_utc(poll.deadline): reject(E_WRONG_POLL)   # §3.3
  anchored = instant(poll.deadline) >= instant("2026-11-15T00:00:00Z")   # §4.6
  final = not anchored or (close_height is not none and tip_height >= close_height + G + 6)
  head = { "basis": anchored ? "anchored" : "voter_clocks" }
  if anchored: head.close_height = close_height          # null while none
  in_time(b) = anchor_height(ballot_id(b)) is not none and
               (close_height is none or anchor_height(ballot_id(b)) <= close_height + G)
  valid = []
  for b in ballots:
    if b.poll_id != poll.poll_id: continue
    if not is_mainnet(b.voter): continue      # §4.3
    if not is_iso8601_utc(b.created_at): continue              # §0, §4.3
    if instant(b.created_at) > instant(poll.deadline): continue
    if anchored and final and not in_time(b): continue          # E_NOT_ANCHORED
    if not verify_bip322(b.voter, ballot_id(b), b.sig.value): continue
    if poll.mode == "secret":
      if b.secret == null: continue
    else:
      if b.option == null: continue
      if b.option != "withdraw" and b.option not in [o.id for o in poll.options]: continue
    valid.append(b)

  # 2. De-duplicate per voter
  per_voter = {}
  for b in valid:
    k = b.voter
    if k not in per_voter:
      per_voter[k] = b
    else:
      per_voter[k] = choose_by_tiebreak(per_voter[k], b, poll.tiebreak, anchored)
  option_of = { voter: b.option for voter, b in per_voter }

  # 3. Reveal if secret-mode
  if poll.mode == "secret":
    if reveal_sk is None:
      return head + { "state": "awaiting_reveal" }
    for voter, b in per_voter:     # the de-duplicated ballot, never another
      try:
        option = unseal_and_verify_commit(b.secret, reveal_sk, voter, poll.poll_id)
        if option != "withdraw" and option not in [o.id for o in poll.options]:
          raise E_UNKNOWN_OPTION
        option_of[voter] = option
      except:
        del per_voter[voter]   # E_COMMIT_MISMATCH / E_UNKNOWN_OPTION

  # 4. Compute snapshot block
  H = resolve_snapshot(poll.snapshot_block, poll.deadline)
  if H is none or tip_height - H + 1 < 6:
    return head + { "state": "deferred", "code": "E_REORG" }   # §10.5

  # 5. Sum weights per option
  tallies = { o.id: 0 for o in poll.options }
  turnout = { "voters": 0, "weight": 0 }
  for voter, b in per_voter:
    option = option_of[voter]
    if option == "withdraw": continue
    if option not in tallies: continue
    U = utxos_at(voter, H)
    w = weight_for_mode(poll.weight_mode, poll.weight_params, poll.min_sats, poll.min_days, U, H)
    if w == 0: continue
    tallies[option] += w
    turnout.voters += 1
    turnout.weight += w

  result = head + {
    "state": final ? "tallied" : "provisional",
    "snapshot_block": H,
    "turnout": turnout,
    "tallies": tallies,
    "counted": sorted([ballot_id(b) for voter, b in per_voter])
  }
  if not final:
    result.unanchored = count([b for voter, b in per_voter if not in_time(b)])
  return result
```

`basis` says what decided whether a ballot was in time: `"anchored"` for an
anchored poll (§4.6), `"voter_clocks"` for a clock-dated poll, whose ballots are
dated by the voters' own clocks. Every result carries it, `awaiting_reveal` and
`deferred` included, and every result for an anchored poll also carries
`close_height` (`null` while `H_close` is `none`). A client MUST show a
`"voter_clocks"` tally as dated by the voters, and a `"provisional"` tally as
not yet final. A secret-mode anchored poll is never provisional: its reveal is
accepted only once the tally can be final (§10.3), so until then it is
`awaiting_reveal`.

`counted` lists the `ballot_id` of the ballot that stood for each voter after
step 3, withdrawals and ballots that weigh zero included, as lowercase hex in
ascending order.
`unanchored`, in a provisional tally, is how many of those have no anchor at or
below `H_close + G` yet (no anchor at all while `H_close` is `none`).

A tally covers the ballots its tallier found. A ballot found later counts in a
later tally under the same rules. A client that shows an earlier tally SHOULD
show such a ballot apart from it, as surfaced after that tally, and MUST NOT
fold it into that tally's figures. `counted` records what one tally saw; it
never excludes a ballot from another tally, whoever publishes it.

The plaintext for a voter MUST come from unsealing that voter's entry in
`per_voter` — the ballot that passed step 1 and won step 2. A tallier MUST
NOT unseal ballots before steps 1–2 and look the result up by voter, because
a ballot that fails step 1 can name the same voter. Option ids are compared
as plain strings; an implementation MUST NOT let an option id resolve to an
inherited property of a map or object (for example `__proto__` or
`constructor`).

When a relay returns several kind-30080 or kind-30082 events for one `d`
tag, the poll is an event whose content hashes to the requested `poll_id`
and whose `sig` verifies (§10.1), and the reveal is one that satisfies §6.4
and §10.3. Event recency is not a selection rule: anyone can publish under
any `d` tag with any `created_at`.

`choose_by_tiebreak(a, b, t, anchored)` orders a voter's ballots by the key
`(anchor_height, instant(created_at), ballot_id)` in an anchored poll, and by
`(instant(created_at), ballot_id)` in a clock-dated one. In a provisional tally
an unanchored ballot's `anchor_height` sorts after every height.
- If `t == "latest"`: pick the ballot with the greater key.
- If `t == "first"`: pick the ballot with the lesser key.

In an anchored poll the block that anchored a ballot outranks its `created_at`:
under `first`, a ballot dated earlier but anchored later does not displace the
one anchored first.

Two conforming implementations running the same tally on the same inputs MUST produce byte-identical output when serialized canonically.

## 9. Error codes

| Code | Meaning |
|---|---|
| `E_BAD_SIG` | A BIP-322 signature did not verify. |
| `E_WRONG_POLL` | Ballot's `poll_id` does not match the poll being tallied. |
| `E_PAST_DEADLINE` | Ballot `created_at` is after `poll.deadline`. |
| `E_UNKNOWN_OPTION` | Ballot references an option id not in the poll. |
| `E_COMMIT_MISMATCH` | Revealed option does not match ballot's `secret.commit`. |
| `E_BELOW_THRESHOLD` | Voter's qualifying sats/days below `min_sats`/`min_days`. Contributes zero weight (not an error per se — a status). |
| `E_NO_REVEAL` | Secret-mode poll past deadline with no reveal event — state is `awaiting_reveal`. |
| `E_NOT_ANCHORED` | A ballot in an anchored poll has no anchor at or below `H_close + G` (§4.6). It is dropped from a final tally. |
| `E_REORG` | Snapshot block is not yet known or has fewer than 6 confirmations at tally time. The tally is deferred (§8). |
| `E_UNSUPPORTED_MODE` | Client does not implement `poll.weight_mode`. |

## 10. Security-relevant requirements

Normative compliance conditions for correctness:

1. **Verify every signature.** A ballot whose `sig.value` fails BIP-322 verification against `voter` MUST be dropped. A poll whose `sig.value` fails verification against `creator` MUST be rejected.
2. **Verify `ballot_id` before signing.** The signer MUST compute `ballot_id` from the canonical serialization and confirm byte-equality with the input to BIP-322 before producing `sig.value`.
3. **Reject premature and mismatched reveals.** For an anchored poll (§4.6), a tallier MUST NOT accept a reveal until its chain tip is at least `H_close + G + 6`, and never while `H_close` is `none`. For a clock-dated poll, it MUST NOT accept one while its own clock reads before the poll's `deadline`. The reveal's `revealed_at` is the creator's statement and decides neither. A tallier MUST also reject a reveal whose `reveal_sk` is not the X25519 secret key for the poll's `reveal_pk` (SECURITY Scenario 13).
4. **Reject polls past deadline.** Clients MUST NOT accept ballots for a poll whose `deadline` has passed at publication time.
5. **Refuse double-tally without reorg protection.** Tallies MUST be deferred if the snapshot block is not yet known or has fewer than 6 confirmations at tally time.
6. **Canonicalize identically.** Two conforming implementations MUST produce byte-identical canonical bytes for the same object.
7. **Never reveal partial tallies of a secret-mode poll.** Clients MUST NOT decrypt or surface individual ballot choices before a valid reveal event exists.
8. **Count only anchored ballots in a final tally of an anchored poll.** A final tally counts a ballot only if its anchor, verified by the tallier against Bitcoin block headers, is at or below `H_close + G`, and is produced only once the chain tip is at least `H_close + G + 6` (§4.6). Before that a tally is labelled provisional.

See [`SECURITY.md`](./SECURITY.md) for threat model, caveats, and reporting channel.

## 11. Weight-mode registry

`weight_mode` values outside the v0 canonical set (§5) are considered extensions. Extension names MUST match `[a-z][a-z0-9_]{0,31}` and SHOULD be prefixed with an organization tag (`acme_sqrt`, `btcpf_v1`). A registry of well-known extensions lives at `registry/weight-modes.json` in this repository; adding a mode is a PR.

Clients MUST reject polls whose `weight_mode` they do not support with error `E_UNSUPPORTED_MODE`. Partial support is not permitted (a client either fully implements a weight mode or not).

## 12. Versioning

`v` is an integer. Future incompatible changes increment it. Clients MUST reject polls and ballots whose `v` they do not support. Minor additions (new weight modes via registry, new optional fields in `notes`) are backward-compatible within a major version.

## 13. Future work (non-normative)

These are explicitly NOT in v0:

- **Threshold reveal.** Replace the creator-held reveal with an (n, t) threshold secret-sharing across trustees, or with a drand / tlock-based time-lock so no party holds the reveal_sk.
- **Homomorphic tally.** Ballots as ElGamal ciphertexts with zero-knowledge proofs of well-formedness; a tallier aggregates ciphertexts without decrypting individual ballots. Produces receipt-freeness.
- **Delegation.** A separate signed "delegation attestation" (`oc-vote/delegate`) that transfers a voter's weight to another address for the duration of a poll.
- **Quadratic weight mode.** Canonical `sqrt(sats)` or `sqrt(sats * days)` mode with clear rounding rules.
- **Cross-asset weight.** Combine Bitcoin UTXO weight with Lightning channel capacity, Liquid L-BTC holdings, or timelocked covenants. Requires a canonical cross-asset weight formula.
- **Off-chain weight proofs.** Provers that attest to historic UTXO state without requiring the tallier to run a full node (e.g., `utreexo` accumulators).

## 14. IANA / external identifiers

- Nostr event kinds:
  - **30080** — poll (addressable, general replaceable range)
  - **30081** — ballot (addressable; each ballot event has its own key, so relays keep a voter's earlier ballots and the §8 tiebreak decides, §4.5)
  - **30082** — reveal (addressable, one per poll)
- `d`-tag namespaces claimed by this spec: `oc-vote:poll:*`, `oc-vote:ballot:*`, `oc-vote:reveal:*`
- File extensions: none claimed (poll / ballot / reveal objects are JSON transported via Nostr or URL fragments)
- MIME types: `application/vnd.oc-vote.poll+json`, `application/vnd.oc-vote.ballot+json`, `application/vnd.oc-vote.reveal+json` (self-allocated; not IANA-registered)

## 15. Compliance checklist

A client is OC Vote v0 compliant if and only if:

- [ ] Canonicalizes objects per §7 and produces identical `poll_id` / `ballot_id` / `reveal_id` across implementations
- [ ] Verifies `creator` BIP-322 signature on every poll before processing
- [ ] Verifies `voter` BIP-322 signature on every ballot before counting
- [ ] Implements `one_per_address`, `sats`, and `sats_days` weight modes per §5
- [ ] Enforces `min_sats` / `min_days` thresholds
- [ ] Correctly de-duplicates per voter per §8 tiebreak rules
- [ ] Defers tally while the snapshot block is unknown or has < 6 confirmations
- [ ] In an anchored poll, verifies ballot anchors against block headers, counts only ballots anchored at or below `H_close + G` in a final tally, and labels a tally provisional until the tip reaches `H_close + G + 6` (§4.6)
- [ ] In an anchored poll, keeps every stamp over each ballot from every relay, checks each rebuilt stamp's `content.hash` against `ballot_id`, takes the lowest anchor it verified, and produces no final tally while any anchor cannot be checked (§4.6)
- [ ] Labels a clock-dated tally as dated by the voters' own clocks, and reports `basis` on every result (§8)
- [ ] Lists the ballots a tally counted, and shows a ballot found after a tally apart from it (§8)
- [ ] Refuses to reveal or display partial secret-mode tallies before a valid reveal event
- [ ] Verifies `secret.commit` matches the revealed option at tally time
- [ ] Produces test-vector-identical output for the fixtures in [`test-vectors/`](./test-vectors/)
- [ ] Emits error codes per §9

## 16. Acknowledgements

OC Vote stands on the design rules established by [OrangeCheck](https://github.com/orangecheck/oc-web/blob/main/docs/oc-protocol/VISION.md) and the encoding conventions of [OC Lock](https://github.com/orangecheck/oc-lock-protocol/blob/main/SPEC.md). The framing of Bitcoin weight as the load-bearing sybil filter extends the OrangeCheck family's view of Bitcoin as a sovereignty substrate. See [`WHY.md`](./WHY.md) for the design rationale.

---

End of specification.
