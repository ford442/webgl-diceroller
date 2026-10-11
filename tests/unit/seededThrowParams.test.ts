/**
 * Additional edge-case coverage for src/core-engine/wasm/seededThrowParams.ts.
 * tests/unit/share-roll.test.js already covers determinism for a fixed seed
 * via computeSeededThrowParams; these tests cover createSeededRng behavior,
 * per-die output shape, and applyThrowParams engine wiring.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    applyThrowParams,
    computeSeededThrowParams,
    createSeededRng,
} from '../../src/core-engine/wasm/seededThrowParams.js';

describe('createSeededRng', () => {
    it('matches the engine PRNG golden sequence bit for bit', () => {
        // Same seed and outputs as "PRNG golden sequence" in solver_tests.cpp:
        // next() = 0xB7FB0288C5EE4339, 0x42FEF730E71E2254, 0x835D6BA41BA14966,
        // and nextFloat() takes the high 32 bits through a float32.
        const rand = createSeededRng(0x123456789abcdef0n);
        const expected = [0xb7fb0288, 0x42fef730, 0x835d6ba4].map(
            (hi) => Math.fround(hi) / 4294967296
        );
        expect([rand(), rand(), rand()]).toEqual(expected);
        expect(rand()).toBeCloseTo(0.087864459, 6);
    });

    it('produces values in [0, 1) across many calls', () => {
        const rand = createSeededRng(12345);
        for (let i = 0; i < 1000; i++) {
            const v = rand();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('different seeds produce different sequences', () => {
        const a = createSeededRng(1);
        const b = createSeededRng(2);
        const seqA = Array.from({ length: 5 }, () => a());
        const seqB = Array.from({ length: 5 }, () => b());
        expect(seqA).not.toEqual(seqB);
    });

    it('seed 0 falls back to the default RNG state rather than a degenerate stream', () => {
        const zero = createSeededRng(0);
        const seqZero = Array.from({ length: 20 }, () => zero());
        // Not constant / not all zero.
        expect(new Set(seqZero).size).toBeGreaterThan(1);
        expect(seqZero.some((v) => v !== 0)).toBe(true);

        const other = createSeededRng(999);
        const seqOther = Array.from({ length: 20 }, () => other());
        expect(seqZero).not.toEqual(seqOther);
    });
});

describe('computeSeededThrowParams', () => {
    it('output length matches dice.length and ids match input ids (not index)', () => {
        const dice = [
            { id: 100, index: 0 },
            { id: 200, index: 1 },
            { id: 300, index: 2 },
        ];
        const params = computeSeededThrowParams(createSeededRng(1), dice, 0);
        expect(params).toHaveLength(3);
        expect(params.map((p) => p.id)).toEqual([100, 200, 300]);
    });

    it('y increases with index per fixed tableSurfaceY (per-die stacking offset)', () => {
        const dice = [
            { id: 1, index: 0 },
            { id: 2, index: 1 },
            { id: 3, index: 2 },
        ];
        const tableSurfaceY = 2.5;
        const params = computeSeededThrowParams(createSeededRng(1), dice, tableSurfaceY);
        expect(params[0].y).toBeCloseTo(tableSurfaceY + 6.75 + 0 * 0.5, 10);
        expect(params[1].y).toBeCloseTo(tableSurfaceY + 6.75 + 1 * 0.5, 10);
        expect(params[2].y).toBeCloseTo(tableSurfaceY + 6.75 + 2 * 0.5, 10);
    });

    it('returns a unit quaternion for each die', () => {
        const dice = [
            { id: 1, index: 0 },
            { id: 2, index: 1 },
        ];
        const params = computeSeededThrowParams(createSeededRng(7), dice, 0);
        for (const p of params) {
            const mag = Math.sqrt(p.qx * p.qx + p.qy * p.qy + p.qz * p.qz + p.qw * p.qw);
            expect(mag).toBeCloseTo(1, 10);
        }
    });

    it('different seeds produce different throw params for the same dice input', () => {
        const dice = [{ id: 1, index: 0 }];
        const a = computeSeededThrowParams(createSeededRng(1), dice, 0);
        const b = computeSeededThrowParams(createSeededRng(2), dice, 0);
        expect(a).not.toEqual(b);
    });
});

describe('applyThrowParams', () => {
    it('calls setDieTransform, setDieVelocity, applyImpulse, applyTorqueImpulse per die in order', () => {
        const callOrder: string[] = [];
        const engine = {
            setDieTransform: (...args: unknown[]) => callOrder.push(`setDieTransform:${args[0]}`),
            setDieVelocity: (...args: unknown[]) => callOrder.push(`setDieVelocity:${args[0]}`),
            applyImpulse: (...args: unknown[]) => callOrder.push(`applyImpulse:${args[0]}`),
            applyTorqueImpulse: (...args: unknown[]) =>
                callOrder.push(`applyTorqueImpulse:${args[0]}`),
        };

        const params = computeSeededThrowParams(
            createSeededRng(1),
            [
                { id: 10, index: 0 },
                { id: 20, index: 1 },
            ],
            0
        );

        applyThrowParams(engine as any, params);

        expect(callOrder).toEqual([
            'setDieTransform:10',
            'setDieVelocity:10',
            'applyImpulse:10',
            'applyTorqueImpulse:10',
            'setDieTransform:20',
            'setDieVelocity:20',
            'applyImpulse:20',
            'applyTorqueImpulse:20',
        ]);
    });

    it('calls each engine method with the right args', () => {
        const setDieTransform = vi.fn();
        const setDieVelocity = vi.fn();
        const applyImpulse = vi.fn();
        const applyTorqueImpulse = vi.fn();
        const engine = { setDieTransform, setDieVelocity, applyImpulse, applyTorqueImpulse };

        const params = computeSeededThrowParams(createSeededRng(1), [{ id: 5, index: 0 }], 0);
        const p = params[0];

        applyThrowParams(engine as any, params);

        expect(setDieTransform).toHaveBeenCalledWith(5, p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw);
        expect(setDieVelocity).toHaveBeenCalledWith(5, 0, 0, 0, 0, 0, 0);
        expect(applyImpulse).toHaveBeenCalledWith(5, p.forceX, p.forceY, p.forceZ);
        expect(applyTorqueImpulse).toHaveBeenCalledWith(5, p.spinX, p.spinY, p.spinZ);
    });
});
