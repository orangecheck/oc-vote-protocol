# OC Vote test vectors

Fixed inputs, fixed canonical byte strings, fixed ids. Any conforming OC Vote v0 implementation MUST produce byte-identical canonical bytes, byte-identical `poll_id` / `ballot_id` / `reveal_id`, and byte-identical tally output for every vector here. If you're implementing OC Vote in a new language, these are the ground truth.

## Structure

Each `.json` file is an independent vector:

```json
{
  "description": "what this vector exercises",
  "inputs": {
    "poll":    { ... },
    "ballots": [ ... ],
    "reveal":  { ... }     // secret-mode vectors only
  },
  "expected": {
    "poll_id":            "<64-char hex>",
    "poll_canonical":     "<exact canonical bytes, LF-terminated, as a string>",
    "ballot_ids":         ["<64-char hex>", ...],
    "ballot_canonicals":  ["<string>", ...],
    "reveal_id":          "<64-char hex>",           // secret-mode only
    "reveal_canonical":   "<string>",                // secret-mode only
    "commits":            { "<voter>": "<hex>", ... },// secret-mode only
    "tally_with_utxos": {
      "utxo_snapshot":    { "<addr>": [{ "value": <sats>, "confirmed_height": <int> }] },
      "expected_result":  { "state": "tallied", "basis": "voter_clocks", "snapshot_block": <int>, "turnout": {...}, "tallies": {...}, "counted": [...] }
    }
  }
}
```

## Conformance

Given the `inputs`, a compliant implementation MUST:

1. Canonicalize each object (poll, ballot, reveal) per [`SPEC §7`](../SPEC.md#7-canonicalization). The bytes MUST equal the `*_canonical` strings.
2. Compute each `*_id` as `SHA256(canonical_bytes_with_sig.value_emptied)` per §7.1 / §7.2 / §6.3.
3. Run the tally function per [`SPEC §8`](../SPEC.md#8-tally-algorithm) against the provided `utxo_snapshot`. The output MUST equal `tally_with_utxos.expected_result` after canonical serialization.
4. In anchored-poll vectors (v08–v11, v13–v15), `inputs.chain` gives the chain tip and `H_close` (`close_height`, `null` while it is `none`) and `inputs.anchors` maps each anchored `ballot_id` to the anchor height a tallier would have verified (SPEC §4.6); a ballot not listed has no anchor. The tally MUST apply SPEC §8 with them, and `expected.reveal_accepted`, where present, is whether the reveal is accepted at that tip. A vector without `inputs.chain` has a snapshot block with at least 6 confirmations.
5. In secret-mode vectors, additionally verify every `secret.commit` matches `SHA256("oc-vote/v0/commit\npoll_id: …\nvoter: …\noption: …\n")`, and that the reveal's `reveal_sk` is the X25519 secret key for the poll's `reveal_pk` (SPEC §10.3).

If any of these diverge, the implementation is non-conformant. Typical bugs:

- Serializing booleans, nulls, or numbers non-canonically.
- Sorting object keys once but not recursively.
- Omitting the trailing LF.
- Escaping codepoints above U+001F when the spec requires them literal.
- Preserving `sig.value` (instead of emptying it) when computing `*_id`.
- Skipping the `min_sats` / `min_days` threshold when computing voter weight.
- Applying the `sats_days` cap per-voter instead of per-UTXO.

## Signatures

BIP-322 signatures in these vectors are **fake placeholders** (base64 of "ALICE-signature-fake-for-test-vector" and similar). Real conformance tests at integration time MUST substitute real signatures produced by a wallet signing the corresponding `*_id`. The canonicalization and id computation are independent of signature validity, so the vectors are useful without real signatures; the tally function is expected to be run with `verify_bip322` stubbed in these fixtures.

## Current vectors

| File | Exercises |
|---|---|
| [`v01-minimal-public.json`](./v01-minimal-public.json) | Single voter, `sats` weight, minimal fields |
| [`v02-sats-weighted.json`](./v02-sats-weighted.json) | Three voters, `sats` weight, one below `min_sats` (zero contribution) |
| [`v03-sats-days-weighted.json`](./v03-sats-days-weighted.json) | `sats_days` weight with `cap_days: 180`; multi-UTXO voter; one UTXO beyond the cap |
| [`v04-vote-change.json`](./v04-vote-change.json) | Same voter casts two ballots; `tiebreak: latest` picks the later one |
| [`v05-secret-ballot.json`](./v05-secret-ballot.json) | Secret-mode ballot with `null` option pre-reveal + `commit`; reveal event; `awaiting_reveal` → `tallied` state transition |
| [`v06-tiebreak-first.json`](./v06-tiebreak-first.json) | `tiebreak: first`; one voter, three ballots, two at the same earliest `created_at`, so the lesser `ballot_id` decides. Relays keep all three (SPEC §4.5); only the §8 tiebreak picks |
| [`v07-ballot-times.json`](./v07-ballot-times.json) | `created_at` MUST be `iso8601_utc` (SPEC §4.3): one voter's ballot dated `late-15`, another voter's with no zone, a third's dated 31 April. All three are dropped, whatever the ballot order or the tallier's time zone |
| [`v08-anchor-too-late.json`](./v08-anchor-too-late.json) | Anchored poll (SPEC §4.6): a ballot dated at the deadline but anchored at `H_close + G + 1`, and one with no anchor, are dropped from the final tally (`E_NOT_ANCHORED`) |
| [`v09-anchor-at-close-plus-g.json`](./v09-anchor-at-close-plus-g.json) | Anchored poll: a ballot anchored at exactly `H_close + G` counts |
| [`v10-tiebreak-by-anchor.json`](./v10-tiebreak-by-anchor.json) | Anchored poll, `tiebreak: first`: the ballot anchored in the lower block beats one with an earlier `created_at` anchored later |
| [`v11-reveal-before-final.json`](./v11-reveal-before-final.json) | Secret anchored poll: a reveal with the right key, checked at tip `H_close + G + 5`, is not accepted (`reveal_accepted: false`); the poll stays `awaiting_reveal` |
| [`v12-clock-dated-poll.json`](./v12-clock-dated-poll.json) | Clock-dated poll (deadline before 2026-11-15T00:00:00Z): no anchors needed; the result says `basis: "voter_clocks"` |
| [`v13-provisional.json`](./v13-provisional.json) | Anchored poll at tip `H_close + G + 5`: the tally is `provisional`, still counts the unanchored ballot, and reports `unanchored: 1` |
| [`v14-open-anchored-poll.json`](./v14-open-anchored-poll.json) | Anchored poll still open: `H_close` is `none`, so the tally is `provisional` with `close_height: null`, and `unanchored` counts the ballot with no anchor yet |
| [`v15-deferred.json`](./v15-deferred.json) | `snapshot_block: "deadline"` at tip `H_close + 3`: the snapshot has 4 confirmations, so the result is `deferred` with `E_REORG`, and still carries `basis` and `close_height` |
| [`v16-counted-order.json`](./v16-counted-order.json) | `counted` (SPEC §8) lists each voter's standing `ballot_id` as lowercase hex in ascending order: not input order, not voter order. A superseded ballot is not listed; a withdrawal and a ballot that weighs zero are |
| [`v17-ballot-nested-32.json`](./v17-ballot-nested-32.json) | v04 with the later ballot nested 32 levels deep (SPEC §7), the most allowed: it counts |
| [`v18-ballot-nested-33.json`](./v18-ballot-nested-33.json) | v04 with the later ballot nested 33 levels deep: malformed (SPEC §7), not counted, and the voter's earlier ballot stands |

## Ids at a glance

| Vector | poll_id | ballot_ids | reveal_id |
|---|---|---|---|
| v01 | `3054390f…26ee5` | `6b3b1587…c14cd` | — |
| v02 | `27373a17…57aa4` | `545838e3…18f3ea`, `b4c84b71…65f309`, `ed548b51…76edb9` | — |
| v03 | `571e3615…44ec9` | `b61e2b30…8f3aa` | — |
| v04 | `8e92e84a…a235d` | `ad5402c5…26ab6`, `d51c0445…65449f` | — |
| v05 | `fb739a6c…c48e3` | `b13ed82e…282cb` | `7af2a7b3…f66da` |
| v06 | `57f8363f…bd6d7` | `7b530d90…ab122`, `b69e5d6b…526c4`, `681e78f4…de5e6` | — |
| v07 | `9c35081c…b2831` | `fe3a8990…71f8f`, `af6856f4…a6342`, `ef5f4504…0147d`, `785c751e…fd01d`, `69279368…c087f` | — |
| v08 | `411a57b8…5ebed` | `0e8199aa…41c97`, `a09a4dc9…edfad`, `ead61dc0…f60e3` | — |
| v09 | `258aeb21…fe2e9` | `eaf805a4…c50f8`, `3dd6f2f4…19e94` | — |
| v10 | `8a938410…49dbb` | `06cc07f9…2b400`, `aa0b6a98…c8484` | — |
| v11 | `c8c8937d…3580a` | `00f615ab…b2efe` | `0833a42f…9a7d9` |
| v12 | `cccfb604…50998` | `0c38329c…f8be8`, `9542b7f8…bd250` | — |
| v13 | `1c18d880…bca60` | `924b6f91…e390f`, `2f305bc0…c998f` | — |
| v14 | `210e6ac1…d9de2` | `81ca4eb9…339a1`, `a85edb09…83681` | — |
| v15 | `df538742…0bf54` | `eabeb2d3…15338` | — |
| v16 | `5be35db7…15b46` | `97cfc4ae…e8008`, `9dff3555…3bfd4`, `03086c6c…d084e`, `097f3e0e…fae2b`, `f5e56afc…9022e` | — |
| v17 | `8e92e84a…a235d` | `ad5402c5…26ab6`, `7f1339db…7d407` | — |
| v18 | `8e92e84a…a235d` | `ad5402c5…26ab6`, `983a3ba9…4f54e` | — |

(Ids in this table are truncated; the vector files have full 64-char hex.)

## Test harness

The `@orangecheck/vote-core` suite in `oc-packages/vote-core/` loads this directory and asserts byte-equality per vector. New implementations should add a similar test.

## How these vectors were generated

A one-shot Node script (RFC 8785 canonicalization + Node `crypto.createHash('sha256')`) produced the ids and canonical bytes. The script is not in this repo — it's used as a seeding tool. The reference TypeScript SDK in `oc-packages` is the canonical producer-verifier from here on.
