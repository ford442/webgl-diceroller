/**
 * seedUtil.ts — widen a JS `number` (or `bigint`) RNG seed to the `bigint`
 * Embind now expects for `DicePhysicsEngine.seedRNG(uint64_t)`
 * (-s WASM_BIGINT=1; see emcc_flags.inc.sh). Embind does not auto-convert a
 * plain `number` to a 64-bit arg — callers must pass an actual `bigint`.
 *
 * `BigInt.asUintN(64, ...)` also matches the wrap-around behaviour a JS
 * caller doing `seed >>> 0` (mod 2**32) or C++ doing `uint64_t` overflow
 * would expect, just at the full 64-bit width instead of 32.
 */
export function toRngSeedBigInt(seed: number | bigint): bigint {
    const whole = typeof seed === 'bigint' ? seed : BigInt(Math.trunc(seed));
    return BigInt.asUintN(64, whole);
}
