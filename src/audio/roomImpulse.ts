/**
 * Procedural velvet-room impulse response for the tavern `ConvolverNode`.
 *
 * No IR asset ships: a short stereo tail is generated once per session from
 * decorrelated noise under an exponential decay, darkened over time by a
 * one-pole lowpass whose cutoff falls as the tail ages (cloth and timber eat
 * the highs first), plus a handful of early reflections off the table, the
 * back wall and the ceiling beams. ~60k samples at 48 kHz — a millisecond or
 * two of work, so it is recomputed rather than cached in IndexedDB.
 */
import { createRng } from './worklet/rng.js';

export interface RoomImpulseOptions {
    seconds?: number;
    /** Time for the tail to fall by 60 dB, seconds. */
    rt60?: number;
    seed?: number;
}

/** Early reflections: [delay seconds, gain, pan (-1 left … 1 right)]. */
const EARLY_REFLECTIONS: Array<[number, number, number]> = [
    [0.0071, 0.55, -0.3],
    [0.0113, 0.42, 0.45],
    [0.0167, 0.33, -0.6],
    [0.0229, 0.26, 0.2],
    [0.0311, 0.18, 0.7],
];

export function generateRoomImpulse(
    sampleRate: number,
    { seconds = 0.6, rt60 = 0.55, seed = 0x7a7e }: RoomImpulseOptions = {}
): [Float32Array, Float32Array] {
    const length = Math.max(1, Math.floor(sampleRate * seconds));
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    const rng = createRng(seed);
    // exp(-6.91 t / rt60) is -60 dB at rt60.
    const decayPerSample = Math.exp(-6.907755 / (rt60 * sampleRate));
    const onsetSamples = Math.round(0.004 * sampleRate);

    let env = 1;
    let lpL = 0;
    let lpR = 0;
    for (let i = 0; i < length; i++) {
        const age = i / length;
        // Cutoff sweeps ~7 kHz → ~900 Hz across the tail.
        const cutoff = 7000 * Math.pow(900 / 7000, age);
        const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
        lpL += a * (rng() * 2 - 1 - lpL);
        lpR += a * (rng() * 2 - 1 - lpR);
        // Short fade-in so the diffuse tail does not start with a hard edge.
        const onset = i < onsetSamples ? i / onsetSamples : 1;
        left[i] = lpL * env * onset;
        right[i] = lpR * env * onset;
        env *= decayPerSample;
    }

    for (const [delay, gain, pan] of EARLY_REFLECTIONS) {
        const idx = Math.round(delay * sampleRate);
        if (idx >= length) continue;
        left[idx]! += gain * Math.cos(((pan + 1) * Math.PI) / 4);
        right[idx]! += gain * Math.sin(((pan + 1) * Math.PI) / 4);
    }
    return [left, right];
}
