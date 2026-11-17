import { LAYOUT_THEMES } from '../../core/TableLayoutConfig.js';
import { PROP_INDEX, describeEntry } from './propIndex.js';

// Deterministic, seedable PRNG (mulberry32-style). Shared so query-based
// selection and the legacy decor selection produce identical sequences.
function createPoolRng(seed) {
    let state = ((seed ?? 1) >>> 0) + 0x9e3779b9;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function getDecorThemeWeight(entry, themeId) {
    const theme = LAYOUT_THEMES[themeId];
    if (!theme) return 1;
    const name = entry.factoryName || entry.name;
    if (theme.favorDecor?.includes(name)) return 3;
    if (theme.reduceDecor?.includes(name)) return 0.25;
    return 1;
}

/**
 * General-purpose seeded random prop selection over the descriptor index.
 *
 *   getRandomProps({ count: 6, tiers: ['tier2', 'tier3'], tags: ['small'],
 *                    exclude: ['Skull'], seed, theme })
 *
 * Filtering is by ALL provided criteria (intersection). `count <= 0` returns the
 * full filtered set in deterministic shuffled order. Returns the underlying tier
 * entries (ready to hand to `spawnProp`). By default only `randomPool` props are
 * considered (the random-extras pool); pass `randomPoolOnly: false` to include
 * always-on props too.
 *
 * Selection uses the same seeded, theme-weighted ordering as the layout system,
 * so passing only `{ count, seed, theme }` reproduces `selectDecorPoolEntries`
 * exactly. Pass `entries` (compiled scene entries) to draw from that scene's
 * list instead of the tavern catalogue; with the tavern's own decor list the
 * result is identical to the default.
 */
export function getRandomProps({
    count = 0,
    tiers = null,
    tags = null,
    category = null,
    exclude = [],
    seed = 1,
    theme = 'default',
    randomPoolOnly = true,
    entries = null,
} = {}) {
    const excludeSet = new Set(exclude);
    const tierSet = tiers ? new Set(tiers) : null;
    const tagList = tags ?? null;

    // `entries`: draw from a scene's own decor list rather than the tavern catalogue.
    const candidates = entries ? entries.map((entry) => describeEntry(entry)) : PROP_INDEX;
    const pool = candidates.filter((d) => {
        if (randomPoolOnly && !d.randomPool) return false;
        if (tierSet && !tierSet.has(d.tier)) return false;
        if (category && d.category !== category) return false;
        if (excludeSet.has(d.name) || excludeSet.has(d.factoryName)) return false;
        if (tagList && !tagList.every((t) => d.tags.has(t))) return false;
        return true;
    });

    const rng = createPoolRng(seed);
    const weighted = pool.map((d) => ({
        entry: d.entry,
        sortKey: rng() / getDecorThemeWeight(d.entry, theme),
    }));
    weighted.sort((a, b) => a.sortKey - b.sortKey);
    const limit = count > 0 ? count : weighted.length;
    return weighted.slice(0, limit).map((item) => item.entry);
}

/**
 * Decor selection used by `spawnTierWithRandomPool`: the seeded, theme-weighted
 * draw over `entries` (the loaded scene's decor list, tiers 2 + 3). For the
 * tavern this is bit-identical to the old index-wide draw, whose randomPool
 * subset was exactly the randomPool subset of the tavern's decor list, in order.
 */
/** @param {{seed?: number, theme?: string}} [options] */
export function selectDecorPoolEntries(entries, maxRandom, options = {}) {
    const { seed, theme = 'default' } = options;
    return getRandomProps({ count: Math.max(0, maxRandom), seed, theme, entries });
}
