# Security Policy

## Reporting a vulnerability

Email **security@ochk.io** with:

- A clear description of the issue and the affected component.
- Reproduction steps (proof-of-concept preferred; a minimal canonical object + signature set is fine).
- Your assessment of impact: what can an attacker do, under what assumptions?
- Whether you want credit when we publish the fix.

We aim to acknowledge within 48 hours and publish a fix for high/critical issues within 14 days. Do not file public GitHub issues for suspected vulnerabilities.

## Scope

This document covers the **OC Vote v0 protocol specification** in this repository. The reference TypeScript implementation lives in [`orangecheck/oc-packages`](https://github.com/orangecheck/oc-packages) and has its own `SECURITY.md`. The hosted reference web client at [vote.ochk.io](https://vote.ochk.io) is closed-source; report web-client security issues via `security@ochk.io`.

## Threat model

### What OC Vote protects

- **Authenticity of every poll.** The creator's BIP-322 signature binds `poll_id` to their Bitcoin address. Forged polls require the creator's private key.
- **Authenticity of every ballot.** The voter's BIP-322 signature binds `ballot_id` to their Bitcoin address. Forged ballots require the voter's private key.
- **Tamper-evidence of every object.** `poll_id`, `ballot_id`, and `reveal_id` are SHA-256 commitments to canonical bytes. Any modification invalidates the id and the signature.
- **Deterministic tallies.** Two conforming implementations produce byte-identical tally output given the same inputs. Disputes are resolvable by re-running the function.
- **Bot resistance.** The weight function (`sats`, `sats_days`) prices in opportunity cost. The threshold filters (`min_sats`, `min_days`) admit only voters with credible stake.
- **Commitment binding in secret mode.** The `secret.commit` field binds the ballot id to the hashed plaintext option; a voter cannot sign one ballot and claim a different option at reveal.

### What OC Vote does NOT protect

- **Receipt-freeness / coercion resistance.** After reveal in secret mode, each voter's choice is publicly linkable to their Bitcoin address. A coercer can demand proof of vote. Full receipt-freeness requires a homomorphic scheme (see `WHY.md` H7 and `SPEC.md` §13 "Future work").
- **Secret-ballot privacy against the poll creator.** The creator holds `reveal_sk` in v0. They can decrypt ballots before deadline. They cannot publish an early tally without revealing the key (an observable action), but they can privately know the state. Use threshold reveal (future) if this is unacceptable.
- **Denial-of-service by non-reveal.** If the creator of a secret-mode poll refuses to publish the reveal event, the poll is permanently abandoned. Participation is still provable; the tally is not. Communities should choose the creator of a secret-mode poll accordingly.
- **Sender anonymity.** Every ballot is plaintext-signed by a Bitcoin address; the address is public. Pseudonymity requires voting from a fresh address, which typically has no stake and so passes no threshold.
- **Metadata privacy.** Poll questions, option labels, creator addresses, voter addresses, deadlines, and snapshot blocks are all plaintext. If any of these are sensitive, do not publish the poll.
- **Censorship-resistance of Nostr relays.** A hostile relay set can refuse to store or serve specific polls or ballots. Mitigation: multi-relay publication, self-hosted relays, or out-of-band transport (the objects are self-contained JSON).
- **Claim to replace legal voting.** OC Vote is a cryptographic signal for voluntary coordination. It makes no claim to sovereign-election properties (accessibility, audit under adversarial oversight, legal identity binding, etc.).

### Assumptions the protocol makes

- **Bitcoin's security model holds.** ECDSA / Schnorr over secp256k1 remains unforgeable at current parameter sizes. A deep reorg at the snapshot block would invalidate a tally; the protocol requires ≥ 6 confirmations before tallying.
- **BIP-322 is implemented correctly** by both signing and verifying clients. Pin verifiers to versions known to handle P2WPKH, P2TR, P2WSH, and P2PKH.
- **Voters' wallets isolate signing keys.** BIP-322 exposes only a signed message, not the private key. A compromised wallet compromises the voter, not the tally.
- **Randomness is strong.** `reveal_sk` is generated via `crypto.getRandomValues` / platform CSPRNG. Weak randomness on a secret-mode poll creator compromises the reveal key and, by extension, ballot secrecy.
- **Bitcoin full-node data is trustworthy or independently verifiable.** The tally depends on UTXO state at a specific block height. Taliers using third-party UTXO APIs inherit those APIs' trust. Self-hosting a node eliminates this.

## Normative compliance requirements

These are cryptographic correctness conditions that conforming implementations MUST satisfy. They are restated from [`SPEC.md`](./SPEC.md) §10 here for emphasis:

1. **Verify every BIP-322 signature** before trusting the object. Polls, ballots, and reveals all carry `sig.value` over `*_id`.
2. **Canonicalize deterministically** per §7 of the spec. Non-canonical serialization that happens to hash to the right value is not an excuse; two implementations MUST produce byte-identical bytes.
3. **Require ≥ 6 confirmations at snapshot block** before tallying. A tally computed against an unconfirmed or shallowly-confirmed block MAY be invalidated by a reorg; refuse to produce one.
4. **Never reveal or display partial tallies for a secret-mode poll** before a valid reveal event exists.
5. **Verify `secret.commit`** at reveal time. Silently accepting a revealed option that doesn't match the commitment allows a malicious reveal ceremony to rewrite history.
6. **Refuse polls whose `weight_mode` is unsupported.** Partial or fudged support is worse than rejection — it produces wrong tallies.
7. **Enforce `poll.deadline`.** Ballots with `created_at > deadline` MUST be discarded.

## Known cryptographic caveats

- **Signature malleability.** Schnorr (P2TR) signatures are non-malleable. ECDSA (P2PKH) signatures are technically malleable, but since `ballot_id` is bound into the signed message and is itself a hash of the canonical bytes, malleated re-issues still require the voter's private key.
- **No side-channel guarantees.** JavaScript crypto libraries (including `@noble/*`) make best-effort constant-time operations but run on a potentially hostile host. Secret-mode poll creators handling `reveal_sk` on a shared/corporate/untrusted machine are at risk.
- **Nonce randomness relies on the platform.** `crypto.getRandomValues` is backed by the OS CSPRNG. A broken embedded browser compromises the creator's reveal_sk entropy.
- **X25519 and secp256k1 are not post-quantum.** A PQ-capable adversary breaks both. No PQ layer in v0.

## Attack scenarios and their status

The following scenarios were considered during design. Each is either mitigated, accepted, or flagged as out-of-scope.

### Scenario 1: Whale buys a voter's private key off-chain and votes with it

**Mitigation:** None possible at the protocol layer. If a voter sells or leaks their private key, the key's holder is the voter. This is identical to every signature-based authentication system and to Bitcoin itself.

### Scenario 2: Creator rewrites a poll after ballots are cast

**Mitigated** by content addressing: `poll_id = SHA-256(canonical poll)`. Any change produces a different `poll_id` and invalidates every ballot referencing the original.

### Scenario 3: Voter double-votes from the same address with different options

**Mitigated** by tiebreak rules in §8 of the spec. Per-voter de-dup applies `poll.tiebreak` (`latest` or `first`). Only one ballot per voter per poll contributes to the tally.

### Scenario 4: Sybil voter splits 1M sats across 10 addresses

**Partially mitigated.** In `sats` and `sats_days` modes, splitting does not inflate weight (`sum` is unchanged). In `one_per_address` mode, splitting IS an attack — which is why `one_per_address` requires a `min_sats` threshold high enough to price it out. Communities using `one_per_address` are on their own to set the bar correctly.

### Scenario 5: Tallier publishes a fraudulent tally

**Mitigated** by determinism. Any observer can re-run the tally. A fraudulent web UI is defeated by running `npx @orangecheck/vote tally <poll_id>` and comparing.

### Scenario 6: Nostr relay drops ballots it dislikes

**Partially mitigated** by multi-relay publication. A voter publishing to one relay is exposed to that relay's censorship. Publishing to 4+ diverse relays tolerates one hostile relay. The protocol supports any transport; Nostr is the default, not the only option.

### Scenario 7: Creator of a secret-mode poll peeks early

**Accepted as a v0 limitation.** The creator's address is on record; malicious publication of a leaked early tally is attributable. Cryptographic prevention requires threshold reveal (future work).

### Scenario 8: Creator of a secret-mode poll refuses to reveal

**Accepted as a v0 failure mode.** The poll is abandoned; no tally is produced. Clients MUST surface this state distinctly from "open" or "tallied." Communities who can't tolerate this risk should use public polls or wait for threshold reveal.

### Scenario 9: Reorg invalidates a tally

**Mitigated** by the ≥ 6 confirmation requirement on the snapshot block. Deeper reorgs would still invalidate; this is an inherited property of Bitcoin.

### Scenario 10: Voter's ballot is replayed in a different poll

**Mitigated** by `poll_id` being inside the canonical ballot message (and therefore inside the signed bytes). A ballot for poll A cannot be re-used for poll B without the voter's private key.

### Scenario 11: Two polls collide on `poll_id`

**Mitigated** by SHA-256 collision resistance. Not a realistic attack.

### Scenario 12: Voter publishes a ballot with `created_at` far in the future

**Mitigated** by the `deadline` cap. Ballots with `created_at > deadline` are discarded. Clients SHOULD also discard ballots with `created_at` greater than the Nostr event's `created_at` by more than a small skew (reference: 1 hour).

### Scenario 13: Dishonest reveal — creator publishes a `reveal_sk` that doesn't match `reveal_pk`

**Mitigated** by ECDH check: the tallier MUST verify `x25519_base(reveal_sk) == poll.reveal_pk` before using the key. A mismatched reveal is rejected as invalid.

### Scenario 14: Voter lies about their OC attestation via `attestation_id`

**Mitigated** by treating `attestation_id` as non-normative metadata. The authoritative check is always the UTXO snapshot.

## Dependency posture

The v0 reference implementation (in [`oc-packages`](https://github.com/orangecheck/oc-packages)) depends on a narrow set of audited libraries:

| Package | Purpose |
|---|---|
| `@noble/curves` | X25519, secp256k1 Schnorr |
| `@noble/hashes` | SHA-256, HKDF |
| `@noble/ciphers` | AES-256-GCM (for secret-mode ballots via OC Lock) |
| `bip322-js` | BIP-322 verification |
| `@orangecheck/lock-core` | Envelope seal / unseal for secret-mode ballots |

BIP-322 verification's dependency chain currently includes the `elliptic` library (known low-severity timing channels, npm advisory 1112030). OC Vote inherits OC Lock's posture here: signature verification only, timing channels do not leak secrets, and we plan to migrate to a `@noble`-based BIP-322 verifier when available.

## Report a protocol-level concern

If you believe a clause of the specification itself is unsound (as opposed to a bug in an implementation), email security@ochk.io with subject line prefix `[protocol]`. Protocol-level concerns may trigger a spec revision; we version the spec strictly (§12).
