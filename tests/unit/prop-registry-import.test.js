import { describe, expect, it } from 'vitest';
import {
    DECORATIVE_TIER_ENTRIES,
    PROP_FACTORIES,
    TIER_PROP_DEFINITIONS,
} from '../../src/environment/PropRegistry.js';

describe('PropRegistry import', () => {
    it('exports DECORATIVE_TIER_ENTRIES without TDZ', () => {
        expect(Array.isArray(DECORATIVE_TIER_ENTRIES)).toBe(true);
        expect(DECORATIVE_TIER_ENTRIES.length).toBeGreaterThan(0);
        expect(DECORATIVE_TIER_ENTRIES).toEqual([
            ...TIER_PROP_DEFINITIONS.tier2,
            ...TIER_PROP_DEFINITIONS.tier3,
        ]);
    });

    it('discovers prop factories without barrel/helper modules', () => {
        expect(typeof PROP_FACTORIES.Cauldron).toBe('function');
        expect(PROP_FACTORIES.Prop).toBeUndefined();
        expect(PROP_FACTORIES.PropRegistry).toBeUndefined();
    });
});
