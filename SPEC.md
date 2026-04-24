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
- `deadline` — MUST be strictly in the future at the time of publication.
- `snapshot_block` — integer (a specific block height known at poll creation) or the literal string `"deadline"` (deferred to the chain tip at `deadline`). In the deferred case, the tallier MUST use the block whose `median_time_past` is the greatest value `≤ deadline` and has ≥ 6 confirmations.
- `weight_mode` — one of the canonical modes in §5, or a registered extension name (§11).
- `weight_params` — shape is weight_mode-dependent. See §5.
- `min_sats`, `min_days` — non-negative integers. A voter whose qualifying UTXOs do not meet `min_sats` (aged ≥ `min_days` at snapshot) contributes zero weight.
- `mode` — `"public"` means ballots contain a plaintext `option`. `"secret"` means ballots carry an encrypted option envelope; `reveal_pk` MUST be set.
- `reveal_pk` — REQUIRED when `mode == "secret"`, MUST be `null` otherwise.
- `tiebreak` — `"latest"` (highest `created_at`, ties broken by lexicographic ballot id) or `"first"` (lowest `created_at`, ties broken by lexicographic ballot id).
- `notes` — free-form UTF-8; MUST NOT affect tally.
- `created_at` — at or before publication time. SHOULD be UTC.
- `sig` — BIP-322 signature by `creator` over `poll_id`.

### 3.4 Poll publication (Nostr)

A poll is published as an **addressable** event of kind `30080`:

```
event.kind       = 30080
event.tags       = [
  ["d",          "oc-vote:poll:" || poll_id],
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

Clients SHOULD publish to at least three relays from a diverse set. The reference client uses `relay.damus.io`, `relay.nostr.band`, `nos.lol`, `relay.snort.social`.

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
- `created_at` — SHOULD be before `deadline`. Ballots with `created_at > deadline` are discarded by the tally.
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

A ballot is published as an addressable event of kind `30081`, replaceable per (poll, voter):

```
event.kind       = 30081
event.tags       = [
  ["d",          "oc-vote:ballot:" || poll_id || ":" || voter],
  ["poll_id",    poll_id],
  ["voter",      voter],
  ["ballot_id",  ballot_id]
]
event.content    = canonical_bytes(ballot)
event.pubkey     = ephemeral_nostr_pubkey
event.created_at = unix_seconds
```

The `d` tag ensures that re-publishing a ballot from the same voter for the same poll replaces the previous event at conforming relays. This implements the `tiebreak: latest` pattern at the transport layer.

For `tiebreak: first` polls, tallier implementations MUST query multiple relays and collect the minimum-`created_at` ballot per voter, because replaceable events on Nostr discard older versions.

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
  ["poll_id", poll_id]
]
event.content = canonical_bytes(reveal_object)
```

### 6.4 Unsealing

Given a secret-mode ballot and the reveal_sk, the tallier:

1. Verifies the reveal object's BIP-322 signature against the poll's `creator`.
2. Derives `device_sk = reveal_sk` and runs OC Lock §4.3 decryption on `ballot.secret.envelope` to recover the plaintext option id.
3. Recomputes `commit` per §4.4 and compares to `ballot.secret.commit`. Rejects on mismatch (`E_COMMIT_MISMATCH`).
4. Substitutes the decrypted option id into the ballot for tally purposes.

### 6.5 Abandoned polls

If no valid reveal event exists for a secret-mode poll at tally time, the poll is **abandoned**. Clients MUST display the state as "awaiting reveal" and MUST NOT produce a tally. Observers MAY still enumerate the ballots, which proves participation even if the choices are opaque.

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
function tally(poll, ballots[], utxos_at: (addr, H) -> UTXOSet, reveal_sk: optional):
  # 1. Drop unsignable / untrusted ballots
  valid = []
  for b in ballots:
    if b.poll_id != poll.poll_id: continue
    if b.created_at > poll.deadline: continue
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
      per_voter[k] = choose_by_tiebreak(per_voter[k], b, poll.tiebreak)

  # 3. Reveal if secret-mode
  if poll.mode == "secret":
    if reveal_sk is None:
      return { "state": "awaiting_reveal" }
    for voter, b in per_voter:
      try:
        option = unseal_and_verify_commit(b.secret, reveal_sk, voter, poll.poll_id)
        b.option = option
      except:
        del per_voter[voter]   # E_COMMIT_MISMATCH

  # 4. Compute snapshot block
  H = resolve_snapshot(poll.snapshot_block, poll.deadline)

  # 5. Sum weights per option
  tallies = { o.id: 0 for o in poll.options }
  turnout = { "voters": 0, "weight": 0 }
  for voter, b in per_voter:
    if b.option == "withdraw": continue
    if b.option not in tallies: continue
    U = utxos_at(voter, H)
    w = weight_for_mode(poll.weight_mode, poll.weight_params, poll.min_sats, poll.min_days, U, H)
    if w == 0: continue
    tallies[b.option] += w
    turnout.voters += 1
    turnout.weight += w

  return {
    "state": "tallied",
    "snapshot_block": H,
    "turnout": turnout,
    "tallies": tallies
  }
```

`choose_by_tiebreak(a, b, t)`:
- If `t == "latest"`: pick the ballot with greater `created_at`. On ties, pick greater `ballot_id` lexicographically.
- If `t == "first"`: pick the ballot with lesser `created_at`. On ties, pick lesser `ballot_id` lexicographically.

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
| `E_REORG` | Snapshot block has fewer than 6 confirmations at tally time. Tally MUST be deferred. |
| `E_UNSUPPORTED_MODE` | Client does not implement `poll.weight_mode`. |

## 10. Security-relevant requirements

Normative compliance conditions for correctness:

1. **Verify every signature.** A ballot whose `sig.value` fails BIP-322 verification against `voter` MUST be dropped. A poll whose `sig.value` fails verification against `creator` MUST be rejected.
2. **Verify `ballot_id` before signing.** The signer MUST compute `ballot_id` from the canonical serialization and confirm byte-equality with the input to BIP-322 before producing `sig.value`.
3. **Reject stale reveals.** If a reveal event's `revealed_at` is before the poll's `deadline`, the reveal is premature and MUST be rejected by tallier implementations.
4. **Reject polls past deadline.** Clients MUST NOT accept ballots for a poll whose `deadline` has passed at publication time.
5. **Refuse double-tally without reorg protection.** Tallies MUST be deferred if the snapshot block has fewer than 6 confirmations at tally time.
6. **Canonicalize identically.** Two conforming implementations MUST produce byte-identical canonical bytes for the same object.
7. **Never reveal partial tallies of a secret-mode poll.** Clients MUST NOT decrypt or surface individual ballot choices before a valid reveal event exists.

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
  - **30081** — ballot (addressable, replaceable per voter per poll)
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
- [ ] Defers tally when snapshot has < 6 confirmations
- [ ] Refuses to reveal or display partial secret-mode tallies before a valid reveal event
- [ ] Verifies `secret.commit` matches the revealed option at tally time
- [ ] Produces test-vector-identical output for the fixtures in [`test-vectors/`](./test-vectors/)
- [ ] Emits error codes per §9

## 16. Acknowledgements

OC Vote stands on the design rules established by [OrangeCheck](https://github.com/orangecheck/oc-web/blob/main/docs/oc-protocol/VISION.md) and the encoding conventions of [OC Lock](https://github.com/orangecheck/oc-lock-protocol/blob/main/SPEC.md). The framing of Bitcoin weight as the load-bearing sybil filter comes from [Bram Kanstein](https://bramk.substack.com/)'s work on Bitcoin as a sovereignty substrate. See [`WHY.md`](./WHY.md) for the design rationale.

---

End of specification.
