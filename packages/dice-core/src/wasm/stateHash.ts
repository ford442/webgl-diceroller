/**
 * FNV-1a 64 of a serialized engine state, as `0x` + 16 hex digits — the
 * fingerprint the solver goldens (tests/fixtures/solver-golden.json) and the
 * dice-core roll goldens (golden/rolls.json) pin.
 */
export function fnv1a64Hex(bytes: ArrayLike<number>): string {
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < bytes.length; i++) {
        h ^= BigInt(bytes[i]! & 0xff);
        h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return '0x' + h.toString(16).padStart(16, '0');
}
