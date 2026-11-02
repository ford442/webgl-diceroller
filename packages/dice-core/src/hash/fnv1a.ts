/**
 * FNV-1a, the repo's one content hash for things that must agree across
 * clients: dice-set ids, prop RNG seeds and the collider-world hash.
 *
 * Not cryptographic — it names a layout, it does not authenticate one. The
 * 64-bit form runs on 32-bit halves held in doubles rather than `BigInt`, so
 * hashing a few hundred KB of collider text stays in the low milliseconds.
 */

const encoder = new TextEncoder();

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

/** FNV-1a/32 over the UTF-8 bytes of `input`, as an unsigned integer. */
export function fnv1a32(input: string): number {
    let hash = FNV32_OFFSET;
    for (const byte of encoder.encode(input)) {
        hash = Math.imul(hash ^ byte, FNV32_PRIME) >>> 0;
    }
    return hash >>> 0;
}

const TWO_32 = 0x100000000;
// FNV-1a/64 offset basis 0xcbf29ce484222325, split into 32-bit halves.
const FNV64_OFFSET_HI = 0xcbf29ce4;
const FNV64_OFFSET_LO = 0x84222325;
// FNV-1a/64 prime 0x100000001b3 = (0x100 << 32) | 0x1b3.
const FNV64_PRIME_HI = 0x100;
const FNV64_PRIME_LO = 0x1b3;

/** FNV-1a/64 over the UTF-8 bytes of `input`, as 16 lowercase hex digits. */
export function fnv1a64Hex(input: string): string {
    let hi = FNV64_OFFSET_HI;
    let lo = FNV64_OFFSET_LO;
    for (const byte of encoder.encode(input)) {
        lo = (lo ^ byte) >>> 0;
        // (hi:lo) * (PRIME_HI:PRIME_LO) mod 2^64. Every partial product is
        // below 2^42, so the doubles stay exact.
        const low = lo * FNV64_PRIME_LO;
        const carry = Math.floor(low / TWO_32);
        const nextHi = (hi * FNV64_PRIME_LO + lo * FNV64_PRIME_HI + carry) % TWO_32;
        lo = low % TWO_32;
        hi = nextHi;
    }
    return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}
