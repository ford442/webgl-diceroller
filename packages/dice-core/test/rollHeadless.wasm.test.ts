import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    DIE_PHYSICS_PRESETS,
    fsAssetSource,
    parseNotation,
    rollHeadless,
    type AssetSource,
} from 'dice-core/node';
import { presetForShape } from 'dice-core/wasm/physicsPresets';
import { WASM_SCALAR_DIR, WASM_SIMD_DIR } from 'dice-core/wasm/wasmArtifact';

describe('dice-core public API', () => {
    it('exposes physics presets without Three.js', () => {
        expect(DIE_PHYSICS_PRESETS.d20.mass).toBe(5);
        expect(parseNotation('3d6+2').modifier).toBe(2);
        expect(presetForShape('toString')).toEqual(DIE_PHYSICS_PRESETS.d6);
        expect(presetForShape('d20')).toEqual(DIE_PHYSICS_PRESETS.d20);
    });
});

describe('rollHeadless', () => {
    it('same seed yields bit-identical solver face values', async () => {
        const a = await rollHeadless('1d6', 42);
        const b = await rollHeadless('1d6', 42);
        expect(a.trace.faceValues).toEqual(b.trace.faceValues);
        expect(a.trace.fixedTicks).toBe(b.trace.fixedTicks);
        expect(a.results.map((r) => r.value)).toEqual(b.results.map((r) => r.value));
        expect(a.results[0]?.naturalValue).toBeGreaterThan(0);
    });

    it('reads a face for every die of a mixed pool, not just the first', async () => {
        const r = await rollHeadless('4d6+1d4+1d8+1d10+1d12+1d20', 777);
        expect(r.results).toHaveLength(9);
        for (const die of r.results) {
            const sides = Number(die.type.slice(1));
            expect(die.naturalValue, die.type).toBeGreaterThanOrEqual(1);
            expect(die.naturalValue, die.type).toBeLessThanOrEqual(sides);
        }
        expect(r.trace.faceValues).toEqual(r.results.map((d) => d.naturalValue));
        // Engine ids, one body per die.
        expect(new Set(r.results.map((d) => d.wasmId)).size).toBe(9);
        expect(r.trace.solverBuildId).toMatch(/^\d+:[0-9a-f]+$/);
    });

    it('reports real engine ids and every round for exploding dice', async () => {
        // Seed 11 explodes at least one 6; engine ids keep growing across rounds.
        const r = await rollHeadless('6d6!', 11);
        expect(r.trace.rounds).toBeGreaterThan(1);
        expect(r.results.length).toBeGreaterThan(6);
        expect(r.results.every((d) => d.naturalValue >= 1)).toBe(true);
        expect(Math.max(...r.results.map((d) => d.wasmId))).toBeGreaterThanOrEqual(6);
    });

    it('reports the opposed side', async () => {
        const r = await rollHeadless('1d20 vs 1d20', 9);
        expect(r.trace.faceValues).toHaveLength(1);
        expect(r.trace.opposedFaceValues).toHaveLength(1);
        expect(r.trace.opposedFaceValues![0]).toBeGreaterThanOrEqual(1);
    });

    it('SIMD and scalar builds settle to the same faces and tick count', async () => {
        const simd = await rollHeadless('3d8+2d10', 99, null, { preferredDir: WASM_SIMD_DIR });
        const scalar = await rollHeadless('3d8+2d10', 99, null, {
            preferredDir: WASM_SCALAR_DIR,
        });
        expect(scalar.trace.faceValues).toEqual(simd.trace.faceValues);
        expect(scalar.trace.fixedTicks).toBe(simd.trace.fixedTicks);
    });

    it('throws instead of rolling spheres when hulls.json is missing', async () => {
        const disk = fsAssetSource();
        const assets: AssetSource = {
            ...disk,
            json: (rel) =>
                rel === 'wasm/hulls.json'
                    ? Promise.reject(new Error('ENOENT hulls.json'))
                    : disk.json(rel),
        };
        await expect(rollHeadless('1d20', 1, null, { assets })).rejects.toThrow(/hulls\.json/);
    });

    it('throws when no engine build exists', async () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'dice-core-empty-'));
        try {
            await expect(rollHeadless('1d6', 1, null, { publicDir: dir })).rejects.toThrow(
                /npm run build:wasm/
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
