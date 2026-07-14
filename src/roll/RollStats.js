const DIE_SIDES = {
    d4: 4,
    d6: 6,
    d8: 8,
    d10: 10,
    d12: 12,
    d20: 20
};

const DIE_ORDER = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

// Chi-squared critical values for alpha=0.05, df = sides - 1.
const CHI_SQUARED_CRITICAL_95 = {
    4: 7.815,
    6: 11.070,
    8: 14.067,
    10: 16.919,
    12: 19.675,
    20: 30.144
};

const DEFAULT_MIN_SAMPLE_SIZE = 100;
const STORAGE_KEY = 'dice-roller-roll-stats';

function createEmptyEntry(sides) {
    const counts = new Map();
    for (let face = 1; face <= sides; face++) {
        counts.set(face, 0);
    }
    return {
        sides,
        totalRolls: 0,
        counts
    };
}

function ensureEntry(store, dieType) {
    const sides = DIE_SIDES[dieType];
    if (!sides) return null;

    if (!store.has(dieType)) {
        store.set(dieType, createEmptyEntry(sides));
    }

    return store.get(dieType);
}

export function computeChiSquared(observedCounts, sides) {
    const total = observedCounts.reduce((sum, count) => sum + count, 0);
    if (total === 0 || sides <= 0) return 0;

    const expected = total / sides;
    if (expected === 0) return 0;

    return observedCounts.reduce((sum, count) => (
        sum + ((count - expected) ** 2) / expected
    ), 0);
}

function serializeStore(store) {
    const payload = {};
    for (const [dieType, entry] of store.entries()) {
        payload[dieType] = {
            sides: entry.sides,
            totalRolls: entry.totalRolls,
            counts: Object.fromEntries(entry.counts)
        };
    }
    return payload;
}

function deserializeStore(payload) {
    const store = new Map();
    if (!payload || typeof payload !== 'object') return store;

    for (const dieType of DIE_ORDER) {
        const raw = payload[dieType];
        if (!raw || typeof raw !== 'object') continue;

        const sides = DIE_SIDES[dieType];
        const entry = createEmptyEntry(sides);
        entry.totalRolls = Number.isFinite(raw.totalRolls) ? raw.totalRolls : 0;

        if (raw.counts && typeof raw.counts === 'object') {
            for (let face = 1; face <= sides; face++) {
                const count = raw.counts[face] ?? raw.counts[String(face)] ?? 0;
                entry.counts.set(face, Number.isFinite(count) ? count : 0);
            }
        }

        store.set(dieType, entry);
    }

    return store;
}

export function createRollStats({
    minSampleSize = DEFAULT_MIN_SAMPLE_SIZE,
    storageKey = STORAGE_KEY,
    persist = true
} = {}) {
    const store = new Map();

    function load() {
        if (!persist || typeof localStorage === 'undefined') return;
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const restored = deserializeStore(parsed);
            store.clear();
            for (const [dieType, entry] of restored.entries()) {
                store.set(dieType, entry);
            }
        } catch (error) {
            console.warn('[RollStats] Failed to load persisted stats:', error);
        }
    }

    function save() {
        if (!persist || typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(storageKey, JSON.stringify(serializeStore(store)));
        } catch (error) {
            console.warn('[RollStats] Failed to persist stats:', error);
        }
    }

    function recordResults(diceResults) {
        if (!Array.isArray(diceResults)) return;

        let changed = false;
        for (const result of diceResults) {
            if (!result || typeof result.type !== 'string') continue;
            if (!Number.isInteger(result.value)) continue;

            const entry = ensureEntry(store, result.type);
            if (!entry || result.value < 1 || result.value > entry.sides) continue;

            entry.totalRolls += 1;
            entry.counts.set(result.value, (entry.counts.get(result.value) ?? 0) + 1);
            changed = true;
        }

        if (changed) save();
    }

    function reset() {
        store.clear();
        save();
    }

    function getStats() {
        return DIE_ORDER
            .map((dieType) => {
                const entry = store.get(dieType);
                if (!entry) return null;

                const observedCounts = Array.from(
                    { length: entry.sides },
                    (_, index) => entry.counts.get(index + 1) ?? 0
                );
                const chiSquared = computeChiSquared(observedCounts, entry.sides);
                const criticalValue = CHI_SQUARED_CRITICAL_95[entry.sides] ?? null;
                const expectedMean = (entry.sides + 1) / 2;
                const actualMean = entry.totalRolls > 0
                    ? observedCounts.reduce((sum, count, index) => sum + count * (index + 1), 0) / entry.totalRolls
                    : 0;

                return {
                    dieType,
                    sides: entry.sides,
                    totalRolls: entry.totalRolls,
                    observedCounts,
                    chiSquared,
                    criticalValue,
                    expectedMean,
                    actualMean,
                    hasEnoughSamples: entry.totalRolls >= minSampleSize,
                    passes: criticalValue == null ? null : chiSquared <= criticalValue
                };
            })
            .filter(Boolean);
    }

    load();

    return {
        recordResults,
        reset,
        getStats,
        minSampleSize
    };
}

export { DIE_ORDER, DIE_SIDES, CHI_SQUARED_CRITICAL_95, DEFAULT_MIN_SAMPLE_SIZE };
