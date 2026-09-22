/**
 * Flicker has to be reproducible: a `?debug` screenshot, a render-regression
 * baseline and a replayed table all light the same scene at the same
 * timestamp, and used to disagree because the flame drew from `Math.random()`.
 */
import { describe, expect, it } from 'vitest';
import {
    createCandleFlickerSystem,
    createFireplaceFlickerSystem,
    flickerNoise,
} from '../../src/core/LightingSystems.js';

function fakePointLight() {
    return {
        intensity: 0,
        position: {
            x: 0,
            y: 0,
            z: 0,
            set(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            },
        },
    };
}

const FLAME = { x: 1, y: 2, z: 3 };

describe('flickerNoise', () => {
    it('is a pure function of time and channel', () => {
        expect(flickerNoise(1.234, 0)).toBe(flickerNoise(1.234, 0));
        expect(flickerNoise(1.234, 0)).not.toBe(flickerNoise(1.234, 1));
    });

    it('stays in [0, 1) and actually varies over time', () => {
        const samples = [];
        for (let i = 0; i < 400; i++) {
            const v = flickerNoise(i * 0.013, 2);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            samples.push(v);
        }
        expect(new Set(samples).size).toBeGreaterThan(300);
        // Not a ramp or a constant — it should cover most of the range.
        expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
    });

    it('is continuous between samples', () => {
        // Smoothstep-interpolated value noise: neighbouring frames must not
        // jump, or the flame strobes instead of flickering.
        let maxJump = 0;
        for (let i = 1; i < 600; i++) {
            const a = flickerNoise(i / 120, 0);
            const b = flickerNoise((i - 1) / 120, 0);
            maxJump = Math.max(maxJump, Math.abs(a - b));
        }
        expect(maxJump).toBeLessThan(0.35);
    });
});

describe('candle flicker', () => {
    it('lights two runs of the same moment identically', () => {
        const a = fakePointLight();
        const b = fakePointLight();
        createCandleFlickerSystem(a, () => FLAME)({ time: 7.5 });
        createCandleFlickerSystem(b, () => FLAME)({ time: 7.5 });
        expect(a.intensity).toBe(b.intensity);
        expect([a.position.x, a.position.y, a.position.z]).toEqual([
            b.position.x,
            b.position.y,
            b.position.z,
        ]);
    });

    it('moves at all while unfrozen', () => {
        const light = fakePointLight();
        const system = createCandleFlickerSystem(light, () => FLAME);
        system({ time: 1.0 });
        const first = light.intensity;
        system({ time: 2.0 });
        expect(light.intensity).not.toBe(first);
    });

    it('freezes under ?test so a capture never races the flame', () => {
        const light = fakePointLight();
        const system = createCandleFlickerSystem(light, () => FLAME, { frozen: true });
        system({ time: 0.1 });
        const snapshot = { i: light.intensity, x: light.position.x, y: light.position.y };
        system({ time: 93.7 });
        expect(light.intensity).toBe(snapshot.i);
        expect(light.position.x).toBe(snapshot.x);
        expect(light.position.y).toBe(snapshot.y);
    });

    it('does nothing without a flame position', () => {
        const light = fakePointLight();
        createCandleFlickerSystem(light, () => undefined)({ time: 1 });
        expect(light.intensity).toBe(0);
    });
});

describe('fireplace flicker', () => {
    it('is deterministic and frozen under ?test', () => {
        const live = { intensity: 0 };
        const liveSystem = createFireplaceFlickerSystem(() => live);
        liveSystem({ time: 3.25 });
        const first = live.intensity;
        liveSystem({ time: 3.25 });
        expect(live.intensity).toBe(first);
        liveSystem({ time: 4.25 });
        expect(live.intensity).not.toBe(first);

        const frozen = { intensity: 0 };
        const frozenSystem = createFireplaceFlickerSystem(() => frozen, { frozen: true });
        frozenSystem({ time: 0 });
        const held = frozen.intensity;
        frozenSystem({ time: 120 });
        expect(frozen.intensity).toBe(held);
    });
});
