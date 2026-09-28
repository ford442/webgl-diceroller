import { describe, expect, it, vi } from 'vitest';
import {
    TavernDspEngine,
    buildImpactVoice,
    buildPropVoice,
    createRng,
    impactLevels,
    stereoGains,
    voiceDuration,
    type ImpactVoiceKind,
} from '../../src/audio/worklet/tavernDsp';
import { VOICE_HOLD_SECONDS } from '../../src/audio/worklet/protocol';
import { generateRoomImpulse } from '../../src/audio/roomImpulse';

const SR = 48000;

function block(outputs = 1, frames = 128) {
    return Array.from({ length: outputs }, (_, i) =>
        i === 0 ? [new Float32Array(frames), new Float32Array(frames)] : [new Float32Array(frames)]
    );
}

function renderSeconds(engine: TavernDspEngine, seconds: number, outputs = 1) {
    const out = block(outputs);
    let peak = 0;
    let energy = 0;
    for (let n = 0; n < Math.ceil((seconds * SR) / 128); n++) {
        engine.render(out);
        for (const o of out)
            for (const ch of o)
                for (const s of ch) {
                    peak = Math.max(peak, Math.abs(s));
                    energy += s * s;
                }
    }
    return { peak, energy };
}

function rms(a: Float32Array, from: number, to: number) {
    let sum = 0;
    for (let i = from; i < to; i++) sum += a[i] * a[i];
    return Math.sqrt(sum / (to - from));
}

describe('impactLevels (energy → gain mapping)', () => {
    it('is linear in kinetic energy up to energyForMaxVolume', () => {
        expect(impactLevels(25).volume).toBeCloseTo(0.5);
        expect(impactLevels(50).volume).toBe(1);
        expect(impactLevels(500).volume).toBe(1);
        expect(impactLevels(25, 5, null, 100).volume).toBeCloseTo(0.25);
    });

    it('floors quiet impacts so they are still audible', () => {
        expect(impactLevels(0).volume).toBe(0.04);
        expect(impactLevels(Number.NaN).volume).toBe(0.04);
    });

    it('maps brightness bias, mass bias and die size', () => {
        expect(impactLevels(100).impactBias).toBeCloseTo(0.5);
        expect(impactLevels(1000).impactBias).toBe(1);
        expect(impactLevels(10, 15).massBias).toBeCloseTo(0.25);
        expect(impactLevels(10, 0).massBias).toBeCloseTo(-0.15);
        // d20 lower than d4.
        expect(impactLevels(10, 5, 20).sidesPitch).toBeLessThan(impactLevels(10, 5, 4).sidesPitch);
        expect(impactLevels(10, 5, null).sidesPitch).toBe(1);
    });

    it('produces louder output for more energy', () => {
        const loud = new TavernDspEngine({ sampleRate: SR, seed: 1 });
        const soft = new TavernDspEngine({ sampleRate: SR, seed: 1 });
        loud.handleMessage({ type: 'impact', voice: 'clack', energy: 50 });
        soft.handleMessage({ type: 'impact', voice: 'clack', energy: 5 });
        const a = renderSeconds(loud, 0.2);
        const b = renderSeconds(soft, 0.2);
        expect(a.energy).toBeGreaterThan(b.energy * 20);
    });
});

describe('voice recipes', () => {
    const kinds: ImpactVoiceKind[] = ['clack', 'velvet', 'wood', 'leather', 'glass', 'metal'];

    it.each(kinds)('%s rings no longer than its advertised hold time', (kind) => {
        const spec = buildImpactVoice(kind, impactLevels(1000, 10, 4), createRng(3));
        expect(spec.parts.length).toBeGreaterThan(0);
        expect(voiceDuration(spec)).toBeLessThanOrEqual(VOICE_HOLD_SECONDS[kind]);
    });

    it.each(['gong', 'bell', 'bubble', 'bone', 'click'])(
        '%s prop fits its hold time',
        (surface) => {
            const spec = buildPropVoice(surface, { volume: 1, pitch: 1 }, createRng(3));
            expect(voiceDuration(spec)).toBeLessThanOrEqual(VOICE_HOLD_SECONDS[surface]);
        }
    );

    it('renders finite, bounded audio for every voice', () => {
        for (const kind of kinds) {
            const engine = new TavernDspEngine({ sampleRate: SR, seed: 9 });
            engine.handleMessage({ type: 'impact', voice: kind, energy: 400, sides: 20 });
            const { peak } = renderSeconds(engine, 1);
            expect(Number.isFinite(peak)).toBe(true);
            expect(peak).toBeGreaterThan(0.001);
            expect(peak).toBeLessThan(2);
        }
    });

    it('is deterministic for a given seed', () => {
        const a = new TavernDspEngine({ sampleRate: SR, seed: 42 });
        const b = new TavernDspEngine({ sampleRate: SR, seed: 42 });
        a.handleMessage({ type: 'prop', surface: 'gong' });
        b.handleMessage({ type: 'prop', surface: 'gong' });
        expect(renderSeconds(a, 0.5).energy).toBe(renderSeconds(b, 0.5).energy);
    });

    it('voices end and free their budget', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, seed: 1 });
        engine.handleMessage({ type: 'impact', voice: 'velvet', energy: 20 });
        expect(engine.activeVoices).toBe(1);
        renderSeconds(engine, 0.3);
        expect(engine.activeVoices).toBe(0);
    });
});

describe('voice allocator', () => {
    it('enforces maxVoices under a 20-die dump', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, maxVoices: 6, seed: 1 });
        for (let i = 0; i < 20; i++) {
            engine.handleMessage({ type: 'impact', voice: 'clack', energy: 30 + i, sides: 6 });
        }
        const stats = engine.stats();
        expect(stats.active).toBe(6);
        expect(stats.started).toBe(6);
        expect(stats.dropped).toBe(14);
        expect(stats.peakActive).toBeLessThanOrEqual(6);
    });

    it('applies a lowered cap from a config message', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, maxVoices: 6, seed: 1 });
        engine.handleMessage({ type: 'config', maxVoices: 4 });
        for (let i = 0; i < 10; i++)
            engine.handleMessage({ type: 'impact', voice: 'wood', energy: 10 });
        expect(engine.stats().active).toBe(4);
    });

    it('never exceeds the cap across a sustained cascade', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, maxVoices: 6, seed: 1 });
        const out = block();
        for (let n = 0; n < 400; n++) {
            for (let k = 0; k < 3; k++) {
                engine.handleMessage({ type: 'impact', voice: 'clack', energy: 20 });
            }
            engine.render(out);
            expect(engine.activeVoices).toBeLessThanOrEqual(6);
        }
        expect(engine.stats().peakActive).toBe(6);
    });

    it('routes hrtf slots to their own mono outputs and fades a stolen tail', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, panMode: 'hrtf', slots: 2, seed: 1 });
        const pos = { x: 1, y: 0, z: 0 };
        engine.handleMessage({ type: 'prop', surface: 'bell', slot: 1, position: pos });
        const out = block(3);
        engine.render(out);
        expect(rms(out[2][0], 0, 128)).toBeGreaterThan(0);
        expect(rms(out[1][0], 0, 128)).toBe(0);
        expect(rms(out[0][0], 0, 128)).toBe(0);

        engine.handleMessage({ type: 'prop', surface: 'bell', slot: 1, position: pos });
        expect(engine.stats().stolen).toBe(1);
        expect(engine.activeVoices).toBe(1);
    });

    it('spaces melody notes over time and counts them against the cap', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, seed: 1 });
        engine.handleMessage({ type: 'melody' });
        expect(engine.stats().started).toBe(0);
        renderSeconds(engine, 0.1);
        expect(engine.stats().started).toBe(1);
        renderSeconds(engine, 2);
        expect(engine.stats().started).toBe(7);
        expect(engine.stats().peakActive).toBeLessThanOrEqual(2);
    });
});

describe('stereo pan law', () => {
    const listener = {
        position: { x: 0, y: 0, z: 0 },
        forward: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
    };

    it('pans right/left/centre with equal power', () => {
        const [lr, rr] = stereoGains({ x: 1, y: 0, z: 0 }, listener);
        expect(rr).toBeCloseTo(1);
        expect(lr).toBeCloseTo(0);
        const [ll, rl] = stereoGains({ x: -1, y: 0, z: 0 }, listener);
        expect(ll).toBeCloseTo(1);
        expect(rl).toBeCloseTo(0);
        const [lc, rc] = stereoGains({ x: 0, y: 0, z: -1 }, listener);
        expect(lc).toBeCloseTo(Math.SQRT1_2);
        expect(rc).toBeCloseTo(Math.SQRT1_2);
    });

    it('rolls off with inverse distance past refDistance', () => {
        const near = stereoGains({ x: 0, y: 0, z: -1 }, listener);
        const far = stereoGains({ x: 0, y: 0, z: -10 }, listener);
        expect(far[0]).toBeLessThan(near[0] * 0.3);
        // Beyond maxDistance the gain stops falling.
        expect(stereoGains({ x: 0, y: 0, z: -40 }, listener)[0]).toBeCloseTo(
            stereoGains({ x: 0, y: 0, z: -22 }, listener)[0]
        );
    });

    it('follows listener messages in stereo mode', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, panMode: 'stereo', seed: 1 });
        // Turn the listener around: a source at +x is now on the left.
        engine.handleMessage({
            type: 'listener',
            position: { x: 0, y: 0, z: 0 },
            forward: { x: 0, y: 0, z: 1 },
            up: { x: 0, y: 1, z: 0 },
        });
        engine.handleMessage({ type: 'prop', surface: 'bell', position: { x: 1, y: 0, z: 0 } });
        const out = block();
        engine.render(out);
        expect(rms(out[0][0], 0, 128)).toBeGreaterThan(rms(out[0][1], 0, 128) * 10);
    });
});

describe('ambient bed', () => {
    it('is silent until started and bypasses the voice cap', () => {
        const engine = new TavernDspEngine({ sampleRate: SR, seed: 1, maxVoices: 1 });
        expect(renderSeconds(engine, 0.1).peak).toBe(0);
        engine.handleMessage({ type: 'ambient', on: true, intensity: 1 });
        const { peak } = renderSeconds(engine, 2);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThan(0.2);
        expect(engine.activeVoices).toBe(0);
        engine.handleMessage({ type: 'impact', voice: 'clack', energy: 20 });
        expect(engine.activeVoices).toBe(1);
    });
});

describe('generateRoomImpulse', () => {
    it('builds a decaying, finite stereo tail of the requested length', () => {
        const [l, r] = generateRoomImpulse(SR, { seconds: 0.6 });
        expect(l.length).toBe(Math.floor(SR * 0.6));
        expect(r.length).toBe(l.length);
        const n = l.length;
        const head = rms(l, 0, n / 10);
        const tail = rms(l, n - n / 10, n);
        expect(tail).toBeLessThan(head * 0.05);
        expect(l.every(Number.isFinite)).toBe(true);
        expect(l).not.toEqual(r);
    });

    it('is deterministic per seed', () => {
        expect(generateRoomImpulse(SR, { seed: 5 })[0]).toEqual(
            generateRoomImpulse(SR, { seed: 5 })[0]
        );
    });
});

describe('TavernProcessor (mocked AudioWorkletGlobalScope)', () => {
    it('registers, renders and reports stats over its port', async () => {
        const registered: Record<string, any> = {};
        class MockProcessor {
            port = { onmessage: null as any, postMessage: vi.fn() };
        }
        const g = globalThis as any;
        g.AudioWorkletProcessor = MockProcessor;
        g.registerProcessor = (name: string, ctor: any) => (registered[name] = ctor);
        g.sampleRate = SR;
        try {
            vi.resetModules();
            await import('../../src/audio/worklet/TavernProcessor');
            const Ctor = registered['tavern-processor'];
            expect(Ctor).toBeTypeOf('function');

            const proc = new Ctor({
                processorOptions: { panMode: 'stereo', maxVoices: 3, seed: 1 },
            });
            for (let i = 0; i < 5; i++) {
                proc.port.onmessage({ data: { type: 'impact', voice: 'metal', energy: 80 } });
            }
            const out = block();
            let alive = true;
            for (let n = 0; n < 200; n++) alive = proc.process([], out) && alive;
            expect(alive).toBe(true);

            const statsMsgs = proc.port.postMessage.mock.calls.map((c: any[]) => c[0]);
            expect(statsMsgs[0]).toMatchObject({
                type: 'stats',
                stats: { started: 3, dropped: 2 },
            });
        } finally {
            delete g.AudioWorkletProcessor;
            delete g.registerProcessor;
            delete g.sampleRate;
        }
    });
});
