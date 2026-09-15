import { describe, expect, it } from 'vitest';
import {
    DIE_PHYSICS_PRESETS,
    parseNotation,
    rollHeadless,
    wasmArtifactsPresent,
} from '../../src/core-engine/index.js';
import { presetForShape } from '../../src/core-engine/wasm/physicsPresets.js';

describe('core-engine public API', () => {
    it('exposes physics presets without Three.js', () => {
        expect(DIE_PHYSICS_PRESETS.d20.mass).toBe(5);
        expect(parseNotation('3d6+2').modifier).toBe(2);
        expect(presetForShape('toString')).toEqual(DIE_PHYSICS_PRESETS.d6);
        expect(presetForShape('d20')).toEqual(DIE_PHYSICS_PRESETS.d20);
    });
});

describe('rollHeadless', () => {
    const hasWasm = wasmArtifactsPresent();

    it('reports whether public/wasm artifacts exist', () => {
        expect(typeof hasWasm).toBe('boolean');
    });

    it.skipIf(!hasWasm)('same seed yields bit-identical solver face values', async () => {
        const a = await rollHeadless('1d6', 42);
        const b = await rollHeadless('1d6', 42);
        expect(a.trace.faceValues).toEqual(b.trace.faceValues);
        expect(a.results.map((r) => r.value)).toEqual(b.results.map((r) => r.value));
        expect(a.results[0]?.naturalValue).toBeGreaterThan(0);
    });
});
