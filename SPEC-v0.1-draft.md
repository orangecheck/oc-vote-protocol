# OC Vote Protocol v0.1 — DRAFT

**Status:** Draft · design-only · no implementation commitments
**Date:** 2026-04
**Supersedes:** nothing — this is an additive draft over [`SPEC.md`](./SPEC.md) v0

---

## 0. What this document is

This is the design draft for v0.1 of the OC Vote protocol. It is **not normative**. The canonical spec is `SPEC.md` (v0). Two future-work items from `SPEC.md` §13 are promoted here to concrete proposals:

1. **Threshold reveal** — eliminate the "creator can peek early" + "creator can abandon" failure modes in secret-mode polls by replacing a single `reveal_sk` held by the creator with either an `(n, t)` secret-shared key held by trustees, or a drand-tlock-locked key that becomes derivable from a public beacon at a fixed future time.
2. **Delegation attestation** — let a voter transfer their weight to another address for the duration of a single poll, without on-chain activity.

Both are additive: a v0 client encounters a v0.1 secret-mode poll and rejects it as `E_UNSUPPORTED_MODE` rather than silently miscomputing. The `v` field increments from 0 to 1 for objects that carry the new fields.

Feedback welcome at `security@ochk.io` subject prefix `[protocol]` or via issue on [`orangecheck/oc-vote-protocol`](https://github.com/orangecheck/oc-vote-protocol).

## 1. Threshold reveal

### 1.1 The problem (restated)

In v0 secret-mode, the poll creator holds `reveal_sk` in IndexedDB and publishes it at deadline. This has two honest-but-serious limitations (`WHY.md` H7):

- **Early peek.** The creator can decrypt any or all ballots before deadline. They can't publish an early tally without leaking the key (an observable action), but they can privately know the running score and strategize.
- **Non-reveal.** If the creator loses their browser state, refuses to publish, or disappears, the poll is permanently abandoned — participation remains provable, but the tally is unreachable.

Neither is acceptable for contested governance ballots, DAO treasury votes, or anything with meaningful economic stakes. v0.1 defines two trust-minimized alternatives; a poll picks one via a new `reveal_scheme` field.

### 1.2 Two reveal schemes

#### `reveal_scheme: "creator"` (v0-compatible)

Identical to v0. Single creator-held `reveal_sk`. Retained for low-stakes signaling where creator trust is acceptable.

#### `reveal_scheme: "tlock"` (drand timelock)

The reveal key is locked to a specific round on a public drand beacon network (default: [drand quicknet](https://drand.love), which produces a publicly-verifiable threshold-signed round every 3 seconds). At round `R`, the network's threshold signature over `R` is computable by anyone; that signature, via IBE (identity-based encryption), derives the reveal key.

Key property: **nobody can derive `reveal_sk` before round `R` fires**, not even the drand network's own partial-signature holders. Nobody can *withhold* it after, because any observer can read the round from any public drand endpoint.

- Poll author computes `reveal_round` based on `deadline + confirmation_delay`.
- No creator holds a reveal key; the "key" is a future public beacon round.
- After `reveal_round` fires, any observer can derive `reveal_sk` and run the tally.
- `awaiting_reveal` → `tallied` transition is automatic at round-fire time.

#### `reveal_scheme: "trustees"` (n-of-m Shamir)

`reveal_sk` is split via Shamir Secret Sharing into `m` shares, each issued to a named trustee identified by their Bitcoin address. Any `n ≤ m` shares reconstruct the key. Partial-share disclosure reveals nothing about the secret.

- Trustee list published in the poll (names + Bitcoin addresses).
- At deadline, trustees each publish their share via a BIP-322-signed `oc-vote/share` event.
- `n` valid shares allow any observer to reconstruct `reveal_sk` and tally.
- Threshold `n` chosen by the poll author (typically `⌈m/2⌉ + 1` or `⌈2m/3⌉`).

Works offline — trustees can publish shares from cold environments. Tolerates up to `m - n` missing or adversarial trustees.

### 1.3 Poll schema changes

Additive fields in the v0.1 poll object:

```json
{
  "v": 1,
  "kind": "oc-vote/poll",
  ...
  "mode": "public" | "secret",
  "reveal_scheme": "creator" | "tlock" | "trustees" | null,
  "reveal": null | {
    // creator:
    "scheme": "creator",
    "reveal_pk": "<hex>"
  } | {
    // tlock:
    "scheme": "tlock",
    "beacon":  "https://api.drand.sh",
    "chain_hash": "<hex>",
    "round":   <int>,
    "reveal_pk": "<hex>"
  } | {
    // trustees:
    "scheme": "trustees",
    "reveal_pk": "<hex>",
    "trustees": [
      { "name": "<string>", "address": "<btc>", "share_pk": "<hex>" }
    ],
    "threshold": <int>
  },
  ...
}
```

The existing `reveal_pk` top-level field is **deprecated** in v0.1 — moved inside `reveal.reveal_pk`. v0 clients reject v0.1 polls via `v: 1 > supported`.

### 1.4 New canonical objects

#### `oc-vote/share` (trustees scheme only)

Published by each trustee at deadline.

```json
{
  "v": 1,
  "kind": "oc-vote/share",
  "poll_id": "<hex>",
  "trustee": "<btc addr of trustee>",
  "share_index": <int>,
  "share_value": "<hex>",
  "published_at": "<iso8601>",
  "sig": { "alg": "bip322", "pubkey": "<trustee addr>", "value": "<base64>" }
}
```

Content-addressed: `share_id = SHA-256(canonical bytes with sig.value = "")`.
Nostr kind: **30083** (addressable, one per `(poll_id, trustee)`).
d-tag: `oc-vote:share:<poll_id>:<trustee_addr>`.

#### `oc-vote/reveal` — v1

Existing kind-30082 event, with scheme-specific payload:

```json
// creator (unchanged from v0):
{ "v": 1, "kind": "oc-vote/reveal", "poll_id": "...", "scheme": "creator", "reveal_sk": "<hex>", "revealed_at": "...", "sig": {...} }

// tlock (published by any observer after round fires):
{ "v": 1, "kind": "oc-vote/reveal", "poll_id": "...", "scheme": "tlock", "beacon_signature": "<hex>", "round": <int>, "revealed_at": "...", "sig": null }

// trustees (published by whoever reconstructs first):
{ "v": 1, "kind": "oc-vote/reveal", "poll_id": "...", "scheme": "trustees", "reconstructed_sk": "<hex>", "share_ids": ["...", "..."], "revealed_at": "...", "sig": null }
```

Note: tlock + trustees reveal objects have `sig: null` because there is no authoritative signer — anyone can derive the key once the beacon/shares are available. The tallier verifies by **independently rederiving** the key from the public inputs and checking that `x25519_base(reveal_sk) == poll.reveal.reveal_pk`.

### 1.5 Tally algorithm changes (SPEC §8)

Step 4 of the v0 algorithm (snapshot resolution) is unchanged. Step 3 (reveal) becomes scheme-dependent:

```
if poll.mode == "secret":
    scheme = poll.reveal.scheme
    switch scheme:
        case "creator":
            reveal_sk = fetch_reveal_event_creator(poll.poll_id)
            // unchanged from v0
        case "tlock":
            round_sig = fetch_drand_round(poll.reveal.beacon, poll.reveal.chain_hash, poll.reveal.round)
            if round_sig is None: return { state: "awaiting_reveal" }
            reveal_sk = tlock_derive(poll.reveal.reveal_pk, round_sig)
            verify: x25519_base(reveal_sk) == poll.reveal.reveal_pk   // MUST hold; otherwise return invalid
        case "trustees":
            shares = fetch_shares(poll.poll_id)
            valid_shares = [s for s in shares if verify_bip322(s.trustee, share_id(s), s.sig.value)]
            if count(valid_shares) < poll.reveal.threshold: return { state: "awaiting_reveal" }
            reveal_sk = shamir_reconstruct(valid_shares[:threshold])
            verify: x25519_base(reveal_sk) == poll.reveal.reveal_pk
    // then unseal each ballot as in v0, check commits, substitute options
```

### 1.6 Security notes

**`tlock`:**

- No party can peek early. The beacon's threshold signature over round `R` doesn't exist until round `R` fires, by the drand network's own liveness + safety guarantees.
- Nobody can withhold. Any observer can query any drand endpoint or relay at round-fire time.
- Trust shifts from a single creator to the drand threshold network (currently operated by ~20 independent orgs; a majority must collude to forge or withhold a round).
- Abandoned polls become impossible — the tally becomes computable exactly at round `R`, unless drand itself fails (at which point much more than this protocol is broken).

**`trustees`:**

- No party below `n` can peek — Shamir's threshold property.
- Trustees above `n` could collude to peek early. The scheme shifts trust from a single creator to the trustee set.
- Non-reveal possible if fewer than `n` trustees publish shares — but with `m > n`, tolerates `m - n` missing ones.
- Trustee identity is on-record via BIP-322 signatures. Malicious trustees (leaked early, or refused to publish) are publicly attributable.
- Pre-distribution of shares requires a trusted setup ceremony by the poll author; this is the price of eliminating the drand dependency.

### 1.7 Compliance

v0.1-conformant implementations:

- Accept `v: 0` polls (backward-compatible with v0 spec).
- Accept `v: 1` polls with `reveal_scheme ∈ { "creator", "tlock", "trustees" }`.
- Reject `v: 1` polls with an unknown `reveal_scheme` (`E_UNSUPPORTED_MODE`).
- Verify rederiving `x25519_base(reveal_sk) == poll.reveal.reveal_pk` at tally time for all schemes (guards against hostile reveal substitution).
- For `tlock`: use a pinned drand chain by hash; never trust a random-looking beacon endpoint to identify itself.
- For `trustees`: verify each published share's BIP-322 signature against the declared trustee address.

### 1.8 Test vectors (planned)

```
v06-tlock-minimal.json         single-voter secret-mode poll with tlock reveal
v07-trustees-3-of-5.json       three-of-five threshold, all 5 trustees publish
v08-trustees-3-of-5-missing.json  three-of-five, only 3 publish (still valid)
v09-trustees-below-threshold.json  three-of-five, only 2 publish (awaiting_reveal)
v10-tlock-hostile-sk.json      reveal_sk that does not match reveal_pk — must reject
```

None exist yet; drafting them requires canonical wire formats for drand beacon round signatures + Shamir share encodings. Target: include in the next `oc-vote-protocol` commit after this draft lands.

## 2. Delegation attestation

### 2.1 Proposal

A voter may transfer their weight to another address for a single poll by publishing a BIP-322-signed `oc-vote/delegate` event.

```json
{
  "v": 1,
  "kind": "oc-vote/delegate",
  "poll_id": "<hex>",
  "delegator": "<btc addr — the source of the weight>",
  "delegate":  "<btc addr — will cast the combined ballot>",
  "fraction":  1.0,
  "created_at": "<iso8601>",
  "sig": { "alg": "bip322", "pubkey": "<delegator>", "value": "<base64>" }
}
```

Content-addressed ID: `delegate_id = SHA-256(canonical bytes with sig.value = "")`.
Nostr kind: **30084** (addressable, one per `(poll_id, delegator)`).
d-tag: `oc-vote:delegate:<poll_id>:<delegator>`.

### 2.2 Tally effects

At tally time, the tallier builds a delegation graph per poll:

1. Fetch all valid `oc-vote/delegate` events for `poll_id`.
2. Per-delegator dedup with `tiebreak` semantics.
3. Detect cycles (delegator → delegate → ... → delegator). Cycles invalidate **every** delegation in the cycle.
4. For each surviving delegation: transfer `delegator`'s weight (`fraction` × voter_weight) to whoever `delegate` ultimately resolves to (following chains through intermediate delegates).
5. If `delegate` did not cast a ballot, the delegation expires — weight is zero.

### 2.3 Open questions

- **Fractional delegations.** `fraction: 0.5` is tempting (liquid-democracy literature) but breaks tally determinism when combined with integer weights. For v0.1 we propose **forbidding anything except `fraction: 1.0`**; revisit in v0.2.
- **Weight stacking vs transfer.** The current proposal transfers; an alternative is "a vote by the delegate counts as N ballots." The former preserves SPEC §8's one-per-address invariant in tally output; the latter doesn't. We pick transfer.
- **Revocation.** The `tiebreak: latest` rule naturally allows a delegator to revoke by publishing a `oc-vote/delegate` with `delegate: null` (or their own address). Formalize in the normative version.

### 2.4 Complexity note

Delegation adds non-local state to the tally: each voter's weight depends on others' delegations. The pure-function property is preserved — given the same delegation set, the tally is deterministic — but the complexity (O(V log V) for the graph walk) is higher than v0. Conforming implementations MUST document this and MUST handle cycles deterministically.

## 3. What this draft does NOT propose

- **Homomorphic tally.** Still out of scope — requires different primitives (ElGamal ciphertexts, ZK proofs of well-formedness) and a fundamentally different tally function. Defer.
- **On-chain finality.** No proposal to anchor tallies on the Bitcoin chain. Stays off-chain and off-custody.
- **Post-quantum cryptography.** Deferred — same rationale as v0.
- **Delegation-of-delegation.** Chains are allowed and resolved deterministically; but fractional + branching + vote-splitting is punted to v0.2+.
- **Weight-mode additions.** Quadratic voting, logarithmic weighting, etc. remain registry extensions (`SPEC.md` §11) and are not promoted to canonical status.

## 4. Migration path

- v0 polls continue to work forever. This draft only adds new capabilities; it removes nothing.
- v0 clients hitting a v0.1 poll return `E_UNSUPPORTED_MODE` and refuse to tally. This is correct — silently ignoring new fields would misreport tallies.
- Once v0.1 stabilizes, `@orangecheck/vote-core` will add a `v: 1` code path alongside the existing `v: 0` one.

## 5. Acknowledgements

The drand-tlock approach borrows directly from the [tlock paper by Burdges et al.](https://eprint.iacr.org/2023/189) and the [drand timelock-encryption docs](https://drand.love/docs/timelock-encryption/). The Shamir-based threshold path is standard; the framing of "named trustees with BIP-322 accountability" is consistent with the OC family's "trust anchors are named, not hidden" design rule (`WHY.md`).

The delegation design is informed by liquid-democracy literature — Bryan Ford's original [Delegative Democracy](https://www.brynosaurus.com/deleg/deleg.pdf) (2002), and contemporary implementations (LiquidFeedback, Google Votes). The simplification to `fraction: 1.0`-only is a deliberate ship-shipping choice that sacrifices some expressive power for tally determinism.

---

*End of draft.* Comments: `security@ochk.io` prefix `[protocol-v0.1]`, or [issue](https://github.com/orangecheck/oc-vote-protocol/issues).
