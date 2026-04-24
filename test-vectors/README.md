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
      "expected_result":  { "state": "tallied", "snapshot_block": <int>, "turnout": {...}, "tallies": {...} }
    }
  }
}
```

## Conformance

Given the `inputs`, a compliant implementation MUST:

1. Canonicalize each object (poll, ballot, reveal) per [`SPEC §7`](../SPEC.md#7-canonicalization). The bytes MUST equal the `*_canonical` strings.
2. Compute each `*_id` as `SHA256(canonical_bytes_with_sig.value_emptied)` per §7.1 / §7.2 / §6.3.
3. Run the tally function per [`SPEC §8`](../SPEC.md#8-tally-algorithm) against the provided `utxo_snapshot`. The output MUST equal `tally_with_utxos.expected_result` after canonical serialization.
4. In secret-mode vectors, additionally verify every `secret.commit` matches `SHA256("oc-vote/v0/commit\npoll_id: …\nvoter: …\noption: …\n")`.

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

## Ids at a glance

| Vector | poll_id | ballot_ids | reveal_id |
|---|---|---|---|
| v01 | `3054390f…26ee5` | `6b3b1587…c14cd` | — |
| v02 | `27373a17…57aa4` | `545838e3…18f3ea`, `b4c84b71…65f309`, `ed548b51…76edb9` | — |
| v03 | `571e3615…44ec9` | `b61e2b30…8f3aa` | — |
| v04 | `8e92e84a…a235d` | `ad5402c5…26ab6`, `d51c0445…65449f` | — |
| v05 | `cc2769b4…20e04` | `57b6f290…15ed5` | `4db64f16…a8d5` |

(Ids in this table are truncated; the vector files have full 64-char hex.)

## Test harness

The `@orangecheck/vote-core` suite in `oc-packages/vote-core/` loads this directory and asserts byte-equality per vector. New implementations should add a similar test.

## How these vectors were generated

A one-shot Node script (RFC 8785 canonicalization + Node `crypto.createHash('sha256')`) produced the ids and canonical bytes. The script is not in this repo — it's used as a seeding tool. The reference TypeScript SDK in `oc-packages` is the canonical producer-verifier from here on.
