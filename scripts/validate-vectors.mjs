#!/usr/bin/env node
// Validate the committed test vectors without a JS SDK:
//   - Every JSON file parses.
//   - Required fields present.
//   - poll_canonical is byte-identical to what canonicalize() produces.
//   - poll_id / ballot_id / reveal_id match SHA-256(poll_canonical) etc.
//
// Purely node-native: @noble is the only extra but we use node:crypto to
// avoid needing a package.json in the spec repo.
//
// Run: node scripts/validate-vectors.mjs
// Exits non-zero if any vector fails.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, '..', 'test-vectors');

// ---- Canonicalization (RFC 8785 + our constraints; mirror of vote-core) --

function canonicalize(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('non-finite number');
        return String(value);
    }
    if (typeof value === 'string') return escapeString(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return (
            '{' +
            keys.map((k) => escapeString(k) + ':' + canonicalize(value[k])).join(',') +
            '}'
        );
    }
    throw new Error('unsupported type: ' + typeof value);
}

function escapeString(s) {
    let out = '"';
    for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (ch === '"') out += '\\"';
        else if (ch === '\\') out += '\\\\';
        else if (cp < 0x20) out += '\\u' + cp.toString(16).padStart(4, '0');
        else out += ch;
    }
    return out + '"';
}

function canonicalBytes(v) {
    return canonicalize(v) + '\n';
}

function sha256Hex(utf8) {
    return createHash('sha256').update(Buffer.from(utf8, 'utf8')).digest('hex');
}

function idOf(obj) {
    const clone = structuredClone(obj);
    if (clone.sig) clone.sig.value = '';
    return sha256Hex(canonicalBytes(clone));
}

// ---- Validator -----------------------------------------------------------

const files = readdirSync(VECTORS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

if (files.length < 5) {
    console.error(`✗ expected ≥ 5 vectors in ${VECTORS_DIR}, found ${files.length}`);
    process.exit(1);
}

let failures = 0;

for (const name of files) {
    const text = readFileSync(join(VECTORS_DIR, name), 'utf8');
    let vec;
    try {
        vec = JSON.parse(text);
    } catch (err) {
        console.error(`✗ ${name}: invalid JSON — ${err.message}`);
        failures++;
        continue;
    }

    const issues = [];
    const { inputs, expected } = vec;
    if (!inputs?.poll) issues.push('missing inputs.poll');
    if (!expected?.poll_id) issues.push('missing expected.poll_id');
    if (!expected?.poll_canonical) issues.push('missing expected.poll_canonical');

    if (inputs?.poll) {
        const computedPollId = idOf(inputs.poll);
        if (computedPollId !== expected.poll_id) {
            issues.push(
                `poll_id drift: got ${computedPollId}, expected ${expected.poll_id}`
            );
        }
        const clone = structuredClone(inputs.poll);
        if (clone.sig) clone.sig.value = '';
        const canonical = canonicalBytes(clone);
        if (canonical !== expected.poll_canonical) {
            issues.push('poll_canonical drift');
        }
    }

    if (Array.isArray(inputs?.ballots) && Array.isArray(expected?.ballot_ids)) {
        for (let i = 0; i < inputs.ballots.length; i++) {
            const b = inputs.ballots[i];
            const expId = expected.ballot_ids[i];
            if (!expId) {
                issues.push(`ballot #${i} has no expected id`);
                continue;
            }
            const got = idOf(b);
            if (got !== expId) {
                issues.push(
                    `ballot_id #${i} drift: got ${got}, expected ${expId}`
                );
            }
        }
    }

    if (inputs?.reveal && expected?.reveal_id) {
        const got = idOf(inputs.reveal);
        if (got !== expected.reveal_id) {
            issues.push(`reveal_id drift: got ${got}, expected ${expected.reveal_id}`);
        }
    }

    if (issues.length) {
        console.error(`✗ ${name}`);
        for (const i of issues) console.error(`  - ${i}`);
        failures++;
    } else {
        console.log(`✓ ${name}`);
    }
}

if (failures) {
    console.error(`\n${failures}/${files.length} vector(s) failed`);
    process.exit(1);
}
console.log(`\n${files.length}/${files.length} vectors validated`);
