import { TIER_PROP_DEFINITIONS } from './tierDefinitions.js';
import { isLegacyTabletopPosition } from './entryHelpers.js';
import { SHADOW_DISABLED_PROP_NAMES } from './shadowPolicy.js';

const FURNITURE_NAMES = new Set(['Bookshelf', 'Chair', 'Chest', 'Rug']);
export const INTERACTIVE_NAMES = new Set(['Skull', 'Gong', 'Lamp', 'MysticOrb']);
const WALL_DECOR_NAMES = new Set(['Shield', 'BountyPoster', 'DecorativeWalls']);

// Central semantic tag groupings. Keyed by factory name so a prop can be tagged
// once here regardless of how many tier entries reference it. Merged with any
// `tags` declared on the entry itself.
const SEMANTIC_TAGS = {
    weapon: ['Dagger', 'Sword', 'Shield', 'BattleAxe', 'Warhammer', 'Crossbow', 'Helmet', 'Dart'],
    drinkware: [
        'Mug',
        'Tankard',
        'Goblet',
        'Chalice',
        'DrinkingHorn',
        'AleKeg',
        'Waterskin',
        'PocketFlask',
    ],
    paper: [
        'Scroll',
        'Map',
        'PlayingCards',
        'CharacterSheet',
        'BountyPoster',
        'ScrollCase',
        'LeatherJournal',
        'WritingSet',
        'DMScreen',
        'Spellbook',
        'Rulebook',
    ],
    light: ['Lantern', 'Candelabra', 'FloatingCandles'],
    magic: [
        'CrystalBall',
        'MysticOrb',
        'Wand',
        'Runestones',
        'Spellbook',
        'Amulet',
        'DragonScale',
        'PotionSet',
    ],
    treasure: ['Coin', 'CoinPouch', 'Gemstones', 'Crown', 'Chalice', 'Amulet', 'Bone'],
    food: ['TavernMeal', 'CheeseWheel', 'Apple'],
    game: ['PlayingCards', 'TarotDeck', 'DiceTower', 'DiceTray', 'DiceJail', 'DiceBag', 'DiceCup'],
    tool: [
        'Compass',
        'Spyglass',
        'MagnifyingGlass',
        'Astrolabe',
        'Sundial',
        'Abacus',
        'Lockpicks',
        'Key',
        'Padlock',
        'PocketWatch',
        'Spectacles',
        'Rope',
    ],
};

// factoryName -> Set(semantic tags), inverted from SEMANTIC_TAGS once.
const SEMANTIC_TAGS_BY_NAME = (() => {
    const map = new Map();
    for (const [tag, names] of Object.entries(SEMANTIC_TAGS)) {
        for (const name of names) {
            if (!map.has(name)) map.set(name, new Set());
            map.get(name).add(tag);
        }
    }
    return map;
})();

function deriveCategory(entry, tier) {
    if (entry.category) return entry.category;
    const name = entry.factoryName || entry.name;
    if (INTERACTIVE_NAMES.has(name)) return 'interactive';
    if (WALL_DECOR_NAMES.has(name)) return 'wallDecor';
    if (tier === 'tier0') return 'core';
    if (tier === 'tier1') return FURNITURE_NAMES.has(name) ? 'furniture' : 'ambiance';
    return 'tableClutter';
}

function isTabletopEntry(entry) {
    const pos = entry.position;
    if (!pos) return false;
    return entry.tabletop === true || (entry.tabletop !== false && isLegacyTabletopPosition(pos));
}

function deriveTags(entry, tier, category) {
    const name = entry.factoryName || entry.name;
    const tags = new Set(entry.tags ?? []);
    tags.add(category);
    if (entry.randomPool) tags.add('randomPool');
    if (isTabletopEntry(entry)) tags.add('tabletop');
    if (SHADOW_DISABLED_PROP_NAMES.has(name)) tags.add('small');
    const semantic = SEMANTIC_TAGS_BY_NAME.get(name);
    if (semantic) for (const t of semantic) tags.add(t);
    return tags;
}

/**
 * Flat, immutable-ish descriptor list for every prop entry across all tiers.
 * Each descriptor: { entry, name, factoryName, tier, category, tags(Set),
 * randomPool, position }.
 */
export const PROP_INDEX = [];
const indexByName = new Map(); // entry.name -> descriptor
const indexByEntry = new Map(); // entry object -> descriptor
const indexByTag = new Map(); // tag -> descriptor[]
const indexByCategory = new Map(); // category -> descriptor[]

for (const [tier, entries] of Object.entries(TIER_PROP_DEFINITIONS)) {
    for (const entry of entries) {
        const factoryName = entry.factoryName || entry.name;
        const category = deriveCategory(entry, tier);
        const tags = deriveTags(entry, tier, category);
        const descriptor = {
            entry,
            name: entry.name,
            factoryName,
            tier,
            category,
            tags,
            randomPool: !!entry.randomPool,
            position: entry.position ?? null,
        };
        PROP_INDEX.push(descriptor);
        indexByName.set(entry.name, descriptor);
        indexByEntry.set(entry, descriptor);
        if (!indexByCategory.has(category)) indexByCategory.set(category, []);
        indexByCategory.get(category).push(descriptor);
        for (const tag of tags) {
            if (!indexByTag.has(tag)) indexByTag.set(tag, []);
            indexByTag.get(tag).push(descriptor);
        }
    }
}

/** Descriptor lookup by entry name (e.g. 'PlayingCards', 'ChairRight'). */
export const getPropDescriptor = (name) => indexByName.get(name) ?? null;

/** All descriptors carrying a given tag. */
export const getPropsByTag = (tag) => (indexByTag.get(tag) ?? []).slice();

/** All descriptors in a given category. */
export const getPropsByCategory = (category) => (indexByCategory.get(category) ?? []).slice();

/** Sorted list of every tag in use (handy for building UI filters). */
export const getAllTags = () => [...indexByTag.keys()].sort();

/** Sorted list of every category in use. */
export const getAllCategories = () => [...indexByCategory.keys()].sort();

/** The candidate pool for randomized tabletop layouts (randomPool entries). */
export const getClutterPool = () => PROP_INDEX.filter((d) => d.randomPool);
