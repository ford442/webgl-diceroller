/**
 * Pure tavern DSP: voice allocator, impact envelopes, material filters, ambient
 * bed and flute — the synthesis that used to be built from `OscillatorNode`s /
 * `BiquadFilterNode`s on the main thread, rendered here sample-by-sample.
 *
 * No DOM, no `three`, no `AudioWorkletProcessor` globals: the same engine runs
 * inside `TavernProcessor.ts` (AudioWorklet, the normal path), inside a
 * `ScriptProcessorNode` when `AudioWorklet` is unavailable, and directly under
 * vitest. The main-thread façade (`DiceCollisionAudio.ts`) only posts compact
 * messages ({@link TavernMessage}); every node the graph needs is allocated
 * once, so a 20-die dump cannot grow it.
 *
 * Output layout (see `render`):
 * - `outputs[0]` — stereo "direct" bus: ambient, flute, non-positional voices,
 *   and, in `stereo` pan mode, every positional voice (equal-power + inverse
 *   distance, mirroring the Web Audio PannerNode formulas).
 * - `outputs[1 + k]` — mono slot `k` (`hrtf` pan mode only). The façade feeds
 *   each slot into its own pre-allocated HRTF `PannerNode`.
 */

import { createRng, type Rng } from './rng.js';

export { createRng, type Rng };
export type OscType = 'noise' | 'sine' | 'triangle' | 'sawtooth';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export type PanMode = 'hrtf' | 'stereo';
export type ImpactVoiceKind = 'clack' | 'velvet' | 'wood' | 'leather' | 'glass' | 'metal';
export type PropSurface = 'gong' | 'bell' | 'bubble' | 'bone' | 'click' | 'metal';

/**
 * Gain envelope, times in seconds from part start: linear 0.0001 → `peak` over
 * `attack` (skipped when 0), hold until `hold`, then exponential to 0.0001 at
 * `end` — the same shapes the old graph built from AudioParam ramps.
 */
export interface Envelope {
    peak: number;
    attack: number;
    hold: number;
    end: number;
}

export interface PartSpec {
    osc: OscType;
    freq?: number;
    /** Linear frequency ramp target, reached at `env.end`. */
    freqEnd?: number;
    detuneCents?: number;
    vibratoRate?: number;
    /** Vibrato depth in Hz. */
    vibratoDepth?: number;
    /** Noise only: linear fade to silence over this many seconds (the old decaying noise buffer). */
    taper?: number;
    filter?: { type: FilterType; freq: number; q: number };
    /** Static gain applied on top of the envelope. */
    gain?: number;
    /** Start offset within the voice, seconds. */
    delay?: number;
    env: Envelope;
}

export interface VoiceSpec {
    parts: PartSpec[];
}

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export type TavernMessage =
    | {
          type: 'impact';
          voice: ImpactVoiceKind;
          energy: number;
          mass?: number;
          sides?: number | null;
          slot?: number;
          position?: Vec3 | null;
      }
    | {
          type: 'prop';
          surface: string;
          volume?: number;
          pitch?: number;
          decay?: number | null;
          slot?: number;
          position?: Vec3 | null;
      }
    | { type: 'melody'; notes?: Array<{ f?: number; d?: number; vol?: number }> | null }
    | { type: 'listener'; position: Vec3; forward: Vec3; up: Vec3 }
    | { type: 'ambient'; on?: boolean; intensity?: number }
    | { type: 'config'; maxVoices?: number; energyForMaxVolume?: number };

export interface EngineStats {
    started: number;
    dropped: number;
    stolen: number;
    active: number;
    peakActive: number;
}

export interface EngineOptions {
    sampleRate: number;
    panMode?: PanMode;
    /** Mono spatial slots (hrtf mode). */
    slots?: number;
    maxVoices?: number;
    energyForMaxVolume?: number;
    seed?: number;
}

const FLOOR = 0.0001;
const TWO_PI = Math.PI * 2;

/** PannerNode settings the façade uses in hrtf mode; stereo mode applies the same law. */
export const PANNER_SETTINGS = {
    refDistance: 1.5,
    maxDistance: 22,
    rolloffFactor: 1.2,
} as const;

export const DEFAULT_FLUTE_TUNE: Array<{ f: number; d: number; vol?: number }> = [
    { f: 587.33, d: 0.18 },
    { f: 659.25, d: 0.18 },
    { f: 783.99, d: 0.18 },
    { f: 880.0, d: 0.26 },
    { f: 783.99, d: 0.16 },
    { f: 880.0, d: 0.18 },
    { f: 1046.5, d: 0.42 },
];

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Energy → level mapping
// ---------------------------------------------------------------------------

export interface ImpactLevels {
    volume: number;
    impactBias: number;
    massBias: number;
    sidesPitch: number;
}

/**
 * Kinetic energy (`½mv² + ½Iω²`) → loudness/brightness drivers. Volume is
 * linear in energy up to `energyForMaxVolume`, floored so the faintest audible
 * tick is still a tick.
 */
export function impactLevels(
    energy: number,
    mass = 5,
    sides: number | null = null,
    energyForMaxVolume = 50
): ImpactLevels {
    const e = Math.max(0, finiteOr(energy, 0));
    return {
        volume: clamp(e / energyForMaxVolume, 0.04, 1.0),
        impactBias: clamp(e / 200, 0, 1),
        massBias: clamp((finiteOr(mass, 5) - 5) / 20, -0.15, 0.25),
        sidesPitch: sides ? clamp(1.06 - Math.log2(sides) * 0.04, 0.82, 1.08) : 1,
    };
}

// ---------------------------------------------------------------------------
// Voice recipes (ported 1:1 from the old node graph)
// ---------------------------------------------------------------------------

interface NoiseToneOpts {
    filterType: FilterType;
    freq: number;
    q: number;
    noiseGain: number;
    noiseDecay: number;
    toneType: OscType;
    toneFreq: number;
    toneGain: number;
    toneDecay: number;
}

function noiseTone(parts: PartSpec[], o: NoiseToneOpts) {
    parts.push({
        osc: 'noise',
        taper: o.noiseDecay + 0.01,
        filter: { type: o.filterType, freq: o.freq, q: o.q },
        env: { peak: o.noiseGain, attack: 0, hold: 0, end: o.noiseDecay },
    });
    if (o.toneGain > 0 && o.toneFreq > 0) {
        parts.push({
            osc: o.toneType,
            freq: o.toneFreq,
            env: { peak: o.toneGain, attack: 0, hold: 0, end: o.toneDecay },
        });
    }
}

function metalRing(
    parts: PartSpec[],
    rng: Rng,
    { baseFreq, gain, decay, partials = [1, 2.76, 5.4, 8.9] }: any
) {
    partials.forEach((ratio: number, i: number) => {
        parts.push({
            osc: 'sine',
            freq: baseFreq * ratio,
            detuneCents: (rng() - 0.5) * 8,
            env: {
                peak: gain / (i + 1.3),
                attack: 0.004,
                hold: 0.004,
                end: decay / (1 + i * 0.5),
            },
        });
    });
}

export function buildImpactVoice(kind: ImpactVoiceKind, levels: ImpactLevels, rng: Rng): VoiceSpec {
    const { volume, impactBias, massBias, sidesPitch } = levels;
    const parts: PartSpec[] = [];
    const pitchJitter = (rng() - 0.5) * 0.1;
    const freqJitter = (1 + (rng() - 0.5) * 0.12) * sidesPitch;
    const brightness = clamp((2300 - impactBias * 1100) * (1 - massBias) * sidesPitch, 600, 2600);

    if (kind === 'metal') {
        metalRing(parts, rng, {
            baseFreq: clamp(620 * (1 - massBias) * freqJitter, 300, 1200),
            gain: volume * 0.16,
            decay: 0.35 + impactBias * 0.4,
        });
        noiseTone(parts, {
            filterType: 'highpass',
            freq: brightness * 1.4,
            q: 1.2,
            noiseGain: volume * 0.18,
            noiseDecay: 0.05,
            toneType: 'sine',
            toneFreq: 0,
            toneGain: 0,
            toneDecay: 0.05,
        });
    } else if (kind === 'glass') {
        noiseTone(parts, {
            filterType: 'highpass',
            freq: clamp(3200 * freqJitter, 1500, 5000),
            q: 1.6,
            noiseGain: volume * 0.3,
            noiseDecay: 0.04,
            toneType: 'sine',
            toneFreq: clamp(2600 * freqJitter, 1200, 4000),
            toneGain: volume * 0.12,
            toneDecay: 0.12,
        });
    } else if (kind === 'velvet') {
        const pitch = clamp(0.78 + pitchJitter - impactBias * 0.6 - massBias, 0.6, 0.95);
        noiseTone(parts, {
            filterType: 'lowpass',
            freq: clamp(650 * pitch * sidesPitch, 350, 900),
            q: 0.8,
            noiseGain: volume * 0.36,
            noiseDecay: 0.07,
            toneType: 'triangle',
            toneFreq: brightness * 0.1 * pitch,
            toneGain: volume * 0.12,
            toneDecay: 0.06,
        });
    } else if (kind === 'wood') {
        const pitch = clamp(1.0 + pitchJitter - impactBias - massBias, 0.6, 1.1) * sidesPitch;
        noiseTone(parts, {
            filterType: 'bandpass',
            freq: clamp(brightness * 0.8 * freqJitter, 400, 2200),
            q: 0.9,
            noiseGain: volume * 0.42,
            noiseDecay: 0.09,
            toneType: 'triangle',
            toneFreq: brightness * 0.16 * pitch,
            toneGain: volume * 0.2,
            toneDecay: 0.08,
        });
    } else if (kind === 'leather') {
        const pitch =
            clamp(0.82 + pitchJitter - impactBias * 0.5 - massBias, 0.65, 1.0) * sidesPitch;
        noiseTone(parts, {
            filterType: 'lowpass',
            freq: clamp(550 * pitch, 350, 900),
            q: 0.7,
            noiseGain: volume * 0.38,
            noiseDecay: 0.05,
            toneType: 'triangle',
            toneFreq: brightness * 0.12 * pitch,
            toneGain: volume * 0.1,
            toneDecay: 0.045,
        });
    } else {
        const pitch = clamp(1.0 + pitchJitter - impactBias - massBias, 0.7, 1.15) * sidesPitch;
        noiseTone(parts, {
            filterType: 'highpass',
            freq: clamp(brightness * freqJitter, 700, 2600),
            q: 0.9,
            noiseGain: volume * 0.42,
            noiseDecay: 0.07,
            toneType: 'triangle',
            toneFreq: brightness * 0.2 * pitch,
            toneGain: volume * 0.15,
            toneDecay: 0.06,
        });
    }
    return { parts };
}

export function buildPropVoice(
    surface: string,
    {
        volume = 0.6,
        pitch = 1,
        decay = null,
    }: { volume?: number; pitch?: number; decay?: number | null },
    rng: Rng
): VoiceSpec {
    const v = clamp(finiteOr(volume, 0.6), 0, 1);
    const p = finiteOr(pitch, 1);
    const d = decay == null ? null : Math.max(0.01, finiteOr(decay, 0.6));
    const parts: PartSpec[] = [];

    if (surface === 'gong') {
        metalRing(parts, rng, {
            baseFreq: clamp(150 * p, 80, 400),
            gain: v * 0.5,
            decay: d ?? 1.4,
            partials: [1, 1.5, 2.0, 2.74, 3.76, 5.1, 6.8],
        });
        noiseTone(parts, {
            filterType: 'bandpass',
            freq: 1800,
            q: 0.7,
            noiseGain: v * 0.35,
            noiseDecay: 0.12,
            toneType: 'sine',
            toneFreq: 0,
            toneGain: 0,
            toneDecay: 0.1,
        });
    } else if (surface === 'bell') {
        metalRing(parts, rng, {
            baseFreq: clamp(950 * p, 800, 1200),
            gain: v * 0.38,
            decay: d ?? 0.65,
            partials: [1, 2.1, 3.4, 5.2, 7.1],
        });
        noiseTone(parts, {
            filterType: 'highpass',
            freq: 2400,
            q: 1.0,
            noiseGain: v * 0.2,
            noiseDecay: 0.04,
            toneType: 'sine',
            toneFreq: 0,
            toneGain: 0,
            toneDecay: 0.04,
        });
    } else if (surface === 'bubble') {
        noiseTone(parts, {
            filterType: 'bandpass',
            freq: clamp(420 * p, 280, 600),
            q: 1.4,
            noiseGain: v * 0.28,
            noiseDecay: 0.08,
            toneType: 'sine',
            toneFreq: clamp(160 * p, 120, 200),
            toneGain: v * 0.18,
            toneDecay: 0.22,
        });
    } else if (surface === 'bone') {
        noiseTone(parts, {
            filterType: 'lowpass',
            freq: clamp(900 * p, 300, 1600),
            q: 1.0,
            noiseGain: v * 0.4,
            noiseDecay: 0.06,
            toneType: 'triangle',
            toneFreq: clamp(180 * p, 90, 360),
            toneGain: v * 0.22,
            toneDecay: 0.18,
        });
    } else if (surface === 'click') {
        noiseTone(parts, {
            filterType: 'highpass',
            freq: 4200,
            q: 1.4,
            noiseGain: v * 0.22,
            noiseDecay: 0.025,
            toneType: 'sine',
            toneFreq: 0,
            toneGain: 0,
            toneDecay: 0.02,
        });
        metalRing(parts, rng, {
            baseFreq: 900 * p,
            gain: v * 0.06,
            decay: 0.18,
            partials: [1, 2.4],
        });
    } else {
        metalRing(parts, rng, {
            baseFreq: clamp(500 * p, 200, 1100),
            gain: v * 0.3,
            decay: d ?? 0.6,
        });
    }
    return { parts };
}

export function buildFluteNote(freq: number, dur: number, vol: number): VoiceSpec {
    const attack = Math.min(0.05, dur * 0.3);
    const release = Math.min(0.12, dur * 0.5);
    const env = { peak: vol, attack, hold: Math.max(attack, dur - release), end: dur };
    const vibrato = { vibratoRate: 5.5, vibratoDepth: freq * 0.006 };
    return {
        parts: [
            { osc: 'sine', freq, ...vibrato, env },
            { osc: 'triangle', freq: freq * 2, gain: 0.18, ...vibrato, env },
            {
                osc: 'noise',
                filter: { type: 'bandpass', freq: freq * 1.5, q: 0.6 },
                gain: vol * 0.06,
                env,
            },
        ],
    };
}

/** Seconds from voice start until every part has finished. */
export function voiceDuration(spec: VoiceSpec) {
    let d = 0;
    for (const p of spec.parts) d = Math.max(d, (p.delay ?? 0) + p.env.end);
    return d;
}

// ---------------------------------------------------------------------------
// Spatialisation (stereo pan mode) — Web Audio equal-power + inverse distance
// ---------------------------------------------------------------------------

export interface Listener {
    position: Vec3;
    forward: Vec3;
    up: Vec3;
}

export function stereoGains(source: Vec3, listener: Listener): [number, number] {
    const dx = source.x - listener.position.x;
    const dy = source.y - listener.position.y;
    const dz = source.z - listener.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const { refDistance, maxDistance, rolloffFactor } = PANNER_SETTINGS;
    const d = clamp(dist, refDistance, maxDistance);
    const distGain = refDistance / (refDistance + rolloffFactor * (d - refDistance));

    const f = listener.forward;
    const u = listener.up;
    // right = forward × up
    let rx = f.y * u.z - f.z * u.y;
    let ry = f.z * u.x - f.x * u.z;
    let rz = f.x * u.y - f.y * u.x;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;

    let azimuth = 0;
    if (dist > 1e-6) {
        const x = (dx * rx + dy * ry + dz * rz) / dist;
        const fl = Math.hypot(f.x, f.y, f.z) || 1;
        const z = (dx * f.x + dy * f.y + dz * f.z) / (dist * fl);
        azimuth = (Math.atan2(x, z) * 180) / Math.PI;
    }
    // Fold rear sources to the front, as PannerNode's equal-power model does.
    if (azimuth > 90) azimuth = 180 - azimuth;
    else if (azimuth < -90) azimuth = -180 - azimuth;
    const pan = (azimuth + 90) / 180;
    return [Math.cos((pan * Math.PI) / 2) * distGain, Math.sin((pan * Math.PI) / 2) * distGain];
}

// ---------------------------------------------------------------------------
// Biquad (Web Audio spec coefficients: lowpass/highpass Q in dB, bandpass Q linear)
// ---------------------------------------------------------------------------

class Biquad {
    b0 = 1;
    b1 = 0;
    b2 = 0;
    a1 = 0;
    a2 = 0;
    x1 = 0;
    x2 = 0;
    y1 = 0;
    y2 = 0;

    set(type: FilterType, freq: number, q: number, sampleRate: number) {
        const nyquist = sampleRate / 2;
        const f = clamp(freq, 1, nyquist * 0.999);
        const w0 = (TWO_PI * f) / sampleRate;
        const cos = Math.cos(w0);
        const sin = Math.sin(w0);
        let b0: number;
        let b1: number;
        let b2: number;
        let alpha: number;
        if (type === 'bandpass') {
            alpha = sin / (2 * Math.max(q, 1e-4));
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
        } else {
            alpha = sin / (2 * Math.pow(10, q / 20));
            if (type === 'lowpass') {
                b0 = (1 - cos) / 2;
                b1 = 1 - cos;
                b2 = (1 - cos) / 2;
            } else {
                b0 = (1 + cos) / 2;
                b1 = -(1 + cos);
                b2 = (1 + cos) / 2;
            }
        }
        const a0 = 1 + alpha;
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = (-2 * cos) / a0;
        this.a2 = (1 - alpha) / a0;
    }

    process(x: number) {
        const y =
            this.b0 * x +
            this.b1 * this.x1 +
            this.b2 * this.x2 -
            this.a1 * this.y1 -
            this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }
}

// ---------------------------------------------------------------------------
// Runtime voice state
// ---------------------------------------------------------------------------

function oscSample(type: OscType, phase: number, rng: Rng) {
    switch (type) {
        case 'sine':
            return Math.sin(TWO_PI * phase);
        case 'triangle':
            if (phase < 0.25) return 4 * phase;
            if (phase < 0.75) return 2 - 4 * phase;
            return 4 * phase - 4;
        case 'sawtooth':
            return phase < 0.5 ? 2 * phase : 2 * phase - 2;
        default:
            return rng() * 2 - 1;
    }
}

class PartState {
    osc: OscType;
    phase = 0;
    freq: number;
    freqStep: number;
    vibRate: number;
    vibDepth: number;
    vibPhase = 0;
    filter: Biquad | null = null;
    gain: number;
    // Envelope, in samples.
    t = 0;
    delay: number;
    attack: number;
    hold: number;
    end: number;
    peak: number;
    level = 0;
    decayRatio = 1;
    taperLen: number;

    constructor(spec: PartSpec, sampleRate: number) {
        const env = spec.env;
        this.osc = spec.osc;
        const detune = spec.detuneCents ? Math.pow(2, spec.detuneCents / 1200) : 1;
        this.freq = (spec.freq ?? 0) * detune;
        const endSamples = Math.max(1, Math.round(env.end * sampleRate));
        this.freqStep = spec.freqEnd != null ? (spec.freqEnd * detune - this.freq) / endSamples : 0;
        this.vibRate = spec.vibratoRate ?? 0;
        this.vibDepth = spec.vibratoDepth ?? 0;
        this.gain = spec.gain ?? 1;
        this.delay = Math.round((spec.delay ?? 0) * sampleRate);
        this.attack = Math.round(env.attack * sampleRate);
        this.hold = Math.max(this.attack, Math.round(env.hold * sampleRate));
        this.end = Math.max(this.hold + 1, endSamples);
        this.peak = env.peak;
        this.decayRatio = Math.pow(
            FLOOR / Math.max(env.peak, FLOOR * 1.0001),
            1 / (this.end - this.hold)
        );
        this.taperLen = spec.taper ? Math.max(1, Math.round(spec.taper * sampleRate)) : 0;
        if (spec.filter) {
            this.filter = new Biquad();
            this.filter.set(spec.filter.type, spec.filter.freq, spec.filter.q, sampleRate);
        }
    }

    get done() {
        return this.t >= this.delay + this.end;
    }

    next(sampleRate: number, rng: Rng) {
        const t = this.t - this.delay;
        this.t += 1;
        if (t < 0 || t >= this.end) return 0;

        let env: number;
        if (t < this.attack) {
            env = FLOOR + (this.peak - FLOOR) * (t / this.attack);
        } else if (t < this.hold) {
            env = this.peak;
        } else {
            env = t === this.hold ? this.peak : this.level * this.decayRatio;
        }
        this.level = env;

        let s: number;
        if (this.osc === 'noise') {
            s = rng() * 2 - 1;
            if (this.taperLen) s *= Math.max(0, 1 - t / this.taperLen);
        } else {
            s = oscSample(this.osc, this.phase, rng);
            let f = this.freq + this.freqStep * t;
            if (this.vibDepth) {
                f += Math.sin(TWO_PI * this.vibPhase) * this.vibDepth;
                this.vibPhase += this.vibRate / sampleRate;
                if (this.vibPhase >= 1) this.vibPhase -= 1;
            }
            this.phase += f / sampleRate;
            this.phase -= Math.floor(this.phase);
        }
        if (this.filter) s = this.filter.process(s);
        return s * env * this.gain;
    }
}

const STEAL_FADE_SECONDS = 0.004;

class Voice {
    parts: PartState[];
    slot: number;
    gainL: number;
    gainR: number;
    /** Remaining samples of a steal fade-out, or 0 when not fading. */
    fade = 0;
    fadeLen = 0;
    counted: boolean;

    constructor(
        spec: VoiceSpec,
        sampleRate: number,
        slot: number,
        gainL: number,
        gainR: number,
        counted: boolean
    ) {
        this.parts = spec.parts
            .filter((p) => p.env.peak > FLOOR && p.env.end > 0)
            .map((p) => new PartState(p, sampleRate));
        this.slot = slot;
        this.gainL = gainL;
        this.gainR = gainR;
        this.counted = counted;
    }

    get done() {
        if (this.fadeLen && this.fade <= 0) return true;
        for (const p of this.parts) if (!p.done) return false;
        return true;
    }

    beginFade(sampleRate: number) {
        this.fadeLen = Math.max(1, Math.round(STEAL_FADE_SECONDS * sampleRate));
        this.fade = this.fadeLen;
    }

    next(sampleRate: number, rng: Rng) {
        let s = 0;
        for (const p of this.parts) s += p.next(sampleRate, rng);
        if (this.fadeLen) {
            s *= this.fade / this.fadeLen;
            this.fade -= 1;
        }
        return s;
    }
}

interface PendingNote {
    at: number;
    freq: number;
    dur: number;
    vol: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class TavernDspEngine {
    readonly sampleRate: number;
    readonly panMode: PanMode;
    readonly slots: number;
    maxVoices: number;
    energyForMaxVolume: number;

    private rng: Rng;
    private voices: Voice[] = [];
    private ambientVoices: Voice[] = [];
    private melody: PendingNote[] = [];
    private clock = 0;
    private listener: Listener = {
        position: { x: 0, y: 0, z: 0 },
        forward: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
    };

    // Ambient bed
    private ambientOn = false;
    private ambientTarget = 0.5;
    private ambientLevel = 0.5;
    private bedFilter = new Biquad();
    private lfoPhase = 0;
    private nextCrackle = 0;
    private nextCreak = 0;

    private statsData: EngineStats = {
        started: 0,
        dropped: 0,
        stolen: 0,
        active: 0,
        peakActive: 0,
    };
    statsDirty = false;

    constructor(opts: EngineOptions) {
        this.sampleRate = opts.sampleRate;
        this.panMode = opts.panMode ?? 'stereo';
        this.slots = this.panMode === 'hrtf' ? Math.max(1, opts.slots ?? 6) : 0;
        this.maxVoices = Math.max(1, opts.maxVoices ?? 6);
        this.energyForMaxVolume = opts.energyForMaxVolume ?? 50;
        this.rng = createRng(opts.seed);
    }

    get activeVoices() {
        let n = 0;
        for (const v of this.voices) if (v.counted && !v.fadeLen) n++;
        return n;
    }

    stats(): EngineStats {
        return { ...this.statsData, active: this.activeVoices };
    }

    handleMessage(msg: TavernMessage) {
        if (!msg || typeof msg !== 'object') return;
        switch (msg.type) {
            case 'impact': {
                const kind = msg.voice;
                const levels = impactLevels(
                    msg.energy,
                    msg.mass,
                    msg.sides ?? null,
                    this.energyForMaxVolume
                );
                this.start(buildImpactVoice(kind, levels, this.rng), msg.slot, msg.position);
                break;
            }
            case 'prop':
                this.start(
                    buildPropVoice(
                        msg.surface,
                        { volume: msg.volume, pitch: msg.pitch, decay: msg.decay },
                        this.rng
                    ),
                    msg.slot,
                    msg.position
                );
                break;
            case 'melody': {
                const tune =
                    Array.isArray(msg.notes) && msg.notes.length ? msg.notes : DEFAULT_FLUTE_TUNE;
                let t = this.clock + Math.round(0.03 * this.sampleRate);
                for (const note of tune) {
                    const dur = Math.max(0.02, finiteOr(note.d, 0.2));
                    this.melody.push({
                        at: t,
                        freq: finiteOr(note.f, 660),
                        dur,
                        vol: clamp(finiteOr(note.vol, 0.4), 0, 1),
                    });
                    t += Math.round(dur * 0.96 * this.sampleRate);
                }
                break;
            }
            case 'listener':
                if (msg.position && msg.forward && msg.up) {
                    this.listener = { position: msg.position, forward: msg.forward, up: msg.up };
                }
                break;
            case 'ambient':
                if (typeof msg.intensity === 'number' && Number.isFinite(msg.intensity)) {
                    this.ambientTarget = clamp(msg.intensity, 0, 1.5);
                }
                if (msg.on === true && !this.ambientOn) {
                    this.ambientOn = true;
                    this.ambientLevel = this.ambientTarget;
                    this.nextCrackle = this.clock + this.randomDelay(0.2, 1.3);
                    this.nextCreak = this.clock + this.randomDelay(8, 25);
                } else if (msg.on === false) {
                    this.ambientOn = false;
                    this.ambientVoices.length = 0;
                }
                break;
            case 'config':
                if (typeof msg.maxVoices === 'number' && msg.maxVoices >= 1) {
                    this.maxVoices = Math.floor(msg.maxVoices);
                }
                if (typeof msg.energyForMaxVolume === 'number' && msg.energyForMaxVolume > 0) {
                    this.energyForMaxVolume = msg.energyForMaxVolume;
                }
                break;
        }
    }

    /** Start a voice subject to `maxVoices`. Returns false when it was dropped. */
    start(spec: VoiceSpec, slot?: number, position?: Vec3 | null): boolean {
        if (this.activeVoices >= this.maxVoices) {
            this.statsData.dropped += 1;
            this.statsDirty = true;
            return false;
        }
        let voiceSlot = -1;
        let gainL = 1;
        let gainR = 1;
        if (position && this.panMode === 'stereo') {
            [gainL, gainR] = stereoGains(position, this.listener);
        } else if (
            this.panMode === 'hrtf' &&
            typeof slot === 'number' &&
            slot >= 0 &&
            slot < this.slots
        ) {
            voiceSlot = slot;
            // The façade re-aimed this slot's panner; a tail still ringing there
            // would jump position, so fade it out quickly.
            for (const v of this.voices) {
                if (v.slot === voiceSlot && !v.fadeLen) {
                    v.beginFade(this.sampleRate);
                    this.statsData.stolen += 1;
                }
            }
        }
        this.voices.push(new Voice(spec, this.sampleRate, voiceSlot, gainL, gainR, true));
        this.statsData.started += 1;
        this.statsData.peakActive = Math.max(this.statsData.peakActive, this.activeVoices);
        this.statsDirty = true;
        return true;
    }

    private randomDelay(minSec: number, maxSec: number) {
        return Math.round((minSec + this.rng() * (maxSec - minSec)) * this.sampleRate);
    }

    private spawnCrackle() {
        const pops = 1 + Math.floor(this.rng() * 3);
        let offset = 0;
        const parts: PartSpec[] = [];
        for (let i = 0; i < pops; i++) {
            parts.push({
                osc: 'noise',
                delay: offset,
                taper: 0.03,
                filter: { type: 'bandpass', freq: 700 + this.rng() * 1800, q: 2 + this.rng() * 3 },
                env: {
                    peak: (0.015 + this.rng() * 0.03) * this.ambientTarget,
                    attack: 0,
                    hold: 0,
                    end: 0.04,
                },
            });
            offset += 0.02 + this.rng() * 0.05;
        }
        this.ambientVoices.push(new Voice({ parts }, this.sampleRate, -1, 1, 1, false));
    }

    private spawnCreak() {
        const dur = 0.5 + this.rng() * 0.8;
        const f0 = 90 + this.rng() * 60;
        this.ambientVoices.push(
            new Voice(
                {
                    parts: [
                        {
                            osc: 'sawtooth',
                            freq: f0,
                            freqEnd: f0 * (1.1 + this.rng() * 0.3),
                            filter: { type: 'lowpass', freq: 280, q: 0 },
                            env: {
                                peak: 0.03 * this.ambientTarget,
                                attack: dur * 0.4,
                                hold: dur * 0.4,
                                end: dur,
                            },
                        },
                    ],
                },
                this.sampleRate,
                -1,
                1,
                1,
                false
            )
        );
    }

    /**
     * Render one block. `outputs[o][ch]` — see the module header for the layout.
     * Buffers are overwritten (zeroed first), so the caller need not clear them.
     */
    render(outputs: Float32Array[][]) {
        const direct = outputs[0];
        const L = direct?.[0];
        if (!L) return;
        const R = direct[1] ?? null;
        const frames = L.length;
        for (const out of outputs) for (const ch of out) ch.fill(0);

        const sr = this.sampleRate;
        const rng = this.rng;

        // Melody notes whose start time falls in this block.
        if (this.melody.length) {
            const blockEnd = this.clock + frames;
            const due = this.melody.filter((n) => n.at < blockEnd);
            if (due.length) {
                this.melody = this.melody.filter((n) => n.at >= blockEnd);
                for (const n of due) {
                    const spec = buildFluteNote(n.freq, n.dur, n.vol);
                    const offset = Math.max(0, n.at - this.clock) / sr;
                    for (const p of spec.parts) p.delay = offset;
                    this.start(spec);
                }
            }
        }

        // Ambient bed: lowpass-filtered noise with a slow cutoff LFO.
        if (this.ambientOn) {
            // setTargetAtTime(…, 0.8) equivalent, applied per block.
            this.ambientLevel +=
                (this.ambientTarget - this.ambientLevel) * (1 - Math.exp(-frames / (0.8 * sr)));
            const cutoff = 320 + 140 * Math.sin(TWO_PI * this.lfoPhase);
            this.lfoPhase = (this.lfoPhase + (0.06 * frames) / sr) % 1;
            this.bedFilter.set('lowpass', cutoff, 0.5, sr);
            const bedGain = 0.04 * this.ambientLevel;
            for (let i = 0; i < frames; i++) {
                const s = this.bedFilter.process(rng() * 2 - 1) * bedGain;
                L[i]! += s;
                if (R) R[i]! += s;
            }
            if (this.clock >= this.nextCrackle) {
                this.spawnCrackle();
                this.nextCrackle = this.clock + this.randomDelay(0.2, 1.3);
            }
            if (this.clock >= this.nextCreak) {
                this.spawnCreak();
                this.nextCreak = this.clock + this.randomDelay(8, 25);
            }
            const busGain = 0.04 * this.ambientLevel;
            for (const v of this.ambientVoices) {
                for (let i = 0; i < frames; i++) {
                    const s = v.next(sr, rng) * busGain;
                    L[i]! += s;
                    if (R) R[i]! += s;
                }
            }
            this.ambientVoices = this.ambientVoices.filter((v) => !v.done);
        }

        for (const v of this.voices) {
            const slotOut = v.slot >= 0 ? outputs[1 + v.slot]?.[0] : null;
            if (slotOut) {
                for (let i = 0; i < frames; i++) slotOut[i]! += v.next(sr, rng);
            } else {
                const gl = v.gainL;
                const gr = v.gainR;
                for (let i = 0; i < frames; i++) {
                    const s = v.next(sr, rng);
                    L[i]! += s * gl;
                    if (R) R[i]! += s * gr;
                }
            }
        }
        const before = this.voices.length;
        this.voices = this.voices.filter((v) => !v.done);
        if (this.voices.length !== before) this.statsDirty = true;

        this.clock += frames;
    }
}
