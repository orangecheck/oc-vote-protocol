# OC Vote — Protocol walkthrough

This is a narrative companion to [`SPEC.md`](./SPEC.md). If you want the normative rules, read the spec. If you want to understand *why* and *how*, read this.

## The problem

> "We want to take a decision as a group, signal our commitment by our stake in the outcome, and have anyone — including future observers, not just participants — be able to verify the result from public data. Without a token, without a KYC vendor, without trusting a tallier."

That is the user story OC Vote serves. Every Bitcoin-adjacent community runs into it within their first six months: a contested soft-fork debate, a DAO treasury allocation, a Nostr community moderation policy, an airdrop allocation, a grant committee vote. Historically, these end up as Google Forms + Twitter polls + "whoever yelled loudest on IRC." OC Vote is what you reach for instead.

## Mental model

```
  ┌──────────┐                                ┌──────────────┐
  │ Creator  │──── signs poll (BIP-322) ────→│   Nostr      │
  │ (any BTC │    publishes kind 30080        │  directory   │
  │  addr)   │                                │              │
  └──────────┘                                │ 30080 poll   │
                                              │ 30081 ballot │
  ┌──────────┐                                │ 30082 reveal │
  │ Voter A  │──── signs ballot (BIP-322) ──→│              │
  │ Voter B  │    publishes kind 30081        │              │
  │ Voter C  │    (replaceable per voter)     │              │
  └──────────┘                                └──────────────┘
                                                      │
                                                      │ anyone pulls
                                                      ↓
                                              ┌───────────────┐
                                              │   Observer    │
                                              │   tallier     │
                                              │ (runs local   │
                                              │  function)    │
                                              └───────────────┘
                                                      │
                                                      │ + UTXO state
                                                      │   at snapshot
                                                      ↓
                                              ┌───────────────┐
                                              │ Deterministic │
                                              │    tally      │
                                              └───────────────┘
```

Every actor has exactly one job. The creator publishes a poll. The voter publishes a ballot. The observer runs a function. Nobody trusts anybody; the math holds.

## Flow 1 — Public, sats-days weighted poll

Alice coordinates a small group of Bitcoin grant recipients. They want to allocate $5k among three candidate projects. Non-binding signal vote; weighted by sats × days so long-term bonded voices count more.

### Alice creates the poll

1. Alice visits `vote.ochk.io/create`.
2. She enters:
   - Question: *"Which grant allocation split should we adopt?"*
   - Options: `split_a` ("60/30/10"), `split_b` ("40/40/20"), `split_c` ("equal thirds")
   - Deadline: `2026-05-08T00:00:00Z`
   - Snapshot block: `"deadline"` (resolved to chain tip at close)
   - Weight mode: `sats_days`, cap 180 days
   - `min_sats`: `100000`, `min_days`: `30`
   - Mode: `public`
   - Tiebreak: `latest` (voters can change their mind)
3. She clicks "Sign & publish." Her wallet prompts once for BIP-322 over the poll's id. The client:
   - Canonicalizes the poll object with `sig.value = ""`.
   - Computes `poll_id = sha256(canonical)`.
   - Asks the wallet to sign `poll_id`.
   - Sets `sig.value`, re-canonicalizes, and publishes to four Nostr relays as kind 30080.
4. Alice gets back a shareable URL: `vote.ochk.io/p/<poll_id>`.

Total interactions: one wallet signature prompt. Zero bitcoin spent.

### Bob votes

1. Bob opens Alice's URL.
2. The page fetches the poll from Nostr, verifies Alice's BIP-322 signature, and renders the three options plus a short notice: *"Weighted by sats × days at the deadline block. You need ≥100k sats held ≥30 days to count."*
3. Bob selects `split_b` and clicks "Sign ballot."
4. His wallet prompts once for BIP-322 over the ballot's id.
5. The client publishes kind 30081 with `d = oc-vote:ballot:<poll_id>:<bob_addr>`.
6. Bob sees his ballot on the poll page immediately: *"You voted split_b at 2026-04-29T12:11Z. Your estimated weight: 1,280,000 sat-days."*

### Bob changes his mind

1. Two days later Bob returns and picks `split_c`.
2. His client builds a new ballot with a greater `created_at`, re-signs, and republishes to the same `d` tag. Conforming Nostr relays replace Bob's previous ballot automatically.
3. The poll's live tally reflects the change.

### Deadline passes — anyone tallies

1. At `deadline`, the client derives the snapshot block: the greatest block whose `median_time_past ≤ deadline` and which has ≥ 6 confirmations. Say it lands on height `900,412`.
2. Observer Carol (maybe a grant committee member, maybe an interested outsider) runs the tally:
   - Fetch the poll and all ballots matching `poll_id` from Nostr.
   - For each ballot, verify `voter`'s BIP-322 signature.
   - De-duplicate per voter using `tiebreak: latest`.
   - For each voter, fetch their UTXO set at height 900,412 from any Bitcoin node (esplora, electrs, a local bitcoind).
   - Drop UTXOs younger than `min_days` (30). Sum sats. If below `min_sats` (100k), weight = 0.
   - Otherwise, weight = Σ(u.value × min(age_days, 180)) across qualifying UTXOs.
   - Sum per option.
3. Carol's tally function returns:
   ```json
   {
     "state": "tallied",
     "snapshot_block": 900412,
     "turnout": { "voters": 47, "weight": 2814300000 },
     "tallies": {
       "split_a": 812300000,
       "split_b": 1102900000,
       "split_c":  899100000
     }
   }
   ```
4. The `vote.ochk.io/p/<poll_id>` page displays the same numbers. So does any self-hosted tally CLI. The result is not *hosted* anywhere; it's *computed* everywhere.

Total bytes on-chain: zero. Total external services relied upon for correctness: zero (Nostr is only a default transport).

## Flow 2 — One-per-address with high threshold

A Nostr community wants to signal on a relay policy change. They want hard one-voter-one-vote, not stake-weighted. To price out address splitting, they set `min_sats = 1,000,000` (≈ $700 at 7 cents/sat) and `min_days = 90`.

Everything else is identical to Flow 1. The tally is:

```json
{
  "state": "tallied",
  "snapshot_block": 902988,
  "turnout": { "voters": 312, "weight": 312 },
  "tallies": { "yes": 214, "no": 98 }
}
```

312 addresses each passed the threshold. Each counted for exactly 1. An attacker who wanted to inflate "yes" by 100 votes would need 100 × 1M sats × 90 days of opportunity cost — well over $70k in bonded capital (at 7¢/sat), which is prohibitive for a relay-policy flamewar.

## Flow 3 — Secret ballot

A DAO votes on a contentious treasury disbursement. They want ballots hidden until close so whales can't influence smaller voters by casting early.

### Creation

1. Alice (the creator) enables "Secret ballot."
2. The client generates a fresh X25519 keypair `(reveal_sk, reveal_pk)`.
3. `reveal_pk` goes into the poll. `reveal_sk` is stored locally (IndexedDB) behind a passphrase; Alice is warned that losing it means the poll cannot be tallied.
4. Alice BIP-322 signs and publishes as normal.

### Bob votes in secret

1. Bob picks `yes`.
2. The client:
   - Computes `commit = sha256("oc-vote/v0/commit\npoll_id: …\nvoter: bc1qbob…\noption: yes\n")`.
   - Seals an OC Lock v2 envelope: plaintext = `"yes"`, recipient = synthetic device with `device_pk = reveal_pk`.
   - Builds the ballot with `option: null`, `secret: { envelope, commit }`.
3. Bob signs the ballot id with BIP-322. Publishes to kind 30081.

Anyone can see Bob voted. Nobody (except Alice, who holds `reveal_sk`) can see *what* Bob voted. The live "tally" page shows option-by-option counts as `?` until close.

### Close and reveal

1. At deadline, Alice returns and clicks "Publish reveal."
2. The client builds a kind-30082 reveal event: `{ poll_id, reveal_sk, revealed_at, sig }`. Alice signs with BIP-322.
3. Every observer's tally function now:
   - Fetches the reveal, verifies Alice's signature on it.
   - For each secret-mode ballot, runs OC Lock §4.3 decryption with `device_sk = reveal_sk`.
   - Recomputes `commit` and verifies it matches.
   - Substitutes the decrypted option and proceeds to weight-sum.
4. The page flips from "awaiting reveal" to a final tally.

### What if Alice refuses to reveal?

The poll is permanently **abandoned**. Observers can enumerate the ballots — proving participation — but no tally is produced. This is a real cost of the creator-held-reveal trust model, and it's why the protocol prints the creator's address prominently on the poll page. Communities that can't tolerate this risk should wait for the threshold-reveal variant in a future version, or stick to public polls.

### What about Alice peeking early?

She *can* decrypt mid-poll with her local `reveal_sk`. She cannot publish a tally without revealing the key, but she can privately know the running score. This is a documented v0 limitation (see [`WHY.md`](./WHY.md) H7 and [`SECURITY.md`](./SECURITY.md)). Honest creators can commit to not peeking; cryptographic enforcement requires threshold reveal or homomorphic tally, which are future work.

## Flow 4 — Multi-address voter

Charlie controls `bc1qcharlie1` (100k sats, 45 days old) and `bc1qcharlie2` (500k sats, 400 days old). He wants his full stake to count.

He signs two ballots, one per address, each with the same option `yes`. Both publish to Nostr under distinct `d` tags (addresses differ).

The tally treats each address independently:
- `bc1qcharlie1`: 100k × min(45, 180) = 4,500,000 sat-days
- `bc1qcharlie2`: 500k × min(400, 180) = 90,000,000 sat-days

His total contribution to `yes` is 94,500,000 sat-days. Splitting or consolidating his UTXOs doesn't change this — it's a function of the snapshot state, not of how many ballots he publishes.

If Charlie is paranoid about address linkage he MAY vote from one address only, losing the weight from the other. OC Vote does not attempt address unlinkability.

## Flow 5 — Dispute

Alice's poll closed with a tally of 1,102,900,000 sat-days for `split_b`. Dave claims the real number is 900,000,000 and accuses the website of bias.

Dave runs his own tally:
1. `git clone oc-vote-protocol && npm i && npx @orangecheck/vote tally <poll_id>`
2. The CLI:
   - Pulls the poll and all kind-30081 ballots for `poll_id` from a fixed set of Nostr relays (he can pass his own list).
   - Verifies every signature.
   - Fetches UTXO state from his own bitcoind.
   - Prints the tally.

If the number matches the web page's, Dave was wrong. If it doesn't, the web page is either running a different weight mode (read the poll) or has a bug (file an issue with the diff). There is no way for the web page to produce a different "correct" answer — correctness is defined by the spec's tally function, not by any server.

## Compare and contrast

### vs. Snapshot

| Concern | Snapshot | OC Vote |
|---|---|---|
| Weight token | ERC-20 per community | Bitcoin UTXOs (universal) |
| Snapshot mechanism | Block-height snapshot of the governance chain | Block-height snapshot of the Bitcoin UTXO set |
| Tally | Computed by Snapshot's server (off-chain JSON) | Pure function any client can run |
| Secret ballots | Not supported | Opt-in creator-commit-reveal |
| Bootstrap | Need a token and distribution | Need a Bitcoin address |
| Gas | Zero for voting (off-chain sigs) | Zero always (no chain writes) |
| Identity | Ethereum address | Bitcoin address |

### vs. Helios

| Concern | Helios | OC Vote |
|---|---|---|
| Receipt-freeness | Yes (mixnet / homomorphic tally) | No (v0), future work |
| Voter roll | Authority-maintained | Open (anyone with a BTC address) |
| Setup ceremony | Per-election trustee setup | None |
| Tally verifiability | Yes (ZK proofs) | Yes (pure function) |
| Sybil resistance | Via voter-roll admission | Via Bitcoin weight |
| Ideal use case | Formal elections (academic, organizational) | Open-community signals, grant allocation, soft-fork polls |

### vs. Polis

Polis is a deliberation tool, not a voting tool. It produces clustered opinion groups, not tallies. Complementary, not competing. OC Vote is for making a decision; Polis is for understanding one.

### vs. a Nostr poll (NIP-88)

NIP-88 polls are one-per-pubkey, no weighting, no sybil resistance. Free to spin up, but dominated by whoever has the most Nostr keys — which is exactly the open-web sybil problem OC Vote addresses. NIP-88 is great for casual signals; OC Vote is great when the signal needs to carry weight.

## Anti-patterns we rejected

- **Tokenized voting weight.** Requires minting. Minting creates a walled garden. Avoided.
- **KYC / unique-humanity checks.** Injects a gatekeeper. Avoided.
- **On-chain ballot posting.** Would cost every voter a BTC transaction per ballot. Unshippable and misaligned with the "no custody, no chain ops" ethos inherited from OrangeCheck. Avoided.
- **Authority-signed voter roll.** Centralizes trust. Avoided.
- **Tallier as a service.** Would re-introduce the Snapshot trust problem. The tally function is local-first, web page is a convenience.
- **Per-election key ceremonies.** Adds friction the common case doesn't need. Opt-in for secret ballots, skipped for public ones.
- **Dynamic weight updates during a poll.** Leaks strategic info and invites late-binding manipulation. Snapshot is fixed at poll creation (or at deadline via deferred resolution).

## How this protocol composes with the rest of the OrangeCheck family

- **OrangeCheck** provides the sybil-resistance primitive. A ballot's `attestation_id` field points at the voter's existing OC attestation, letting clients skip a UTXO-fetch when the attestation is recent enough. The authoritative check is always the UTXO snapshot; OC is a hint.
- **OC Lock** provides the encryption primitive for secret-mode ballots. Every secret ballot is a Lock envelope with a synthetic recipient. The envelope format is unchanged; tallier implementations import `@orangecheck/lock-core` and reuse the seal/unseal flow.
- **OC Vote** produces a signal. That signal can feed back into OC (as evidence of community participation) or Lock (as a gating predicate — "only ballots from addresses with `score_v0 ≥ threshold`"). The composition is intentional: three primitives, one substrate, zero tokens.

## Where to go next

- Read [`SPEC.md`](./SPEC.md) for normative encoding rules.
- Read [`WHY.md`](./WHY.md) for the hypothesis-by-hypothesis design rationale.
- Read [`SECURITY.md`](./SECURITY.md) for the threat model.
- See [`test-vectors/`](./test-vectors/) for conformance fixtures.
- Try the hosted web client at [vote.ochk.io](https://vote.ochk.io).
