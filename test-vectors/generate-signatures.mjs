#!/usr/bin/env node
/**
 * Signature vector generator for OC Vote (v19-v24).
 *
 *   node test-vectors/generate-signatures.mjs
 *
 * One poll and one ballot per address type, both signed by the same disclosed
 * burn key, so a second implementation can check its BIP-322 wiring against
 * real signatures: P2PKH (legacy BIP-137 form), P2SH-P2WPKH, P2WPKH and P2TR
 * (BIP-322 simple form). v23 is v21 with one byte of the ballot's signature
 * flipped: the poll still verifies, and the ballot MUST be dropped. v24 is v21
 * with one byte of the poll's signature flipped: the ballot still verifies,
 * and the poll MUST be refused, so no tally is given.
 *
 * The private keys below are published and never to be used for funds.
 * Anyone can spend what is sent to their addresses. They are the keys
 * oc-stamp-protocol's v10-v14 use; #1 and #2 are oc-attest-protocol's tv21
 * and tv22 keys.
 *
 * Dependencies (bip322-js 3, bitcoinjs-lib 6, ecpair 2,
 * @bitcoinerlab/secp256k1) come from a node_modules that has them: by default
 * oc-packages/wallet-adapter in a clone next to this repository, or the
 * directory in OC_SIGNER_NODE_MODULES. ECDSA signing is RFC 6979
 * deterministic; a P2TR signature can differ on each run and still verifies.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES =
    process.env.OC_SIGNER_NODE_MODULES ??
    join(HERE, '..', '..', 'oc-packages', 'wallet-adapter', 'node_modules');
const require = createRequire(join(MODULES, '_.js'));
const bip322 = require('bip322-js');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@bitcoinerlab/secp256k1');
const { ECPairFactory } = require('ecpair');
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.bitcoin;

// Disclosed burn keys. Never send bitcoin to the addresses they derive.
const KEYS = {
    p2wpkh: '01'.repeat(32), // oc-attest-protocol key #1 (tv21)
    p2tr: '02'.repeat(32), // oc-attest-protocol key #2 (tv22)
    p2pkh: '03'.repeat(32),
    p2sh_p2wpkh: '04'.repeat(32),
};

function keyPair(hex) {
    return ECPair.fromPrivateKey(Buffer.from(hex, 'hex'), { network });
}

function addressOf(type, hex) {
    const pubkey = Buffer.from(keyPair(hex).publicKey);
    if (type === 'p2pkh') return bitcoin.payments.p2pkh({ pubkey, network }).address;
    if (type === 'p2wpkh') return bitcoin.payments.p2wpkh({ pubkey, network }).address;
    if (type === 'p2sh_p2wpkh')
        return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network })
            .address;
    if (type === 'p2tr')
        return bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33), network }).address;
    throw new Error(`unknown address type ${type}`);
}

// SPEC §7: RFC 8785 with the trailing LF; scripts/validate-vectors.mjs holds the same.
function canonicalize(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

/** The canonical bytes with `sig.value` emptied, and their SHA-256 as hex (SPEC §3.2, §4.2). */
function idOf(obj) {
    const clone = structuredClone(obj);
    clone.sig.value = '';
    const canonical = canonicalize(clone) + '\n';
    return { canonical, id: createHash('sha256').update(canonical, 'utf8').digest('hex') };
}

/** v01's poll and ballot, with `address` as both the creator and the voter. */
function signedPair(type) {
    const address = addressOf(type, KEYS[type]);
    const wif = keyPair(KEYS[type]).toWIF();
    const poll = {
        v: 0,
        kind: 'oc-vote/poll',
        creator: address,
        question: 'Do we ship?',
        options: [
            { id: 'yes', label: 'Ship it' },
            { id: 'no', label: 'Hold' },
        ],
        deadline: '2026-05-08T00:00:00Z',
        snapshot_block: 900000,
        weight_mode: 'sats',
        weight_params: null,
        min_sats: 100000,
        min_days: 30,
        mode: 'public',
        reveal_pk: null,
        tiebreak: 'latest',
        notes: null,
        created_at: '2026-04-22T12:00:00Z',
        sig: { alg: 'bip322', pubkey: address, value: '' },
    };
    const p = idOf(poll);
    // SPEC §3.1 and §4.1: the wallet signs the 64-character hex id.
    poll.sig.value = bip322.Signer.sign(wif, address, p.id);
    const ballot = {
        v: 0,
        kind: 'oc-vote/ballot',
        poll_id: p.id,
        voter: address,
        option: 'yes',
        attestation_id: null,
        secret: null,
        created_at: '2026-04-23T09:15:00Z',
        sig: { alg: 'bip322', pubkey: address, value: '' },
    };
    const b = idOf(ballot);
    ballot.sig.value = bip322.Signer.sign(wif, address, b.id);
    for (const [what, id, sig] of [
        ['poll', p.id, poll.sig.value],
        ['ballot', b.id, ballot.sig.value],
    ]) {
        if (!bip322.Verifier.verifySignature(address, id, sig))
            throw new Error(`${type} ${what}: bip322-js does not verify its own signature`);
    }
    return { address, poll, ballot, p, b };
}

function vector({ description, type, format, pair, ballotOutcome, pollOutcome = { outcome: 'ACCEPT' } }) {
    const { address, poll, ballot, p, b } = pair;
    const counted = ballotOutcome.outcome === 'ACCEPT';
    // A refused poll is refused whole (SPEC §10.1): the tally names the error, not a result.
    const result =
        pollOutcome.outcome === 'ACCEPT'
            ? {
                  expected_result: {
                      state: 'tallied',
                      basis: 'voter_clocks',
                      snapshot_block: 900000,
                      turnout: counted ? { voters: 1, weight: 250000 } : { voters: 0, weight: 0 },
                      tallies: { yes: counted ? 250000 : 0, no: 0 },
                      counted: counted ? [b.id] : [],
                  },
              }
            : { expected_error: pollOutcome.error_code };
    return {
        description,
        inputs: { poll, ballots: [ballot] },
        expected: {
            poll_id: p.id,
            poll_canonical: p.canonical,
            ballot_ids: [b.id],
            ballot_canonicals: [b.canonical],
            tally_with_utxos: {
                utxo_snapshot: { [address]: [{ value: 250000, confirmed_height: 895000 }] },
                ...result,
            },
        },
        signature_check: {
            address_type: type,
            format,
            poll: { signed_message: p.id, expected: pollOutcome },
            ballot: { signed_message: b.id, expected: ballotOutcome },
        },
    };
}

const TYPES = [
    ['v19-sig-p2pkh.json', 'p2pkh', 'bip137', 'P2PKH, legacy BIP-137 signatures'],
    ['v20-sig-p2sh-p2wpkh.json', 'p2sh_p2wpkh', 'bip322-simple', 'P2SH-P2WPKH, BIP-322 simple signatures'],
    ['v21-sig-p2wpkh.json', 'p2wpkh', 'bip322-simple', 'P2WPKH, BIP-322 simple signatures'],
    ['v22-sig-p2tr.json', 'p2tr', 'bip322-simple', 'P2TR key path, BIP-322 simple signatures'],
];

const out = [];
for (const [file, type, format, what] of TYPES) {
    out.push({
        file,
        body: vector({
            description: `${what}: v01's poll and ballot, each signed over its hex id by one disclosed burn key; both MUST verify and the ballot counts`,
            type,
            format,
            pair: signedPair(type),
            ballotOutcome: { outcome: 'ACCEPT' },
        }),
    });
}

// v23: v21 with the middle byte of the ballot's signature flipped; length and base64 shape unchanged.
{
    const pair = structuredClone(signedPair('p2wpkh'));
    pair.poll = structuredClone(out[2].body.inputs.poll);
    pair.ballot = structuredClone(out[2].body.inputs.ballots[0]);
    const bytes = Buffer.from(pair.ballot.sig.value, 'base64');
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    pair.ballot.sig.value = bytes.toString('base64');
    if (bip322.Verifier.verifySignature(pair.address, pair.b.id, pair.ballot.sig.value))
        throw new Error('v23: the flipped signature still verifies');
    out.push({
        file: 'v23-sig-tampered.json',
        body: vector({
            description:
                "v21 with one byte of the ballot's signature flipped: the poll verifies, the ballot MUST NOT (E_BAD_SIG) and is dropped from the tally",
            type: 'p2wpkh',
            format: 'bip322-simple',
            pair,
            ballotOutcome: { outcome: 'REJECT', error_code: 'E_BAD_SIG' },
        }),
    });
}

// v24: v21 with the middle byte of the poll's signature flipped; length and base64 shape unchanged.
{
    const pair = structuredClone(signedPair('p2wpkh'));
    pair.poll = structuredClone(out[2].body.inputs.poll);
    pair.ballot = structuredClone(out[2].body.inputs.ballots[0]);
    const bytes = Buffer.from(pair.poll.sig.value, 'base64');
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    pair.poll.sig.value = bytes.toString('base64');
    if (bip322.Verifier.verifySignature(pair.address, pair.p.id, pair.poll.sig.value))
        throw new Error('v24: the flipped signature still verifies');
    out.push({
        file: 'v24-sig-poll-tampered.json',
        body: vector({
            description:
                "v21 with one byte of the poll's signature flipped: the ballot verifies, the poll MUST NOT (E_BAD_SIG), and the tally refuses the poll (SPEC §10.1)",
            type: 'p2wpkh',
            format: 'bip322-simple',
            pair,
            pollOutcome: { outcome: 'REJECT', error_code: 'E_BAD_SIG' },
            ballotOutcome: { outcome: 'ACCEPT' },
        }),
    });
}

for (const { file, body } of out) {
    writeFileSync(join(HERE, file), JSON.stringify(body, null, 2) + '\n', 'utf8');
    console.log(`${file}: ${body.inputs.poll.creator}`);
}
