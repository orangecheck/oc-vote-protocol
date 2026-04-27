# Lifecycle of OC Vote envelopes

> **Normative companion to [`SPEC.md`](./SPEC.md).** This document specifies what creators, voters, and talliers MAY do to a poll, ballot, or reveal after publication, and what verifiers MUST do in response. It does not introduce new envelope kinds or canonical-message fields. It pins down the lifecycle stance the spec already implies and the rest of the OrangeCheck family already shares.

## 0. The family stance

Every OrangeCheck artifact is a **signed envelope**. The signature is the truth; the Nostr event is a directory entry; the bytes already exist on relays and in caches the moment an envelope is published. *Delete* is therefore not a protocol primitive in any verb of the family. The vocabulary the family does define is:

| Verb | What it means |
|---|---|
| **replace** | Publish a new envelope under the same Nostr addressable coordinate (`(kind, pubkey, d)`). NIP-33 replacement applies; the older event is no longer canonical. |
| **revoke** | Publish a *separate, signed* envelope that ends the legitimacy of a prior one. Per-verb whether this exists. |
| **withdraw** | Spend the Bitcoin UTXO(s) that a weight mode counts. The next tally sees the change. |
| **expire** | Pass `deadline`. |
| **hide (out-of-protocol)** | A reference dashboard MAY filter an artifact out of its UI. No protocol effect. |
| **request relay deletion (out-of-protocol)** | Publish a NIP-09 kind-5 event. Best-effort; not normative. |

## 1. OC Vote lifecycle, by kind

OC Vote owns three Nostr kinds — `30080` (poll), `30081` (ballot), `30082` (reveal) — and each has a different lifecycle. The asymmetry is by design: a poll is a stable directory entry many ballots reference, a ballot is a per-voter choice the voter is allowed to change before the deadline, a reveal is a one-shot key publication.

### 1.1 Poll (kind 30080)

- **Replacement.** Polls are addressable events under `d = oc-vote:poll:<poll_id>`. The `poll_id` is the SHA-256 of the canonical poll bytes, so re-publishing under the same `d` is structurally impossible — any change of a poll byte produces a different `id` and therefore a different `d`. Polls are de-facto immutable once published.
- **Revocation.** This spec does **not** define a poll-revocation envelope, kind, tag, or canonical-message field. A poll has consumers — the ballots cast against it — and silently un-publishing the poll would orphan every ballot that references it.
- **Closing early.** A creator MAY end a `secret`-mode poll early by publishing the `reveal` event (kind 30082) before `deadline`. Talliers MUST still discard ballots whose `created_at > deadline`; an early reveal does not shorten the deadline, it only unseals the ballots already cast. There is no equivalent "close early" primitive for `public`-mode polls — `public` polls run to `deadline` and that is the sole stop condition.
- **Deadline expiry.** When `now > deadline`, the tally is final by spec. Late ballots are dropped (§3 / §5).
- **Out-of-protocol controls.** A creator MAY hide a poll from a reference dashboard or publish a NIP-09 deletion request; neither affects the canonical tally and verifiers MUST ignore both.

### 1.2 Ballot (kind 30081)

- **Replacement.** Ballots are addressable events under `d = oc-vote:ballot:<poll_id>:<voter>` and are **replaceable per `(poll, voter)`** by spec (`SPEC.md` §5.2). A voter MAY publish a new ballot for the same poll any number of times before `deadline`; the tally semantics are governed by `tiebreak`:
  - `tiebreak: last` (default) — the highest-`created_at` ballot ≤ `deadline` wins.
  - `tiebreak: first` — the lowest-`created_at` ballot ≤ `deadline` wins. Talliers MUST query multiple relays here because Nostr replaceable-event semantics discard older versions; without multi-relay scanning a `first`-tiebreak poll is unverifiable (`SPEC.md` §5.3).
- **Revocation.** This spec does **not** define a ballot-revocation envelope. Replacement is the substitute: a voter who wants to "unvote" SHOULD publish a new ballot whose `option_id` reflects their final choice. There is no protocol-level "abstain after voting" primitive — abstention is encoded by *not voting*.
- **Withdrawal of bond.** The voter's stake is whatever the weight mode evaluates against the voter's UTXOs at `snapshot_block`. A voter who spends those UTXOs before `snapshot_block` reduces or zeroes their weight in the final tally. This is permitted by Bitcoin and never blocked by this spec.
- **Post-deadline ballots.** Talliers MUST discard ballots with `created_at > deadline`. Republishing under the same `d` after `deadline` does nothing; the tally has frozen.
- **Out-of-protocol controls.** A voter MAY hide a ballot from a reference dashboard or publish a NIP-09 deletion request; neither affects whether the ballot is counted. Talliers MUST ignore both signals.

### 1.3 Reveal (kind 30082)

- **Replacement.** Reveals are addressable events under `d = oc-vote:reveal:<poll_id>` carrying `reveal_sk`. A reveal is, by definition, the publication of a secret. Once any verifier has copied `reveal_sk`, the secret is gone. Publishing a different `reveal_sk` under the same `d` does **not** un-publish the first one; ballots already unsealed by the first key remain unsealed everywhere.
- **Revocation.** This spec does **not** define a reveal-revocation envelope. There is no point: the cryptographic content (an X25519 secret key) cannot be retrieved after publication.
- **Out-of-protocol controls.** Hide and NIP-09 deletion are particularly meaningless for reveals — the secret has already been seen by every relay that received the event. Verifiers MUST ignore both.

## 2. Withdrawal of weight (cross-cutting)

Every weight mode in `SPEC.md` §4 reads UTXOs at `snapshot_block`. Spending those UTXOs *before* `snapshot_block` reduces the voter's weight in the tally; spending them *after* the snapshot has no tally-side effect (the snapshot is a frozen height). Withdrawal is therefore not a structured "exit" — it is a *de facto* reduction of weight, visible to every tallier.

## 3. Compliance summary

| Implementation MUST | Implementation MUST NOT |
|---|---|
| Treat the highest- or lowest-`created_at` ballot per `(poll, voter)` (per `tiebreak`) as the voter's final choice. | Define or honor a "ballot revocation" envelope kind, tag, or field beyond NIP-33 replacement. |
| Discard ballots whose `created_at > deadline` regardless of when they were published. | Define or honor a "poll revocation" envelope kind. Polls have ballot consumers; orphaning is not a feature. |
| Treat reveals as one-shot — the secret cannot be unpublished. | Treat dashboard-local hide flags or NIP-09 deletion-request events as protocol signals. |
| Re-evaluate `bond.sats` / `bond.days` thresholds against live state at tally time and apply the spec's bond-failure errors. | Suppress evaluation of a poll/ballot because its publisher requested hiding or deletion. |
