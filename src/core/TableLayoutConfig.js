import { createSeededRng } from '../environment/clutter/ClutterPlacement.js';

const STORAGE_KEY = 'dice-roller-layout';

export const DENSITY_PRESETS = {
    low: { clutter: [4, 6], decor: [4, 6] },
    med: { clutter: [6, 8], decor: [8, 10] },
    high: { clutter: [8, 10], decor: [12, 15] }
};

export const LAYOUT_THEMES = {
    default: {
        id: 'default',
        label: 'Classic Table'
    },
    tidy: {
        id: 'tidy',
        label: 'Tidy',
        favorClutter: ['book', 'pencil', 'quill', 'parchment'],
        favorDecor: ['Spellbook', 'CharacterSheet', 'Pencil', 'WritingSet', 'LeatherJournal'],
        reduceClutter: ['coins', 'tarotCards', 'pipe', 'dmScreen'],
        reduceDecor: ['Sword', 'BattleAxe', 'Warhammer', 'Crossbow', 'Shield']
    },
    wizard: {
        id: 'wizard',
        label: 'Messy Wizard',
        favorClutter: ['potionBottle', 'gemstone', 'tarotCards', 'dmScreen', 'quill', 'parchment'],
        favorDecor: ['CrystalBall', 'Spellbook', 'PotionSet', 'Wand', 'Runestones', 'Astrolabe', 'MysticOrb'],
        reduceDecor: ['Sword', 'BattleAxe', 'Warhammer', 'Crossbow']
    },
    battle: {
        id: 'battle',
        label: 'Battle Aftermath',
        favorClutter: ['wantedPoster', 'miniature', 'pipe', 'key'],
        favorDecor: ['Sword', 'Shield', 'BattleAxe', 'Warhammer', 'Crossbow', 'Helmet', 'Dart', 'Rope'],
        reduceClutter: ['tarotCards', 'quill', 'parchment'],
        reduceDecor: ['PlayingCards', 'CoinPouch', 'Tankard', 'AleKeg']
    },
    gambling: {
        id: 'gambling',
        label: 'Gambling Night',
        favorClutter: ['coins', 'tarotCards', 'pipe', 'mug', 'wantedPoster'],
        favorDecor: ['PlayingCards', 'CoinPouch', 'Coin', 'Tankard', 'Mug', 'Goblet', 'DrinkingHorn', 'PocketFlask'],
        reduceDecor: ['Sword', 'BattleAxe', 'Warhammer', 'Shield', 'Helmet']
    }
};

function randomInRange([min, max], rng) {
    return min + Math.floor(rng() * (max - min + 1));
}

function readStoredConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function randomSeed(rng = Math.random) {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] >>> 0;
    }
    return Math.floor(rng() * 0xFFFFFFFF) >>> 0;
}

export function resolveTableLayoutConfig(searchParams = null, rng = Math.random) {
    const params = searchParams ?? new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const stored = typeof window !== 'undefined' ? readStoredConfig() : null;

    const density = params.get('density')
        ?? params.get('clutter-level')
        ?? stored?.density
        ?? 'med';

    const theme = params.get('theme') ?? stored?.theme ?? 'default';

    let seed = parseInt(params.get('layout-seed') ?? params.get('clutter-seed') ?? '', 10);
    if (!Number.isFinite(seed)) seed = stored?.seed;
    if (!Number.isFinite(seed)) seed = randomSeed(rng);

    const preset = DENSITY_PRESETS[density] ?? DENSITY_PRESETS.med;
    const seededRng = createSeededRng(seed);

    let clutterCount = parseInt(params.get('clutter-count') ?? params.get('clutter') ?? '', 10);
    let decorCount = parseInt(params.get('decor-count') ?? '', 10);

    if (!Number.isFinite(clutterCount)) clutterCount = randomInRange(preset.clutter, seededRng);
    if (!Number.isFinite(decorCount)) decorCount = randomInRange(preset.decor, seededRng);

    return {
        density,
        theme: LAYOUT_THEMES[theme] ? theme : 'default',
        seed: seed >>> 0,
        clutterCount: Math.max(4, Math.min(10, clutterCount)),
        decorCount: Math.max(4, Math.min(15, decorCount))
    };
}

export function persistTableLayoutConfig(config) {
    if (typeof window === 'undefined') return config;

    const payload = {
        density: config.density,
        theme: config.theme,
        seed: config.seed >>> 0,
        clutterCount: config.clutterCount,
        decorCount: config.decorCount
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // ignore quota / private mode
    }

    const url = new URL(window.location.href);
    url.searchParams.set('layout-seed', String(payload.seed));
    url.searchParams.set('density', payload.density);
    if (payload.theme && payload.theme !== 'default') url.searchParams.set('theme', payload.theme);
    else url.searchParams.delete('theme');
    url.searchParams.set('clutter-count', String(payload.clutterCount));
    url.searchParams.set('decor-count', String(payload.decorCount));
    url.searchParams.delete('clutter-seed');
    url.searchParams.delete('clutter');
    url.searchParams.delete('clutter-level');
    window.history.replaceState({}, '', url);

    return payload;
}

export function buildShareableTableUrl(config = null) {
    const resolved = config ?? resolveTableLayoutConfig();
    persistTableLayoutConfig(resolved);
    return window.location.href;
}
