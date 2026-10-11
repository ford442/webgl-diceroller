import { describe, expect, it } from 'vitest';
import {
    DEFAULT_MASS_BIAS_RATIO,
    MAX_MASS_BIAS_RATIO,
    PHYSICS_FLAG_FAIR_DICE,
    PHYSICS_FLAG_NO_DRAG,
    parseMassBiasRatio,
    parsePhysicsFlags,
} from '../../src/core-engine/wasm/physicsFlags.js';

const params = (search: string) => new URLSearchParams(search);

describe('parsePhysicsFlags', () => {
    it('is zero with no physics flags', () => {
        expect(parsePhysicsFlags(params('?webgl&test'))).toBe(0);
    });

    it('maps ?no-drag and ?fair-dice to distinct bits', () => {
        expect(PHYSICS_FLAG_NO_DRAG).not.toBe(PHYSICS_FLAG_FAIR_DICE);
        expect(parsePhysicsFlags(params('?no-drag'))).toBe(PHYSICS_FLAG_NO_DRAG);
        expect(parsePhysicsFlags(params('?fair-dice'))).toBe(PHYSICS_FLAG_FAIR_DICE);
        expect(parsePhysicsFlags(params('?no-drag&fair-dice'))).toBe(
            PHYSICS_FLAG_NO_DRAG | PHYSICS_FLAG_FAIR_DICE
        );
    });
});

describe('parseMassBiasRatio', () => {
    it('defaults to the pipping ratio', () => {
        expect(parseMassBiasRatio(params(''))).toBe(DEFAULT_MASS_BIAS_RATIO);
        expect(DEFAULT_MASS_BIAS_RATIO).toBe(0.0075);
    });

    it('reads ?bias-ratio= and clamps it to [0, 0.05]', () => {
        expect(parseMassBiasRatio(params('?bias-ratio=0.01'))).toBe(0.01);
        expect(parseMassBiasRatio(params('?bias-ratio=1'))).toBe(MAX_MASS_BIAS_RATIO);
        expect(parseMassBiasRatio(params('?bias-ratio=-3'))).toBe(0);
    });

    it('falls back to the default for a non-numeric value', () => {
        expect(parseMassBiasRatio(params('?bias-ratio=heavy'))).toBe(DEFAULT_MASS_BIAS_RATIO);
        expect(parseMassBiasRatio(params('?bias-ratio'))).toBe(DEFAULT_MASS_BIAS_RATIO);
    });
});
