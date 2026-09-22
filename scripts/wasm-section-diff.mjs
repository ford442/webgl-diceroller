#!/usr/bin/env node
/**
 * wasm-section-diff.mjs — Report which WebAssembly sections differ between two
 * .wasm files.
 *
 * Used by scripts/verify-cmake-wasm-parity.sh when build.sh's artifact and
 * CMake's are not byte-identical. `cmp` alone reports one offset, which says
 * nothing about *what* diverged; knowing it is (say) the `name` custom section
 * rather than `code` is the difference between "cosmetic path leakage, fix with
 * -ffile-prefix-map" and "the two builds generate different physics".
 *
 * Usage: node scripts/wasm-section-diff.mjs <a.wasm> <b.wasm> [--verdict]
 *
 * Without --verdict it always exits 0: a diagnostic, the caller owns the
 * verdict. With --verdict it exits 0 only when the two files have the same
 * section list (same count, same labels, same order) AND the same size for
 * every section AND the same total size. That is the "structurally identical,
 * content renumbered" case — see verify-cmake-wasm-parity.sh, which uses it to
 * tell symbol renumbering apart from a real codegen difference. Flag drift
 * (-DNDEBUG, a missing -msimd128, a different -O) moves section sizes, so it
 * cannot pass this.
 */

import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SECTION_NAMES = [
    'custom',
    'type',
    'import',
    'function',
    'table',
    'memory',
    'global',
    'export',
    'start',
    'element',
    'code',
    'data',
    'datacount',
    'tag',
];

/** Read a LEB128 unsigned int at `offset`; returns [value, bytesRead]. */
function readVarUint(buf, offset) {
    let result = 0;
    let shift = 0;
    let read = 0;
    for (;;) {
        if (offset + read >= buf.length) throw new Error('truncated LEB128');
        const byte = buf[offset + read];
        read += 1;
        result += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
        if (shift > 35) throw new Error('LEB128 too long');
    }
    return [result, read];
}

/**
 * Split a wasm binary into its sections. Custom sections carry a name, which is
 * what distinguishes `name` / `producers` / `target_features` from each other.
 */
function parseSections(buf) {
    if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100) {
        throw new Error('not a wasm binary (bad magic)');
    }
    const sections = [];
    let offset = 8;
    while (offset < buf.length) {
        const id = buf[offset];
        offset += 1;
        const [size, sizeLen] = readVarUint(buf, offset);
        offset += sizeLen;
        const body = buf.subarray(offset, offset + size);
        let label = SECTION_NAMES[id] ?? `unknown(${id})`;
        if (id === 0) {
            try {
                const [nameLen, nameLenBytes] = readVarUint(body, 0);
                const name = body.subarray(nameLenBytes, nameLenBytes + nameLen).toString('utf8');
                label = `custom "${name}"`;
            } catch {
                label = 'custom (unparsable name)';
            }
        }
        sections.push({
            key: `${id}:${label}:${sections.length}`,
            label,
            size,
            sha: createHash('sha256').update(body).digest('hex').slice(0, 16),
        });
        offset += size;
    }
    return sections;
}

const argv = process.argv.slice(2);
const verdictMode = argv.includes('--verdict');
const [aPath, bPath] = argv.filter((arg) => arg !== '--verdict');
if (!aPath || !bPath) {
    console.error('usage: wasm-section-diff.mjs <a.wasm> <b.wasm> [--verdict]');
    process.exit(verdictMode ? 2 : 0);
}

let a;
let b;
try {
    a = parseSections(readFileSync(aPath));
    b = parseSections(readFileSync(bPath));
} catch (err) {
    console.log(`[wasm-section-diff] could not parse: ${err.message}`);
    // Unparsable means equivalence cannot be vouched for, so --verdict fails.
    process.exit(verdictMode ? 1 : 0);
}

console.log(`[wasm-section-diff] ${aPath} -> ${a.length} sections`);
console.log(`[wasm-section-diff] ${bPath} -> ${b.length} sections`);

const rows = [];
const max = Math.max(a.length, b.length);
for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) {
        rows.push(
            `  #${i} ${left?.label ?? '(absent)'} vs ${right?.label ?? '(absent)'} — section list length differs`
        );
        continue;
    }
    if (left.label !== right.label) {
        rows.push(`  #${i} ORDER: "${left.label}" vs "${right.label}"`);
        continue;
    }
    if (left.size !== right.size || left.sha !== right.sha) {
        rows.push(
            `  #${i} ${left.label}: ${left.size}B/${left.sha} vs ${right.size}B/${right.sha}`
        );
    }
}

if (rows.length === 0) {
    console.log(
        '[wasm-section-diff] every section matches (difference is outside section bodies).'
    );
} else {
    console.log('[wasm-section-diff] differing sections:');
    for (const row of rows) console.log(row);
}

// Structural equivalence: the same sections in the same order, each the same
// size, and the same total. Content may still differ (symbol renumbering).
const sameShape =
    a.length === b.length &&
    a.every((left, i) => left.label === b[i].label && left.size === b[i].size) &&
    statSync(aPath).size === statSync(bPath).size;

console.log(
    sameShape
        ? '[wasm-section-diff] VERDICT: structurally identical (same sections, same sizes, same total).'
        : '[wasm-section-diff] VERDICT: structurally different (section list, a section size, or the total differs).'
);

if (verdictMode && !sameShape) process.exit(1);
