/** Audio-rate PRNG shared by the DSP engine and the room-impulse generator. */
export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32) — audio-rate noise and jitter. */
export function createRng(seed = 0x7a7e2b): Rng {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
