# Why OC Vote exists — and why the design is what it is

> This is the working-out. If you want the normative rules, read [`SPEC.md`](./SPEC.md). If you want the narrative, read [`PROTOCOL.md`](./PROTOCOL.md). If you want to understand which claims are load-bearing and which survived scrutiny, read on.

OrangeCheck gave the open web a **sybil-resistant identity signal**. OC Lock gave it **confidentiality to an identity**. OC Vote is the third primitive in the same family: **legitimacy of a collective signal**. A poll, a petition, a governance vote, a community moderation decision — a thing you want to point at and say "this group, weighted by credible commitment, decided X, and anyone with public data can verify it."

Every attempt to build this has failed on at least one of the five questions every open protocol must answer:

1. Can a bot manufacture a voter?
2. Can a minority aggregate visible commitment into disproportionate weight?
3. Can an observer verify the tally without trusting the tallier?
4. Can a voter's ballot be kept secret until the close?
5. Can the system bootstrap without a token, an authority, or a KYC vendor?

OC Vote's claim is that Bitcoin UTXOs — already proven as an identity signal by OrangeCheck — are the only credible, chain-neutral, time-aware commitment that answers all five without needing any new substrate. The rest of the protocol is plumbing.

## The landscape, honestly audited

| System | Bot-resistant | Weighted | Offline-tallyable | Secret ballot | No token / no KYC |
|---|---|---|---|---|---|
| Google Forms / Typeform | ✗ | ✗ | ✗ | ✗ | ✓ |
| Snapshot (ERC-20 weight) | ✗¹ | ✓ | partial² | ✗ | ✗ (needs a token) |
| Helios | ✓³ | = | ✓ | ✓⁴ | ✗ (needs authority) |
| Polis | weakly | ✗ | ✗ | ✗ | ✓ |
| Gitcoin Passport voting | ✓⁵ | ✓ | partial | ✗ | partial (stamps ≈ KYC) |
| Nostr polls (NIP-88) | ✗ | ✗ | ✓ | ✗ | ✓ |
| Quadratic voting w/ KYC | ✓ | ✓ | partial | partial | ✗ |
| **OC Vote** | ✓ | ✓ | ✓ | ✓ (opt-in) | ✓ |

¹ ERC-20 tokens can be freely acquired by sybils if liquid. ² Requires trusting Snapshot's off-chain JSON or re-deriving state from the governance chain. ³ Via an authority-maintained voter list. ⁴ Via mixnet / homomorphic tally. ⁵ Via a stamp composition that in practice routes back to email/phone/KYC.

The closest competitor on pure cryptographic elegance is **Helios**. The closest competitor on shipped product is **Snapshot**. Neither answers the bootstrap question without dragging in a centralized authority or a token. That's the opening OC Vote walks through.

## The thirteen load-bearing hypotheses

I wrote this protocol by listing every claim the design depends on and trying hard to break each one. What follows is that list. Any hypothesis that didn't survive is flagged as **RETIRED**; any that did is flagged as **KEPT** with the rationale.

---

### H1. Bitcoin UTXOs are the only weight function that's credible, chain-neutral, and time-aware — and cannot be replicated on Ed25519

**Claim.** A voter's weight in an OC Vote tally is a function of the sats they hold at a snapshot block height, and the age of those UTXOs. This weight cannot be cheaply manufactured, is neutral to any particular community's tokenomics, and would make no sense on a non-Bitcoin keypair.

**Adversarial test.** Could we weight by something else and still get the same properties?

- GitHub stars — forgeable via bot accounts; no time component; off-chain.
- ENS names — issued freely, revocable, and governed by a DAO that can change rules.
- ERC-20 balances — require a token, which is exactly the problem Snapshot has; flashloan-able at weight-snapshot time unless blocked.
- Social graph (EigenTrust / WoT) — requires a pre-existing graph, which is what a new community doesn't have.
- Proof-of-humanity (Worldcoin, BrightID) — injects an iris scanner or a video call into the voter flow. Fails the "no KYC" test.
- Age of any pubkey — cheap to backdate; no commitment attached.
- Nostr NIP-05 verified status — verifies a DNS binding, not a commitment.

**Ed25519 substitution test** (from the OrangeCheck vision doc: *if a feature would work identically on Ed25519, stop*). Would this protocol still work if we swapped BIP-322 for an Ed25519 signature over the same messages? Only if we swap `sats × days` for some other weight. But every alternative weight above fails either bot-resistance or bootstrap. **The weight function IS the Bitcoin part.** Ed25519 gets you signed ballots but nothing to weight them with.

**Verdict.** KEPT. This is the thesis of the protocol. If Bitcoin weight isn't load-bearing, there is no reason for OC Vote to exist as an OrangeCheck-family product.

---

### H2. The tally is a pure function of public data, computable by anyone with a Bitcoin node

**Claim.** Given `(poll, ballots[], utxo_snapshot_at_height_H)`, any two implementations produce byte-identical tallies.

**Adversarial test.** What data do we actually need?
- Poll object — content-addressed, reproducible from its bytes.
- Ballots — content-addressed, reproducible from their bytes. Discoverable via Nostr but cacheable anywhere.
- UTXO set at block H — any full node can provide this; no proprietary index required.
- BIP-322 verifier — library, not service.
- HKDF/AES/X25519 — WebCrypto, present everywhere.

What we do NOT need: a trusted tallier, a mempool snapshot, a relay quorum, or a web service.

**Verdict.** KEPT. The spec makes the tally function a pure function with `snapshot_block` baked into the poll message. Anyone disputing a result can re-run the tally with their own node.

---

### H3. One address = one ballot, enforced by canonicalization, not a server

**Claim.** Voters can revise their ballot until the deadline, but exactly one ballot per address counts in the final tally.

**Adversarial test.** What happens if a voter publishes two different ballots with the same `created_at`?
- De-dup by `voter` field. Among ballots with equal `created_at`, break ties by lexicographic ballot id (SHA-256 of canonical bytes).
- Among ballots with different `created_at`, honor `poll.tiebreak`: `latest` (default — supports vote changes) or `first` (locks the first ballot, for commitment scenarios).

What if an attacker floods Nostr with a hundred ballots from the same address? The tally still reduces to one. Relay bandwidth is a separate concern; relay-level rate limiting is orthogonal.

**Verdict.** KEPT. The spec mandates `poll.tiebreak` and makes ballot id computation deterministic.

---

### H4. "One voter, many addresses" is a feature, not a bug

**Claim.** A voter with 10 addresses holding the same total sats × days has the same total weight as the same voter with 1 address holding it all. Address splitting does not inflate weight.

**Adversarial test.** Can a sybil split their stake across N addresses to gain more weight?
- `sats` mode: `sum(sats_i) == sats_total`. No gain.
- `sats_days` mode: `sum(sats_i × age_i)` where each UTXO's age is independent of split. No gain.
- `one_per_address` mode: splitting IS a gain — an attacker with 100k sats can split into 10 addresses of 10k each and get 10 votes. **This is exactly why `one_per_address` enforces `min_sats` and `min_days` thresholds.** Each address must pass the threshold. If a community wants hard one-address-one-vote with high sybil-resistance, it sets `min_sats` high enough to price out splitting.

**Verdict.** KEPT for weighted modes. Explicitly flagged as a trade-off in `one_per_address` mode; communities using it must set thresholds they're willing to defend.

---

### H5. A ballot is one BIP-322 signature over a canonical message — no more

**Claim.** Every ballot is a single BIP-322 signature by the voter's address over a canonical ballot message that commits to poll_id, option, and created_at. No per-poll registration. No "voter list." No helper transactions.

**Adversarial test.** Do we need anything else for correctness?
- Nonce? No — `created_at` + `voter` + `poll_id` are enough to de-dup.
- Challenge from the tallier? No — that would make the tally interactive.
- Proof of UTXO ownership beyond BIP-322? No — BIP-322 already proves address control; the address's UTXOs are public.

**Verdict.** KEPT. This is the "fits on a napkin" line.

---

### H6. The poll is content-addressed, so the creator can't revise it after the fact

**Claim.** `poll_id = sha256(canonical_bytes_with_sig.value = "")`. Any change to the question, options, deadline, snapshot, thresholds, or weight mode produces a different poll_id. Ballots reference a specific poll_id and are invalid for any other poll.

**Adversarial test.** Can a creator publish two polls with the same content but different metadata to split the vote? Yes, they can publish anything, but it's provably a different poll_id. Observers and integrators identify polls by id, not by creator's claim.

Can a creator "move the deadline" after votes are cast? Not without invalidating every ballot (since every ballot references the old poll_id).

**Verdict.** KEPT.

---

### H7. Secret ballots are achievable with creator-commit-reveal, with honest trade-offs

**Claim.** In `secret` mode, each ballot is a Lock-format envelope addressed to a poll-specific reveal keypair. At deadline, the reveal_sk is published. Anyone can then decrypt all ballots and tally.

**Adversarial test #1 — creator peeks early.** The creator holds reveal_sk. They can decrypt ballots mid-poll and see how voting is going. Can they weaponize this?

- They can't publish tallies before deadline without revealing the key (which is itself a detectable action).
- They can privately strategize based on partial results, which is a real attack in adversarial governance scenarios.
- **Mitigation path, v0:** the poll creator is publicly committed by BIP-322 signature; the identity of the peeker is on record.
- **Mitigation path, future:** threshold reveal via drand tlock or n-of-m trustees. Specified as "future work" in §13. Not v0 baseline because it adds a dependency on an external beacon / coordination ritual.

**Adversarial test #2 — creator refuses to reveal.** What if the creator disappears and never publishes reveal_sk?

- The tally is undefined. Observers can see a list of sealed ballots exists but cannot produce a result. This is a legitimate failure mode: the poll is *abandoned*.
- Clients MUST surface "awaiting reveal" as a distinct state from "poll closed." See §9 error codes.

**Adversarial test #3 — is Lock's envelope format actually reusable here?** Lock envelopes target a recipient's `device_pk`. We synthesize a "reveal device" whose `device_pk` is the poll's `reveal_pk`. No binding signature on the reveal device (it's not bound to a Bitcoin address — it's a poll-local ephemeral key). The Lock envelope format still encrypts correctly; only the binding verification step is skipped for reveal devices. Compatibility layer is clean.

**Adversarial test #4 — receipt-freeness / coercion.** After reveal, each voter's choice is publicly linkable to their Bitcoin address. This is a **failure** of receipt-freeness: a coercer can demand a voter prove how they voted. Homomorphic tally (Helios-style) would prevent this. v0 does not attempt it.

**Verdict.** KEPT as an opt-in mode, with honest documentation of the limitations. Threshold / homomorphic variants are future work.

---

### H8. OrangeCheck thresholds are a natural prerequisite, not a duplicate layer

**Claim.** Poll creators can require `min_sats` and `min_days` — same semantics as OrangeCheck's `/api/check`. A ballot from an address that doesn't meet the threshold is still signed and counted toward de-dup, but contributes zero weight.

**Adversarial test.** Does this duplicate OC or conflict with it?

- OC proves `(addr, sats, days)` for a moment in time. OC Vote uses the same check applied at `snapshot_block`.
- OC attestations are content-addressed by message; a voter MAY reference an existing attestation in their ballot (`attestation_id` field), allowing a client to reuse an attestation check.
- This composition means OC Vote doesn't reinvent the threshold primitive. It reuses it.

**Verdict.** KEPT. `attestation_id` field is optional (informational); the authoritative check is always against snapshot UTXOs.

---

### H9. Nostr (kinds 30080 / 30081 / 30082) is the right discovery layer

**Claim.** Polls publish as addressable kind 30080. Ballots publish as addressable kind 30081 (replaceable by voter, supporting vote changes). Reveals publish as standard kind 30082.

**Adversarial test.** Why addressable for ballots?

- Replaceable-by-author lets a voter revise their ballot by publishing a new event with the same `d` tag. The relay stores only the latest per-author per-d-tag. This matches the `latest` tiebreak semantics.
- For `first` tiebreak polls, clients MUST still fetch historical ballots (Nostr relays with full history support this via filters; some relays discard replaced events, which is fine because we only care about the first one).

What if Nostr relays censor? Multi-relay publication is required (reference set: 4 diverse relays, per Lock's pattern). Tallies are reproducible as long as one cooperating relay has the data. Ballots can also be published as URL fragments, out-of-band JSON blobs, or served from any static host.

**Verdict.** KEPT. Nostr is the default transport; the protocol does not require it.

---

### H10. `weight_mode` is a small, canonical, enumerated set

**Claim.** v0 ships three weight modes: `one_per_address`, `sats`, `sats_days`. No more. A registry pattern exists for future modes (quadratic, logarithmic, capped) but v0 doesn't implement them.

**Adversarial test.** Isn't this too restrictive? Don't communities want quadratic?

- Yes, eventually. But a small canonical set minimizes interop risk. Four different clients all implementing "quadratic with epsilon smoothing" will disagree on the tally for a close vote. That's worse than not having the mode.
- The registry in §11 allows `weight_mode: "acme_v1"` + `weight_params: {...}` for experimentation. Mainline clients either support a mode or reject the poll as unsupported.

**Verdict.** KEPT. Mirrors OrangeCheck's decision to ship `score_v0` with the registry as the extension point.

---

### H11. The poll creator needs no special authority

**Claim.** Anyone with a Bitcoin address can create a poll. The creator's BIP-322 signature on the poll makes them publicly accountable but grants no privileges other than (in secret mode) holding the reveal key.

**Adversarial test.** Can this be abused to spam polls? Yes — but spam has negligible weight without voters. Clients discovering polls SHOULD filter by creator reputation heuristics (OC score of the creator, ballot count, community curation). The protocol does not curate.

**Verdict.** KEPT. Same philosophical stance as OrangeCheck: no permission layer.

---

### H12. Deadlines are UTC ISO-8601, snapshots are block heights — two different clocks, each used for what it's good at

**Claim.** `deadline` is wall-clock (who's allowed to vote when), `snapshot_block` is Bitcoin-clock (what a voter's weight was). These cannot be unified without breaking one or the other.

**Adversarial test.** Why not use block heights for the deadline?

- Block heights are noisy (~10 min variance). A "vote closes at block 900,000" is confusing for ordinary voters.
- Block heights are great for weight (UTXO age is defined in blocks).
- Wall-clock is great for deadlines (users expect "May 1 at midnight UTC").

What about reorgs? Deep reorgs are rare; the spec requires `snapshot_block` to be at least 6 confirmations deep at tally time.

**Verdict.** KEPT. Two clocks, each used for what it's best at.

---

### H13. The whole protocol fits on a napkin

**Claim.** A reader should be able to understand OC Vote in one page.

**Adversarial test.** Write it on a napkin.

```
Poll = { question, options[], deadline, snapshot_block, weight_mode,
         min_sats, min_days, mode, reveal_pk?, creator } + BIP322(creator)

Ballot = { poll_id, voter, option, created_at } + BIP322(voter)
         (or, in secret mode: Lock envelope addressed to poll's reveal_pk
          committing to the option, plus SHA-256 commitment of option)

Tally: for each address, take one ballot (per poll.tiebreak);
       require sats ≥ min_sats (aged ≥ min_days) at snapshot_block;
       weight = weight_mode(utxos at snapshot_block);
       sum per option.
```

That's the whole protocol. Everything else is encoding details.

**Verdict.** KEPT.

---

## Design rules that emerge

These are the rules the spec is written to obey. They are deliberately short:

1. **Bitcoin is load-bearing.** If any mechanism would work identically on Ed25519, it doesn't belong here. The weight function is the point.
2. **Offline-verifiable or nothing.** Every claim in the protocol must be checkable by a solo operator with a Bitcoin node and a BIP-322 verifier.
3. **Content-addressed artifacts.** Polls, ballots, and reveals are identified by SHA-256 of canonical bytes. Identity before storage.
4. **One ceremony per device, forever.** Voters who have an OrangeCheck attestation already have everything they need. Secret-ballot voters need no additional signing — the Lock envelope uses existing primitives.
5. **Small canonical surface.** Three weight modes. Two tiebreaks. Two modes (public/secret). One poll kind, one ballot kind, one reveal kind.
6. **Trust anchors are named, not hidden.** The creator of a secret-ballot poll is a trust anchor. We say so in plaintext. Future versions replace them with threshold schemes; v0 labels them honestly.
7. **Ship the tally function before the UI.** If you can't `curl` a poll + ballot list and get a deterministic result, the spec isn't done.

## What v0 explicitly does NOT solve

These are real concerns. v0 does not address them. Each is a candidate for v1 or a separate protocol.

- **Receipt-freeness / coercion resistance.** After reveal, ballots are publicly linkable. Full coercion resistance requires a homomorphic scheme with interactive proofs (Helios-style). Out of scope for v0.
- **Full metadata privacy.** The voter's Bitcoin address is plaintext in every ballot. Voters who want pseudonymity vote from a fresh address, losing stake credibility unless they've pre-staked there.
- **Threshold / DAO-style reveal.** Only creator-held reveal in v0. tlock-based reveal is documented as future work.
- **Delegation / liquid democracy.** Not attempted. Possible as a v1 extension via a separate "delegation attestation" signed by the delegator.
- **Quadratic voting.** Deferred to a registry-based `weight_mode` in v1, when a canonical encoding is proposed.
- **Post-quantum.** secp256k1 and X25519 both break under a sufficiently large quantum computer. No PQ layer.
- **Claim that this replaces legal voting systems.** It does not. It is a cryptographic signal for voluntary coordination. Sovereign elections require different properties (legal identity, accessibility, auditability under adversarial oversight) that this protocol does not attempt.

## Why not just use Snapshot?

Snapshot is the incumbent for crypto-native community governance. It works. But:

1. It requires a token. New communities must mint one. Mint-and-govern is a game-able pattern: early distribution skews power; liquid tokens let whales flashloan votes.
2. Vote weight is chain-specific. Moving a community from Ethereum to a rollup requires rebuilding the snapshot backend.
3. The tally is computed by Snapshot's server. You trust them, or you trust a second implementation re-deriving it. There is no local-first tally story for a typical user.
4. Secret ballots are not supported (off-chain JSON; all votes public from the moment of casting).

OC Vote doesn't need a token. Bitcoin is the shared substrate; any community that wants to signal collective commitment can use the same weight function. The tally is a pure function any observer can run. Secret ballots are opt-in. That's the whole delta.

## Why not just use Helios?

Helios is the gold standard for cryptographically verifiable elections. It has:

- Homomorphic tallying (true receipt-freeness via mixnets).
- Formally-analyzed ZK proofs.
- Academic provenance and real deployments (IACR board elections).

It also has:

- A trusted authority who maintains the voter roll.
- A bootstrapping cost per election that assumes a setup ceremony.
- A UX that requires voters to remember a ballot tracker.

OC Vote trades receipt-freeness for bootstrap-freeness. A community running a non-binding signal vote every week doesn't need mixnets; they need something they can spin up in 30 seconds. Formal election ceremonies should still use Helios.

## Acknowledgements

OC Vote inherits the "Bitcoin as a civilizational primitive" framing that shapes OrangeCheck and OC Lock, which in turn came out of conversations with [**Bram Kanstein**](https://bramk.substack.com/). The specific idea that *weight* (not identity, not payment) is the load-bearing property of Bitcoin for governance is a direct extension of his work on Bitcoin as a sovereignty layer. The design choice to refuse any feature that would work on Ed25519 is inherited verbatim from OrangeCheck's VISION.md.

The threshold-reveal future-work direction draws on [drand](https://drand.love)'s League of Entropy and the [tlock](https://drand.love/docs/timelock-encryption/) scheme.

The "content-addressed poll + replaceable-by-author ballot" design borrows shape from [Nostr NIP-33](https://github.com/nostr-protocol/nips/blob/master/33.md) (parameterized replaceable events), which OrangeCheck itself uses for attestations.

## Status

v0 — spec-stable. Anything breaking before 1.0 increments the minor version.
