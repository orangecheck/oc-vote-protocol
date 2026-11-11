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
  },
  "signature_check": {                                   // v19–v23 only
    "address_type": "p2pkh" | "p2sh_p2wpkh" | "p2wpkh" | "p2tr",
    "format":       "bip137" | "bip322-simple",
    "poll":   { "signed_message": "<poll_id>",   "expected": { "outcome": "ACCEPT" } },
    "ballot": { "signed_message": "<ballot_id>", "expected": { "outcome": "ACCEPT" } | { "outcome": "REJECT", "error_code": "E_BAD_SIG" } }
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
6. For a vector with `signature_check`, verify the poll's and the ballot's `sig.value` with the real BIP-322 verifier over its `signed_message`, the hex id (SPEC §3.3, §4.1, §10 item 1): `ACCEPT` means the signature verifies, `REJECT` means verification fails with `error_code`. Run the tally with that verifier, not a stub: a refused ballot is dropped, as `expected_result` shows.

If any of these diverge, the implementation is non-conformant. Typical bugs:

- Serializing booleans, nulls, or numbers non-canonically.
- Sorting object keys once but not recursively.
- Omitting the trailing LF.
- Escaping codepoints above U+001F when the spec requires them literal.
- Preserving `sig.value` (instead of emptying it) when computing `*_id`.
- Skipping the `min_sats` / `min_days` threshold when computing voter weight.
- Applying the `sats_days` cap per-voter instead of per-UTXO.

## Signatures

- In v01–v18, `sig.value` is a placeholder for bookkeeping, not a signature. Those vectors test canonical bytes, ids and the tally; the canonicalization and id computation are independent of signature validity, and a tallier that runs them needs `verify_bip322` stubbed.
- v19–v23 carry real signatures from disclosed burn keys (see "Signature vectors" below), and their tally runs with the real verifier. Two wallets signing the same id need not produce the same bytes: an ECDSA wallet may not use RFC 6979 nonces, and a BIP-340 (P2TR) signature takes fresh auxiliary randomness. The assertion is that a signature **verifies**, never that it equals a stored one.

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
| [`v19-sig-p2pkh.json`](./v19-sig-p2pkh.json) | v01's poll and ballot with one P2PKH address as creator and voter, signed in legacy BIP-137 form: both MUST verify and the ballot counts |
| [`v20-sig-p2sh-p2wpkh.json`](./v20-sig-p2sh-p2wpkh.json) | The same, P2SH-P2WPKH, BIP-322 simple form |
| [`v21-sig-p2wpkh.json`](./v21-sig-p2wpkh.json) | The same, P2WPKH, BIP-322 simple form |
| [`v22-sig-p2tr.json`](./v22-sig-p2tr.json) | The same, P2TR key path, BIP-322 simple form |
| [`v23-sig-tampered.json`](./v23-sig-tampered.json) | v21 with one byte of the ballot's signature flipped: the poll verifies, the ballot MUST NOT (`E_BAD_SIG`) and is not counted |

### Signature vectors (v19–v23)

These take v01's poll and ballot (the same question, options, deadline, snapshot and dates) and put one **disclosed burn key**'s address in both `creator` and `voter`. The private keys are published in `generate-signatures.mjs` and must never hold funds: anyone can spend what is sent to their addresses. They are the keys `oc-stamp-protocol`'s v10–v14 use; #1 and #2 are the ones `oc-attest-protocol`'s tv21 and tv22 use.

| Key | Private key (hex) | Address type | Address | Vectors |
|---|---|---|---|---|
| #1 | `01` repeated 32 times | P2WPKH | `bc1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw` | v21, v23 |
| #2 | `02` repeated 32 times | P2TR, key path (BIP-86) | `bc1p5e6v9v2j5wp3y6c79gaqdqltq7jdv45fswnnm7exmmp2020mqepsmcx06p` | v22 |
| #3 | `03` repeated 32 times | P2PKH | `16yH2E12NYA5pg1d4BB7wtXXnBTZ8Lws7L` | v19 |
| #4 | `04` repeated 32 times | P2SH-P2WPKH | `38Sqvnn4PbsHHfarwki7bm2vSeYvuZDgpz` | v20 |

The wallet signs the hex id (SPEC §3.3, §4.1), so `signature_check.poll.signed_message` equals `expected.poll_id` and `signature_check.ballot.signed_message` equals `expected.ballot_ids[0]`. The poll is clock-dated (its deadline is before 2026-11-15T00:00:00Z), so no anchors are needed. v20 covers the nested SegWit form.

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
| v19 | `449ef050…d7ae9` | `46a31684…89549` | — |
| v20 | `cbcdd22a…9825f` | `09fce803…2522d` | — |
| v21 | `1daab4eb…24cf7` | `bfb711a9…7f131` | — |
| v22 | `33011387…fc758` | `be02accf…c136c` | — |
| v23 | `1daab4eb…24cf7` | `bfb711a9…7f131` | — |

(Ids in this table are truncated; the vector files have full 64-char hex.)

## Test harness

The `@orangecheck/vote-core` suite in `oc-packages/vote-core/` loads this directory and asserts byte-equality per vector. For each vector with `signature_check` it verifies the poll and the ballot through the real `@orangecheck/bip322` verifier and tallies with it, and it checks the set covers all four address types plus a refused ballot. New implementations should add a similar test.

## How these vectors were generated

A one-shot Node script (RFC 8785 canonicalization + Node `crypto.createHash('sha256')`) produced the ids and canonical bytes. The script is not in this repo — it's used as a seeding tool. The reference TypeScript SDK in `oc-packages` is the canonical producer-verifier from here on.

`node test-vectors/generate-signatures.mjs` writes v19–v23 again. It loads bip322-js 3, bitcoinjs-lib 6, ecpair 2 and @bitcoinerlab/secp256k1 from `oc-packages/wallet-adapter/node_modules` in a clone next to this repository, or from the directory in `OC_SIGNER_NODE_MODULES`. v19–v21 and v23 come out byte for byte the same; v22's P2TR signatures differ on each run and still verify.
