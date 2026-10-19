import { describe, expect, it } from 'vitest';
import {
    DIE_PHYSICS_PRESETS,
    defaultHeadlessAssets,
    defaultPublicDir,
    fsAssetSource,
    parseNotation,
    rollHeadless,
} from 'dice-core';
import { presetForShape } from 'dice-core/wasm/physicsPresets';
import { describeWasm } from './wasmGate.js';

describe('core-engine public API', () => {
    it('exposes physics presets without Three.js', () => {
        expect(DIE_PHYSICS_PRESETS.d20.mass).toBe(5);
        expect(parseNotation('3d6+2').modifier).toBe(2);
        expect(presetForShape('toString')).toEqual(DIE_PHYSICS_PRESETS.d6);
        expect(presetForShape('d20')).toEqual(DIE_PHYSICS_PRESETS.d20);
    });

    it('defaults to a filesystem asset source rooted at the repo public/ in Node', () => {
        expect(defaultPublicDir()).toMatch(/[\\/]public[\\/]?$/);
        expect(defaultHeadlessAssets().fetchable).toBe(false);
        expect(defaultHeadlessAssets().url('wasm/hulls.json')).toMatch(
            /^file:.*\/public\/wasm\/hulls\.json$/
        );
    });
});

describeWasm('rollHeadless', () => {
    it('same seed yields bit-identical solver face values', async () => {
        const a = await rollHeadless('1d6', 42);
        const b = await rollHeadless('1d6', 42);
        expect(a.trace.faceValues).toEqual(b.trace.faceValues);
        expect(a.results.map((r) => r.value)).toEqual(b.results.map((r) => r.value));
        expect(a.results[0]?.naturalValue).toBeGreaterThan(0);
    });

    it('4d6 @ 777 loads hulls and reads four real faces, with no warnings', async () => {
        const warnings: unknown[][] = [];
        const original = { warn: console.warn, log: console.log };
        console.warn = (...args: unknown[]) => void warnings.push(args);
        console.log = (...args: unknown[]) => void warnings.push(args);
        try {
            const r = await rollHeadless('4d6', 777);
            expect(r.results).toHaveLength(4);
            expect(r.results.every((d) => d.naturalValue >= 1 && d.naturalValue <= 6)).toBe(true);
            expect(r.results.map((d) => d.wasmId)).toEqual([0, 1, 2, 3]);
            expect(r.trace.faceValues).toEqual(r.results.map((d) => d.naturalValue));
            expect(r.trace.solverBuildId).toMatch(/^\d+:[0-9a-f]{12}$/);
        } finally {
            console.warn = original.warn;
            console.log = original.log;
        }
        expect(warnings).toEqual([]);
    });

    it('settles a pair of d20s (once: "did not settle within 2400 steps")', async () => {
        const r = await rollHeadless('2d20', 5);
        expect(r.results.map((d) => d.naturalValue).every((v) => v >= 1 && v <= 20)).toBe(true);
    });

    it('a reroll keeps the dice it did not reroll', async () => {
        const r = await rollHeadless('4d6r1', 29);
        const replaced = r.evaluated.dice.filter((d) => d.replacedByReroll);
        const live = r.evaluated.dice.filter((d) => !d.replacedByReroll);
        expect(live).toHaveLength(4);
        expect(r.evaluated.dice).toHaveLength(4 + replaced.length);
    });

    it('fails loudly without hulls.json instead of rolling spheres', async () => {
        const real = fsAssetSource(defaultPublicDir()!);
        const noHulls = {
            ...real,
            url: real.url,
            bytes: real.bytes,
            json: async <T>(p: string): Promise<T> => {
                if (p.endsWith('hulls.json')) throw new Error(`no ${p}`);
                return real.json<T>(p);
            },
        };
        await expect(rollHeadless('1d20', 1, null, { assets: noHulls })).rejects.toThrow(
            /hulls\.json/
        );
    });
});
