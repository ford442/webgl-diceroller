/**
 * Candle + fireplace flicker.
 *
 * Both used to draw `Math.random()` every frame, which made two runs of the
 * same scene differ: `?debug` screenshots and the render-regression baselines
 * picked up whatever phase the flame happened to be in, and a replayed table
 * could never match the run it replayed. Flicker is now a pure function of
 * `time` — smoothed value noise over a deterministic integer hash — so the
 * same second of the same scene always lights the same way, and `?test`
 * freezes it outright so a baseline capture never races the flame.
 */

/** Flicker samples per second. Fixed so the look does not track frame rate. */
const FLICKER_HZ = 18;

/** Time the frozen (`?test`) profile samples, in seconds. */
const FROZEN_TIME = 0.5;

/** Integer avalanche hash → [0, 1). */
function hash01(n) {
    let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x / 4294967296;
}

/**
 * Smoothed value noise in [0, 1) for `channel`, sampled at `time` seconds.
 * Independent channels keep the intensity flicker and the positional jitter
 * from moving in lockstep the way three `Math.random()` calls happened to.
 */
export function flickerNoise(time, channel) {
    const scaled = time * FLICKER_HZ;
    const i = Math.floor(scaled);
    const f = scaled - i;
    const a = hash01(i * 8 + channel);
    const b = hash01((i + 1) * 8 + channel);
    const smooth = f * f * (3 - 2 * f);
    return a + (b - a) * smooth;
}

/** Signed flicker in [-0.5, 0.5) — the drop-in shape of `Math.random() - 0.5`. */
function signedFlicker(time, channel) {
    return flickerNoise(time, channel) - 0.5;
}

const CHANNEL = {
    candleIntensity: 0,
    candleJitterX: 1,
    candleJitterY: 2,
    candleJitterZ: 3,
    fireplaceCrackle: 4,
};

/**
 * Typed by what the system actually touches rather than by `THREE.PointLight`
 * — the whole surface here is one scalar and a `position.set`, and a narrower
 * type keeps a test able to hand in a plain object.
 *
 * @param {{ intensity: number, position: { set(x: number, y: number, z: number): void } } | null | undefined} pointLight
 * @param {() => { x: number, y: number, z: number } | null | undefined} getFlamePosition
 * @param {{ frozen?: boolean }} [options] `frozen` pins the flame to a single
 *   sample (see `?test`), so a screenshot never depends on flicker phase.
 */
export function createCandleFlickerSystem(pointLight, getFlamePosition, options = {}) {
    const { frozen = false } = options;
    return ({ time }) => {
        const flamePosition = getFlamePosition();
        if (!pointLight || !flamePosition) return;

        const t = frozen ? FROZEN_TIME : time;
        const breathing = frozen ? 0 : Math.sin(time * 2.0) * 0.2;
        const flicker = signedFlicker(t, CHANNEL.candleIntensity) * 0.3;

        pointLight.intensity = 2.5 + breathing + flicker;

        const jitterAmount = 0.03;
        pointLight.position.set(
            flamePosition.x + signedFlicker(t, CHANNEL.candleJitterX) * jitterAmount,
            flamePosition.y + 0.1 + signedFlicker(t, CHANNEL.candleJitterY) * jitterAmount * 0.5,
            flamePosition.z + signedFlicker(t, CHANNEL.candleJitterZ) * jitterAmount
        );
    };
}

/**
 * @param {() => { intensity: number } | null | undefined} getFireplaceLight
 * @param {{ frozen?: boolean }} [options]
 */
export function createFireplaceFlickerSystem(getFireplaceLight, options = {}) {
    const { frozen = false } = options;
    return ({ time }) => {
        const fireplaceLight = getFireplaceLight();
        if (!fireplaceLight) return;

        const t = frozen ? FROZEN_TIME : time;
        const deepPulse = frozen ? 0 : Math.sin(time * 3.0) * 0.5;
        const crackle = signedFlicker(t, CHANNEL.fireplaceCrackle) * 1.0;
        fireplaceLight.intensity = 5.0 + deepPulse + crackle;
    };
}
