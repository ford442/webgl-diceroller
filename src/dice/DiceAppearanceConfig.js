import { DICE_PRESET_IDS, presetFromShortCode, presetToShortCode } from './DiceMaterials.js';

export const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const STORAGE_KEY = 'dice-roller-appearance';

/** Default curated look per die type. */
export const DEFAULT_DICE_APPEARANCE = {
    d4: { preset: 'resin', bodyColor: '#b83232', pipColor: '#fff8ef' },
    d6: { preset: 'resin', bodyColor: '#c43c3c', pipColor: '#fff8ef' },
    d8: { preset: 'metal', bodyColor: '#8b7355', pipColor: '#1a1410' },
    d10: { preset: 'gemstone', bodyColor: '#5b3fa6', pipColor: '#efe8ff' },
    d12: { preset: 'bone', bodyColor: '#e8dcc8', pipColor: '#3d3428' },
    d20: { preset: 'obsidian', bodyColor: '#1a1a22', pipColor: '#c9a84c' }
};

function normalizeHex(raw, fallback) {
    if (!raw) return fallback;
    const trimmed = raw.trim();
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
        const h = withHash.slice(1);
        return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
    }
    return fallback;
}

function normalizeTypeAppearance(type, raw) {
    const defaults = DEFAULT_DICE_APPEARANCE[type] ?? DEFAULT_DICE_APPEARANCE.d6;
    const preset = DICE_PRESET_IDS.includes(raw?.preset) ? raw.preset : defaults.preset;
    return {
        preset,
        bodyColor: normalizeHex(raw?.bodyColor, defaults.bodyColor),
        pipColor: normalizeHex(raw?.pipColor, defaults.pipColor)
    };
}

/**
 * @returns {Record<string, { preset: string, bodyColor: string, pipColor: string }>}
 */
export function createDefaultAppearanceConfig() {
    return Object.fromEntries(
        DICE_TYPES.map((type) => [type, { ...DEFAULT_DICE_APPEARANCE[type] }])
    );
}

function readStoredConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Compact URL token per die: `d6:r:c43c3c:fff8ef`
 * @param {Record<string, { preset: string, bodyColor: string, pipColor: string }>} config
 */
export function serializeDiceAppearance(config) {
    return DICE_TYPES
        .map((type) => {
            const entry = config[type];
            if (!entry) return null;
            const defaults = DEFAULT_DICE_APPEARANCE[type];
            const sameAsDefault = entry.preset === defaults.preset
                && entry.bodyColor === defaults.bodyColor
                && entry.pipColor === defaults.pipColor;
            if (sameAsDefault) return null;
            const body = entry.bodyColor.replace('#', '');
            const pip = entry.pipColor.replace('#', '');
            return `${type}:${presetToShortCode(entry.preset)}:${body}:${pip}`;
        })
        .filter(Boolean)
        .join(',');
}

/**
 * @param {string} raw
 * @returns {Partial<Record<string, { preset: string, bodyColor: string, pipColor: string }>>|null}
 */
export function parseDiceAppearanceParam(raw) {
    if (!raw?.trim()) return null;

    const partial = {};
    for (const part of raw.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const segments = trimmed.split(':');
        if (segments.length < 4) continue;
        const type = segments[0];
        if (!DICE_TYPES.includes(type)) continue;
        const preset = presetFromShortCode(segments[1]);
        const bodyColor = normalizeHex(`#${segments[2]}`, DEFAULT_DICE_APPEARANCE[type].bodyColor);
        const pipColor = normalizeHex(`#${segments[3]}`, DEFAULT_DICE_APPEARANCE[type].pipColor);
        partial[type] = { preset, bodyColor, pipColor };
    }

    return Object.keys(partial).length ? partial : null;
}

/**
 * @param {URLSearchParams} [searchParams]
 */
export function resolveDiceAppearanceConfig(searchParams = null) {
    const params = searchParams ?? new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const stored = typeof window !== 'undefined' ? readStoredConfig() : null;
    const urlPartial = parseDiceAppearanceParam(params.get('dice-look') ?? params.get('look') ?? '');

    const config = createDefaultAppearanceConfig();

    if (stored?.types) {
        DICE_TYPES.forEach((type) => {
            if (stored.types[type]) config[type] = normalizeTypeAppearance(type, stored.types[type]);
        });
    }

    if (urlPartial) {
        Object.entries(urlPartial).forEach(([type, entry]) => {
            config[type] = normalizeTypeAppearance(type, entry);
        });
    }

    return config;
}

/**
 * @param {Record<string, { preset: string, bodyColor: string, pipColor: string }>} config
 */
export function persistDiceAppearanceConfig(config) {
    if (typeof window === 'undefined') return config;

    const payload = {
        version: 1,
        types: Object.fromEntries(DICE_TYPES.map((type) => [type, { ...config[type] }]))
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // quota / private mode
    }

    const url = new URL(window.location.href);
    const serialized = serializeDiceAppearance(config);
    if (serialized) url.searchParams.set('dice-look', serialized);
    else url.searchParams.delete('dice-look');
    url.searchParams.delete('look');
    window.history.replaceState({}, '', url);

    return config;
}

/**
 * Presence payload for multiplayer (#203).
 * @param {Record<string, { preset: string, bodyColor: string, pipColor: string }>} config
 */
export function buildDicePresencePayload(config) {
    return {
        diceAppearance: serializeDiceAppearance(config),
        diceAppearanceVersion: 1
    };
}

/**
 * Merge remote presence appearance into a local config.
 * @param {Record<string, { preset: string, bodyColor: string, pipColor: string }>} baseConfig
 * @param {{ diceAppearance?: string }} presence
 */
export function mergeDicePresencePayload(baseConfig, presence) {
    if (!presence?.diceAppearance) return baseConfig;
    const partial = parseDiceAppearanceParam(presence.diceAppearance);
    if (!partial) return baseConfig;

    const merged = { ...baseConfig };
    Object.entries(partial).forEach(([type, entry]) => {
        merged[type] = normalizeTypeAppearance(type, entry);
    });
    return merged;
}
