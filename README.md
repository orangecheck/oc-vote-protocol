# OC Vote Protocol

**Sovereign signaling for the open web.**
*Sats as weight. One ballot. Anyone tallies.*

[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) [![Status](https://img.shields.io/badge/status-v0%20spec--stable-orange)](./CHANGELOG.md)

OC Vote is a protocol for running sybil-resistant, stake-weighted, offline-tallyable polls on the open internet — without a token, without a KYC vendor, without trusting a tallier. It completes the OrangeCheck family as the **legitimacy** primitive alongside OrangeCheck (sybil-resistant identity signal) and OC Lock (confidentiality to an identity).

A voter's weight is a function of the sats they hold at a declared Bitcoin block height. The weight function is the load-bearing Bitcoin part — it cannot be replicated on any other keypair — and the rest of the protocol is plumbing.

> One poll. One ballot per voter. One function any observer can run. No token. No authority. No custody.

## This repo

This repository is the **normative protocol specification**. No code lives here — only:

| File | What it is |
|---|---|
| [`SPEC.md`](./SPEC.md) | Normative v0 specification — poll / ballot / reveal schemas, canonicalization, weight modes, secret-mode (OC Lock composition), tally algorithm, error codes, compliance checklist. |
| [`PROTOCOL.md`](./PROTOCOL.md) | Narrative walkthrough with five flows: public weighted poll, one-per-address with threshold, secret ballot, multi-address voter, and dispute resolution. |
| [`WHY.md`](./WHY.md) | The design rationale — every load-bearing hypothesis stress-tested against alternatives, plus the explicit list of things v0 does NOT solve. |
| [`SECURITY.md`](./SECURITY.md) | Threat model, 14 attack scenarios and their status, report channel. |
| [`LIFECYCLE.md`](./LIFECYCLE.md) | Normative lifecycle stance per kind — poll (non-revocable), ballot (replaceable per `(poll, voter)`), reveal (one-shot). |
| [`CHANGELOG.md`](./CHANGELOG.md) | Version history. |
| [`test-vectors/`](./test-vectors/) | Cross-implementation conformance fixtures. |

## Reference implementation

The TypeScript reference implementation is published to **npm**, maintained in the `oc-packages` monorepo (same as OrangeCheck and OC Lock):

| Package | Purpose |
|---|---|
| `@orangecheck/vote-core` | Canonicalization, `poll_id` / `ballot_id` computation, `tally()` pure function. |
| `@orangecheck/vote-ballot` | Ballot creation, signing, secret-mode sealing. |
| `@orangecheck/vote-cli` | `oc-vote create | sign | tally | verify | reveal`. |

```
npm i @orangecheck/vote-core
```

(The packages are planned; the spec ships first.)

## Reference web client

A live reference implementation of OC Vote v0 runs at **[vote.ochk.io](https://vote.ochk.io)** (closed-source web client; the underlying protocol implementation is published as [`@orangecheck/vote-*`](https://www.npmjs.com/org/orangecheck) on npm).

## How it works in one paragraph

A poll is a canonical JSON object: question, options, deadline, snapshot block, weight mode, minimum sats / days, and whether the ballot is public or secret. The creator signs the poll's content-addressed id with BIP-322 and publishes it to Nostr (kind 30080). Voters sign a canonical ballot object — `poll_id`, option, created_at — with BIP-322 and publish to Nostr (kind 30081, replaceable per voter per poll, so vote changes work). At deadline, any observer pulls the poll and every ballot for it, verifies signatures, de-duplicates per voter using the poll's tiebreak, and computes each voter's weight from their UTXO set at the snapshot block. Weights sum per option. Two observers running the tally on the same inputs produce byte-identical results. In secret mode, ballots are OC Lock envelopes addressed to a poll-specific reveal key, which the creator publishes at deadline as kind 30082; the tally function unseals and proceeds normally.

## One-line pitch for each audience

**Communities** (DAOs, grant committees, Nostr relays, forum operators, airdrop distributors):

```
https://vote.ochk.io/create
# pick question, options, deadline, min_sats, min_days, weight_mode
# sign once. publish. share the URL.
```

**Developers** (integrators):

```ts
import { createPoll, tally } from '@orangecheck/vote-core';

const poll = createPoll({ question, options, deadline, weight_mode: 'sats_days', ... });
const result = await tally({ poll, ballots, getUtxos });
```

**Voters** visit `vote.ochk.io/p/<poll_id>`, click an option, sign once, done.

**Tire-kickers** can download a poll + ballot set and run `npx @orangecheck/vote tally <poll_id>` against their own Bitcoin node. The result is the result; there is no "authoritative" tally server.

## What OC Vote is not

- **Not a legal voting system.** It is a cryptographic signal for voluntary coordination. It makes no claim to the properties sovereign elections require (legal identity, accessibility, adversarial audit). Use Helios for formal elections.
- **Not a token.** No chain of our own. No ICO. No governance token. Weight is already public Bitcoin.
- **Not an identity system.** It is a weight system. Identity is handled by OrangeCheck (if you need sybil-resistance) or Nostr/GitHub/DNS bindings (if you need handle claims).
- **Not a reputation aggregator.** Weight is per-poll and derives from on-chain stake at a specific block. No cross-poll reputation accrues.
- **Not receipt-free.** After secret-mode reveal, each voter's choice is linkable to their Bitcoin address. Full coercion resistance is future work.
- **Not a custody product.** Funds never move. No transaction is broadcast for any operation.

## The protocol's three primitives

```
Poll = { question, options[], deadline, snapshot_block, weight_mode,
         min_sats, min_days, mode, reveal_pk?, creator, created_at }
     + BIP322(creator, poll_id)

Ballot = { poll_id, voter, option, created_at }
       + BIP322(voter, ballot_id)
       # (or in secret mode: option=null, secret={ oc-lock envelope, commit })

Tally = pure function of (poll, ballots[], utxos_at_snapshot)
      → { option -> weight }
```

That's the whole protocol. Everything else is encoding details. See [`WHY.md`](./WHY.md) H13.

## Composition with the OrangeCheck family

```
┌─────────────────────────────────────────────────────────────────┐
│  vote.ochk.io             create UI, vote UI, tally UI          │
├─────────────────────────────────────────────────────────────────┤
│  @orangecheck/vote-core         canonicalization, tally()       │
│  @orangecheck/vote-ballot       sign, seal (secret mode)        │
├─────────────────────────────────────────────────────────────────┤
│  @orangecheck/lock-core         envelope format for secret mode │
│  @orangecheck/sdk               optional OC threshold hints     │
├─────────────────────────────────────────────────────────────────┤
│  Bitcoin UTXO state        weight function                      │
│  BIP-322                   signature primitive                  │
│  Nostr                     poll / ballot / reveal directory     │
└─────────────────────────────────────────────────────────────────┘
```

## Related repositories

- [`orangecheck/oc-packages`](https://github.com/orangecheck/oc-packages) — `@orangecheck/vote-*` packages live here alongside the rest of the OrangeCheck SDK.
- [vote.ochk.io](https://vote.ochk.io) — hosted reference web client (closed-source).
- [`orangecheck/oc-lock-protocol`](https://github.com/orangecheck/oc-lock-protocol) — the encryption primitive OC Vote uses for secret-mode ballots.
- [`orangecheck/oc-vote-examples`](https://github.com/orangecheck/oc-vote-examples) — copy-forkable integration templates (Discord bot, GitHub Action, shell recipes).
- [ochk.io](https://ochk.io) — the OrangeCheck umbrella site.

## Status

**v0 — spec-stable.** Anything breaking before 1.0 increments the minor version and is called out in [`CHANGELOG.md`](./CHANGELOG.md).

## Acknowledgements

OC Vote reframes Bitcoin as a civilizational primitive — not payments, but identity, confidentiality, and now legitimacy. The specific thesis that *weight* is the load-bearing property of Bitcoin for governance (distinct from *identity*, which OrangeCheck handles, and *access*, which v1 of the LOCK protocol chased and retired) is a direct extension of that framing. The Ed25519-substitution test that gate-keeps feature inclusion is inherited verbatim from OrangeCheck's `VISION.md`.

See also [OrangeCheck](https://ochk.io) and [OC Lock](https://github.com/orangecheck/oc-lock-protocol), the two primitives OC Vote composes on top of.

## License

The specification and all prose are MIT. See [`LICENSE`](./LICENSE). The reference implementation in `oc-packages` is also MIT.

---

**Built with Bitcoin. Tallied by anyone. Verified offline.**
