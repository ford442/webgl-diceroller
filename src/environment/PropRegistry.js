import { registerInteractiveObject, unregisterInteractiveObject } from '../interaction.js';
import { registerInteractable } from '../interactables/InteractableRegistry.js';
import { LAMP_HANG_Y, toCurrentTabletopY } from '../core/SceneMetrics.js';
import { shuffleWithRng } from './clutter/ClutterPlacement.js';
import { LAYOUT_THEMES } from '../core/TableLayoutConfig.js';
import { disposePropSpawn } from './PropLifecycle.js';
import { mergePropRecord } from '../core/StaticPropMerger.js';
import './Bone.js';
import './Cauldron.js';

const environmentModules = import.meta.glob('./*.js', { eager: true });

export const PROP_FACTORIES = {};

for (const [path, mod] of Object.entries(environmentModules)) {
    const baseName = path.split('/').pop().replace('.js', '');
    for (const [exportName, value] of Object.entries(mod)) {
        if (typeof value !== 'function' || !exportName.startsWith('create')) continue;
        const factoryName = exportName.slice('create'.length);
        PROP_FACTORIES[factoryName] = value;
        if (!PROP_FACTORIES[baseName]) {
            PROP_FACTORIES[baseName] = value;
        }
    }
}

export const getPropFactory = (name) => {
    const factory = PROP_FACTORIES[name];
    if (!factory) {
        throw new Error(`Missing prop factory "${name}"`);
    }
    return factory;
};

/**
 * @template {object} T
 * @param {string} name
 * @param {T} [options]
 * @returns {{name: string, factoryName?: string, randomPool?: boolean, position?: {x: number, y: number, z: number}} & T}
 */
const factoryEntry = (name, options) => ({ name, .../** @type {any} */ (options ?? {}) });

const tier1Position = { x: 0, y: LAMP_HANG_Y, z: 0 };
const isLegacyTabletopPosition = (position) => position.y > -3.25 && position.y < -1.5;
const resolveEntryPosition = (entry) => (
    entry.tabletop === true || (entry.tabletop !== false && isLegacyTabletopPosition(entry.position))
        ? toCurrentTabletopY(entry.position)
        : entry.position
);

export const SHADOW_DISABLED_PROP_NAMES = new Set([
    'Dart', 'Bell', 'Pencil', 'Bone', 'Key', 'CoinPouch', 'PocketFlask', 'Compass', 'WaxSeal',
    'PocketWatch', 'Dagger', 'PlayingCards', 'DragonScale', 'CharacterSheet', 'BountyPoster',
    'CheeseWheel', 'Runestones', 'Gemstones', 'WritingSet',
    'SmokingPipe', 'Crown', 'Chalice', 'Miniature', 'Scroll', 'Coin', 'Amulet', 'Abacus',
    'Padlock', 'Spectacles', 'Lockpicks', 'LeatherJournal', 'MagnifyingGlass', 'Rope',
    'Candelabra', 'Waterskin', 'Astrolabe', 'Sundial', 'Flute', 'Apple', 'WoodenSpoon',
    'Warhammer'
]);

export function resolveRootObject(result) {
    if (!result) return null;
    if (result.isObject3D) return result;
    if (result.group?.isObject3D) return result.group;
    return null;
}

function applyShadowPolicyToResult(result, enabled) {
    const root = resolveRootObject(result);
    if (!root) return;

    root.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = enabled;
        if (!enabled) child.receiveShadow = false;
    });
}

// Shadow LOD (bonus): props whose root sits far from the table centre contribute
// little to what the camera sees, so we statically drop their shadow casting
// (receiving is kept so they still read as lit). Static + distance-based, applied
// once at spawn — no per-frame shadow-map churn.
const FAR_SHADOW_DISTANCE = 26;

function applyFarShadowLOD(result) {
    const root = resolveRootObject(result);
    if (!root) return;
    const dist = Math.hypot(root.position.x, root.position.z);
    if (dist <= FAR_SHADOW_DISTANCE) return;
    root.traverse((child) => {
        if (child.isMesh) child.castShadow = false;
    });
}

export const TIER_PROP_DEFINITIONS = {
    tier0: [
        factoryEntry('TavernWalls', {
            cull: false,
            call: (ctx) => getPropFactory('TavernWalls')(ctx.scene, ctx.physicsWorld),
            afterCreate: (result, ctx) => {
                if (result?.fireplaceLight) ctx.state.fireplaceLight = result.fireplaceLight;
                if (result?.update) ctx.registerUpdate('walls', result.update);
            }
        }),
        factoryEntry('Room', {
            cull: false,
            call: (ctx) => getPropFactory('Room')(ctx.scene)
        }),
        factoryEntry('Table', {
            call: (ctx) => {
                const tableConfig = getPropFactory('Table')(ctx.scene);
                ctx.createFloorAndWalls(ctx.scene, ctx.physicsWorld, tableConfig);
                return tableConfig;
            }
        }),
        factoryEntry('Clutter', {
            call: (ctx) => getPropFactory('Clutter')(ctx.scene, ctx.physicsWorld, ctx.clutterOptions ?? {}),
            afterCreate: (result, ctx) => {
                ctx.state.clutterResult = result;
                if (result?.flamePosition) ctx.callbacks.setCandleFlamePos?.(result.flamePosition);
            }
        }),
        factoryEntry('TarotDeck', {
            call: (ctx) => getPropFactory('TarotDeck')(ctx.scene, ctx.physicsWorld)
        })
    ],
    tier1: [
        factoryEntry('Bookshelf', { position: { x: -18, y: -10, z: 0 }, rotation: Math.PI / 2 }),
        factoryEntry('DecorativeWalls', { cull: false, call: (ctx) => getPropFactory('DecorativeWalls')(ctx.scene, ctx.physicsWorld) }),
        factoryEntry('Chair', { position: { x: -14, y: -9.5, z: 6 }, rotation: Math.PI / 3 }),
        factoryEntry('Chair', { name: 'ChairRight', factoryName: 'Chair', position: { x: 14, y: -9.5, z: -6 }, rotation: -Math.PI / 3 }),
        factoryEntry('Chest', {
            position: { x: -10, y: -9.5, z: -18 },
            rotation: Math.PI / 8,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('chest', result.update)
        }),
        factoryEntry('Rug', { cull: false, call: (ctx) => getPropFactory('Rug')(ctx.scene) }),
        factoryEntry('Atmosphere', { cull: false, call: (ctx) => getPropFactory('Atmosphere')(ctx.scene) }),
        factoryEntry('Lamp', {
            call: async (ctx) => {
                const result = await getPropFactory('Lamp')();
                ctx.scene.add(result.group);
                result.group.position.set(tier1Position.x, tier1Position.y, tier1Position.z);
                return result;
            },
            afterCreate: (result, ctx) => {
                registerInteractiveObject(result.group, result.toggle);
                registerInteractable('lamp', { trigger: result.toggle });
                ctx.state.lampData = result;
                ctx.callbacks.setLampData?.(result);
                ctx.registerUpdate('lamp', result.update);
            }
        }),
        factoryEntry('FloatingCandles', {
            call: (ctx) => getPropFactory('FloatingCandles')(ctx.scene),
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('floatingCandles', result.update)
        }),
        factoryEntry('Runecircle', {
            call: (ctx) => getPropFactory('Runecircle')(ctx.scene),
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('runecircle', result.update)
        })
    ],
    tier2: [
        factoryEntry('Horseshoe', { randomPool: true }),
        factoryEntry('DiceTower', { position: { x: 0, y: -3.0, z: -14 }, rotation: 0 }),
        factoryEntry('DiceTray', { position: { x: 12, y: -2.75, z: 10 }, rotation: Math.PI / 6 }),
        factoryEntry('DiceJail', { position: { x: -13, y: -2.75, z: -13 }, rotation: -Math.PI / 4 }),
        factoryEntry('DiceBag', { position: { x: -10, y: -1.95, z: 12 }, rotation: Math.PI / 8 }),
        factoryEntry('Bell', { randomPool: true, call: (ctx) => getPropFactory('Bell')(ctx.scene, toCurrentTabletopY({ x: 0, y: -2.75, z: 15 })) }),
        factoryEntry('TavernMeal', { randomPool: true, position: { x: 14, y: -2.75, z: 5 }, rotation: -Math.PI / 6 }),
        factoryEntry('Hourglass', { randomPool: true, position: { x: 11, y: -1.75, z: -11 }, rotation: Math.PI / 12 }),
        factoryEntry('Map', { randomPool: true, position: { x: -14, y: -2.75, z: 0 }, rotation: Math.PI / 3 }),
        factoryEntry('Scroll', { randomPool: true, position: { x: 10, y: -2.4, z: 13 }, rotation: -Math.PI / 8 }),
        factoryEntry('CrystalBall', { randomPool: true, position: { x: 13, y: -2.75, z: -13 }, rotation: 0 }),
        factoryEntry('PotionSet', { randomPool: true, position: { x: -13, y: -2.75, z: -6 }, rotation: Math.PI / 5 }),
        factoryEntry('Skull', {
            position: { x: -11, y: -2.4, z: 11 },
            rotation: Math.PI / 6,
            afterCreate: (result) => {
                if (!result?.toggleGlow) return;
                registerInteractiveObject(result.group, result.toggleGlow);
                registerInteractable('skull', { trigger: result.toggleGlow });
            }
        }),
        factoryEntry('MerchantScale', {
            randomPool: true,
            position: { x: 14, y: -2.75, z: -3 },
            rotation: -Math.PI / 4,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('scale', result.update)
        }),
        factoryEntry('Lantern', {
            randomPool: true,
            position: { x: -6, y: -2.75, z: -14 },
            rotation: 0,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('lantern', result.update)
        }),
        factoryEntry('Spellbook', { randomPool: true, position: { x: -14, y: -2.35, z: 7 }, rotation: Math.PI / 2 }),
        factoryEntry('Mug', {
            randomPool: true,
            position: { x: -5, y: -2.75, z: 14 },
            rotation: Math.PI / 4,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('mug', result.update)
        }),
        factoryEntry('Tankard', {
            randomPool: true,
            position: { x: 12, y: -2.75, z: 9 },
            rotation: -Math.PI / 6,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('tankard', result.update)
        })
    ],
    tier3: [
        factoryEntry('Dagger', { randomPool: true, position: { x: 13, y: -2.45, z: 11 }, rotation: Math.PI / 3 }),
        factoryEntry('Sword', { randomPool: true, position: { x: -14, y: -2.45, z: 12 }, rotation: -Math.PI / 6 }),
        factoryEntry('Shield', { randomPool: true, position: { x: 0, y: 2, z: -24 }, rotation: 0 }),
        factoryEntry('BattleAxe', { randomPool: true, position: { x: -16, y: -6, z: -16 }, rotation: -Math.PI / 3 }),
        factoryEntry('PocketWatch', { randomPool: true, position: { x: 14, y: -2.65, z: 3 }, rotation: 0 }),
        factoryEntry('Compass', { randomPool: true, position: { x: 7, y: -2.65, z: 14 }, rotation: Math.PI / 8 }),
        factoryEntry('Chalice', { randomPool: true, position: { x: 6, y: -2.75, z: -13 }, rotation: 0 }),
        factoryEntry('Miniature', { randomPool: true, position: { x: -13, y: -2.75, z: -8 }, rotation: Math.PI / 4 }),
        factoryEntry('CharacterSheet', { randomPool: true, position: { x: 14, y: -2.75, z: 8 }, rotation: -Math.PI / 6 }),
        factoryEntry('BountyPoster', { randomPool: true, position: { x: -20, y: 4, z: -20 }, rotation: Math.PI / 4 }),
        factoryEntry('Pencil', { randomPool: true, position: { x: -8, y: -2.75, z: 14 }, rotation: Math.PI / 5 }),
        factoryEntry('Bone', { randomPool: true, position: { x: 5, y: -2.75, z: 5 }, rotation: Math.PI / 3 }),
        factoryEntry('CoinPouch', { randomPool: true, position: { x: 9, y: -2.75, z: 13 }, rotation: -Math.PI / 8 }),
        factoryEntry('Lute', { randomPool: true, position: { x: -14, y: -1.85, z: -10 }, rotation: Math.PI / 4 }),
        factoryEntry('Runestones', { randomPool: true, position: { x: 12, y: -2.75, z: -12 }, rotation: -Math.PI / 12 }),
        factoryEntry('Candelabra', {
            randomPool: true,
            position: { x: 6, y: -2.75, z: -10 },
            rotation: Math.PI / 4,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('candelabra', result.update)
        }),
        factoryEntry('SmokingPipe', {
            randomPool: true,
            position: { x: -4, y: -2.73, z: 14 },
            rotation: Math.PI / 8,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('pipe', result.update)
        }),
        factoryEntry('Gemstones', {
            randomPool: true,
            position: { x: 14, y: -2.73, z: -8 },
            rotation: -Math.PI / 12,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('gems', result.update)
        }),
        factoryEntry('WritingSet', {
            randomPool: true,
            position: { x: -10, y: -2.73, z: -14 },
            rotation: Math.PI / 6,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('writing', result.update)
        }),
        factoryEntry('CheeseWheel', { randomPool: true, position: { x: -12, y: -2.75, z: 11 }, rotation: Math.PI / 4 }),
        factoryEntry('WaxSeal', { randomPool: true, position: { x: 4, y: -2.75, z: 14 }, rotation: 0 }),
        factoryEntry('Crown', { randomPool: true, position: { x: 0, y: -2.75, z: -13 }, rotation: 0 }),
        factoryEntry('Helmet', { randomPool: true, position: { x: -15, y: -2.75, z: 8 }, rotation: Math.PI / 6 }),
        factoryEntry('Gong', {
            position: { x: 0, y: 0, z: -24 },
            rotation: 0,
            afterCreate: (result, ctx) => {
                if (!result) return;
                registerInteractiveObject(result.group, result.interact);
                registerInteractable('gong', { trigger: result.interact });
                ctx.state.gongData = result;
                ctx.callbacks.setGongData?.(result);
                ctx.registerUpdate('gong', result.update);
            }
        }),
        factoryEntry('MysticOrb', {
            position: { x: 15, y: -2.75, z: -15 },
            rotation: 0,
            afterCreate: (result, ctx) => {
                if (!result) return;
                registerInteractiveObject(result.group, result.interact);
                registerInteractable('mysticOrb', { trigger: result.interact });
                ctx.registerUpdate('mysticOrb', result.update);
            }
        }),
        factoryEntry('DMScreen', { randomPool: true, position: { x: 0, y: -2.75, z: -16 }, rotation: 0 }),
        factoryEntry('DragonScale', { randomPool: true, position: { x: -14, y: -2.75, z: 0 }, rotation: Math.PI / 3 }),
        factoryEntry('Spyglass', { randomPool: true, position: { x: 14, y: -2.75, z: 6 }, rotation: -Math.PI / 6 }),
        factoryEntry('PlayingCards', {
            randomPool: true,
            position: { x: -2, y: -2.75, z: 13 },
            rotation: Math.PI / 8,
            afterCreate: (result) => result?.interact && registerInteractiveObject(result.group, result.interact)
        }),
        factoryEntry('Key', { randomPool: true, position: { x: 10, y: -2.75, z: 13 }, rotation: Math.PI / 4 }),
        factoryEntry('Padlock', { randomPool: true, position: { x: -14, y: -2.75, z: -4 }, rotation: Math.PI / 6 }),
        factoryEntry('Lockpicks', { randomPool: true, position: { x: -13, y: -2.75, z: -3 }, rotation: Math.PI / 8 }),
        factoryEntry('Spectacles', { randomPool: true, position: { x: 3, y: -2.75, z: 14 }, rotation: 0 }),
        factoryEntry('Warhammer', { randomPool: true, position: { x: 5, y: -2.75, z: 2 }, rotation: Math.PI / 3 }),
        factoryEntry('LeatherJournal', { randomPool: true, position: { x: 12, y: -2.5, z: -13 }, rotation: Math.PI / 5 }),
        factoryEntry('DrinkingHorn', { randomPool: true, position: { x: 14, y: -2.75, z: 2 }, rotation: -Math.PI / 4 }),
        factoryEntry('Wand', { randomPool: true, position: { x: -14, y: -2.70, z: 9 }, rotation: Math.PI / 3 }),
        factoryEntry('Coin', { randomPool: true, position: { x: 11, y: -2.75, z: 11 }, rotation: 0 }),
        factoryEntry('Amulet', { randomPool: true, position: { x: -8, y: -2.74, z: -14 }, rotation: Math.PI / 6 }),
        factoryEntry('Abacus', { randomPool: true, position: { x: 13, y: -2.75, z: -10 }, rotation: -Math.PI / 8 }),
        factoryEntry('Dart', { randomPool: true, position: { x: 8, y: -2.75, z: 14 }, rotation: Math.PI / 4 }),
        factoryEntry('ScrollCase', { randomPool: true, position: { x: 1, y: -2.43, z: 10 }, rotation: Math.PI / 6 }),
        factoryEntry('MagnifyingGlass', { randomPool: true, position: { x: 9, y: -2.75, z: -14 }, rotation: Math.PI / 3 }),
        factoryEntry('Rope', { randomPool: true, position: { x: 6, y: -2.75, z: -15 }, rotation: Math.PI / 6 }),
        factoryEntry('Candelabra', {
            randomPool: true,
            name: 'CandelabraFront',
            factoryName: 'Candelabra',
            position: { x: -8, y: -2.75, z: 12 },
            rotation: Math.PI / 4,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('candelabra2', result.update)
        }),
        factoryEntry('Goblet', { randomPool: true, position: { x: 5, y: -2.75, z: 12 }, rotation: 0 }),
        factoryEntry('Crossbow', { randomPool: true, position: { x: -8, y: -2.75, z: -2 }, rotation: Math.PI / 4 }),
        factoryEntry('Waterskin', { randomPool: true, position: { x: 7, y: -2.75, z: 2 }, rotation: Math.PI / 6 }),
        factoryEntry('Astrolabe', {
            randomPool: true,
            position: { x: 10, y: -2.75, z: -8 },
            rotation: Math.PI / 4,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('astrolabe', result.update)
        }),
        factoryEntry('Sundial', { randomPool: true, position: { x: 8, y: -2.75, z: 8 }, rotation: -Math.PI / 6 }),
        factoryEntry('AleKeg', { randomPool: true, position: { x: -16, y: -2.75, z: -10 }, rotation: Math.PI / 4 }),
        factoryEntry('Flute', { randomPool: true, name: 'FluteBack', factoryName: 'Flute', position: { x: -16, y: -2.75, z: -10 }, rotation: Math.PI / 4, afterCreate: (result) => result?.interact && registerInteractiveObject(result.group, result.interact) }),
        factoryEntry('Flute', { randomPool: true, name: 'FluteFront', factoryName: 'Flute', position: { x: 2, y: -2.75, z: 14 }, rotation: -Math.PI / 8, afterCreate: (result) => result?.interact && registerInteractiveObject(result.group, result.interact) }),
        factoryEntry('Apple', { randomPool: true, position: { x: 13, y: -2.75, z: 7 }, rotation: Math.PI / 6 }),
        factoryEntry('PocketFlask', { randomPool: true, position: { x: -4, y: -2.75, z: 2 }, rotation: Math.PI / 4 }),
        factoryEntry('WoodenSpoon', { randomPool: true, position: { x: 10, y: -2.75, z: 12 }, rotation: Math.PI / 3 }),
        factoryEntry('Cauldron', { randomPool: true, position: { x: 12, y: -2.75, z: -4 }, rotation: 0 })
    ]
};

export const DECORATIVE_TIER_ENTRIES = [...TIER_PROP_DEFINITIONS.tier2, ...TIER_PROP_DEFINITIONS.tier3];

// ---------------------------------------------------------------------------
// Tagging, categories, and querying
// ---------------------------------------------------------------------------
//
// A descriptor index is built ONCE at module load (≈90 entries, trivial cost)
// so the query helpers below are cheap lookups and never touch the hot spawn
// loop. Each prop gets a `category` and a set of `tags`, either declared
// explicitly on the tier entry (`factoryEntry('X', { category, tags })`) or
// derived from the data already present (tier, randomPool, tabletop position,
// shadow policy). Adding a tag/category to an entry is a one-line change.

const FURNITURE_NAMES = new Set(['Bookshelf', 'Chair', 'Chest', 'Rug']);
const INTERACTIVE_NAMES = new Set(['Skull', 'Gong', 'Lamp', 'MysticOrb']);
const WALL_DECOR_NAMES = new Set(['Shield', 'BountyPoster', 'DecorativeWalls']);

// Central semantic tag groupings. Keyed by factory name so a prop can be tagged
// once here regardless of how many tier entries reference it. Merged with any
// `tags` declared on the entry itself.
const SEMANTIC_TAGS = {
    weapon: ['Dagger', 'Sword', 'Shield', 'BattleAxe', 'Warhammer', 'Crossbow', 'Helmet', 'Dart'],
    drinkware: ['Mug', 'Tankard', 'Goblet', 'Chalice', 'DrinkingHorn', 'AleKeg', 'Waterskin', 'PocketFlask'],
    paper: ['Scroll', 'Map', 'PlayingCards', 'CharacterSheet', 'BountyPoster', 'ScrollCase', 'LeatherJournal', 'WritingSet', 'DMScreen', 'Spellbook'],
    light: ['Lantern', 'Candelabra', 'FloatingCandles'],
    magic: ['CrystalBall', 'MysticOrb', 'Wand', 'Runestones', 'Spellbook', 'Amulet', 'DragonScale', 'PotionSet'],
    treasure: ['Coin', 'CoinPouch', 'Gemstones', 'Crown', 'Chalice', 'Amulet', 'Bone'],
    food: ['TavernMeal', 'CheeseWheel', 'Apple'],
    game: ['PlayingCards', 'TarotDeck', 'DiceTower', 'DiceTray', 'DiceJail', 'DiceBag'],
    tool: ['Compass', 'Spyglass', 'MagnifyingGlass', 'Astrolabe', 'Sundial', 'Abacus', 'Lockpicks', 'Key', 'Padlock', 'PocketWatch', 'Spectacles', 'Rope']
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
const indexByName = new Map();      // entry.name -> descriptor
const indexByEntry = new Map();     // entry object -> descriptor
const indexByTag = new Map();       // tag -> descriptor[]
const indexByCategory = new Map();  // category -> descriptor[]

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
            position: entry.position ?? null
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

// Deterministic, seedable PRNG (mulberry32-style). Shared so query-based
// selection and the legacy decor selection produce identical sequences.
function createPoolRng(seed) {
    let state = ((seed ?? 1) >>> 0) + 0x9E3779B9;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
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
 * exactly.
 */
export function getRandomProps({
    count = 0,
    tiers = null,
    tags = null,
    category = null,
    exclude = [],
    seed = 1,
    theme = 'default',
    randomPoolOnly = true
} = {}) {
    const excludeSet = new Set(exclude);
    const tierSet = tiers ? new Set(tiers) : null;
    const tagList = tags ?? null;

    const pool = PROP_INDEX.filter((d) => {
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
        sortKey: rng() / getDecorThemeWeight(d.entry, theme)
    }));
    weighted.sort((a, b) => a.sortKey - b.sortKey);
    const limit = count > 0 ? count : weighted.length;
    return weighted.slice(0, limit).map((item) => item.entry);
}

/**
 * Backward-compatible decor selection used by `spawnTierWithRandomPool`. The
 * `entries` argument is retained for API stability; selection now flows through
 * `getRandomProps` over the shared descriptor index (whose randomPool subset is
 * exactly the randomPool subset of DECORATIVE_TIER_ENTRIES, in the same order),
 * so output is bit-identical to the previous implementation.
 */
/** @param {{seed?: number, theme?: string}} [options] */
export function selectDecorPoolEntries(entries, maxRandom, options = {}) {
    const { seed, theme = 'default' } = options;
    return getRandomProps({ count: Math.max(0, maxRandom), seed, theme });
}

// Test/debug hook: `?forceProps=Flute,PlayingCards` guarantees those randomPool
// props spawn regardless of seed, so e2e tests can target their interactions
// deterministically. Has no effect on normal play.
function getForcedProps() {
    try {
        const raw = new URLSearchParams(window.location.search).get('forceProps');
        return raw ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)) : null;
    } catch {
        return null;
    }
}

/** @param {{seed?: number, theme?: string}} [options] */
export async function spawnTierWithRandomPool(entries, maxRandom, context, options = {}) {
    const { seed, theme } = options;
    const always = entries.filter((entry) => !entry.randomPool);
    const selected = selectDecorPoolEntries(entries, maxRandom, { seed: seed ?? context.layoutConfig?.seed, theme: theme ?? context.layoutConfig?.theme });

    const forced = getForcedProps();
    if (forced) {
        const isSelected = (entry) => selected.includes(entry);
        for (const entry of entries) {
            if (!entry.randomPool) continue;
            const name = entry.factoryName || entry.name;
            if ((forced.has(name) || forced.has(entry.name)) && !isSelected(entry)) {
                selected.push(entry);
            }
        }
    }

    const records = [];

    for (const entry of always) {
        await spawnProp(entry, context);
    }

    for (const entry of selected) {
        const record = await spawnProp(entry, context);
        records.push(record);
    }

    return records;
}

export async function spawnProp(entry, context) {
    const factoryName = entry.factoryName || entry.name;
    let result;
    let updateHandle = null;
    const previousRegisterUpdate = context.registerUpdate;

    context.registerUpdate = (name, update, priority = 0) => {
        if (!update) return null;
        updateHandle = previousRegisterUpdate(name, update, priority);
        return updateHandle;
    };

    if (entry.call) {
        result = await entry.call(context);
    } else if (entry.position) {
        result = await getPropFactory(factoryName)(
            context.scene,
            context.physicsWorld,
            resolveEntryPosition(entry),
            entry.rotation ?? 0
        );
    } else {
        result = await getPropFactory(factoryName)(context.scene, context.physicsWorld);
    }

    if (entry.afterCreate) {
        entry.afterCreate(result, context);
    }

    context.registerUpdate = previousRegisterUpdate;

    if (entry.shadow === 'off' || SHADOW_DISABLED_PROP_NAMES.has(factoryName)) {
        applyShadowPolicyToResult(result, false);
    } else if (entry.shadow !== 'on') {
        applyFarShadowLOD(result);
    }

    const root = resolveRootObject(result);
    if (root && context.cullingSystem && entry.cull !== false) {
        context.cullingSystem.register(root, { important: entry.important === true });
    }

    const canStaticMerge = entry.staticMerge !== false
        && !updateHandle
        && !INTERACTIVE_NAMES.has(factoryName);
    let mergeStats = null;
    if (canStaticMerge) {
        mergeStats = mergePropRecord({ result, updateHandle });
        if (mergeStats.merged && context.cullingSystem && root) {
            context.cullingSystem.refreshSphere(root);
        }
    }

    const disposers = typeof result?.dispose === 'function' ? [result.dispose] : undefined;
    return { entry, result, updateHandle, disposers, mergeStats };
}

export function despawnProp(record, context) {
    const root = resolveRootObject(record?.result);
    if (root) {
        context.cullingSystem?.unregister(root);
        // Drop any raycast interaction registered against this prop's root so a
        // re-rolled layout doesn't leave stale clickable entries behind.
        unregisterInteractiveObject(root);
    }
    disposePropSpawn(record, context.physicsWorld);
}
