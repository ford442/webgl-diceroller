import { registerInteractiveObject } from '../interaction.js';

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

const factoryEntry = (name, options = {}) => ({ name, ...options });

const tier1Position = { x: 0, y: 32, z: 0 };

export const SHADOW_DISABLED_PROP_NAMES = new Set([
    'Dart', 'Bell', 'Pencil', 'Key', 'CoinPouch', 'PocketFlask', 'Compass', 'WaxSeal',
    'PocketWatch', 'Dagger', 'PlayingCards', 'DragonScale', 'CharacterSheet', 'BountyPoster',
    'CheeseWheel', 'Runestones', 'Gemstones', 'WritingSet',
    'SmokingPipe', 'Crown', 'Chalice', 'Miniature', 'Scroll', 'Coin', 'Amulet', 'Abacus',
    'Padlock', 'Spectacles', 'Lockpicks', 'LeatherJournal', 'MagnifyingGlass', 'Rope',
    'Candelabra', 'Waterskin', 'Astrolabe', 'Sundial', 'Flute', 'Apple', 'WoodenSpoon',
    'Warhammer'
]);

function resolveRootObject(result) {
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

export const TIER_PROP_DEFINITIONS = {
    tier0: [
        factoryEntry('TavernWalls', {
            call: (ctx) => getPropFactory('TavernWalls')(ctx.scene, ctx.physicsWorld),
            afterCreate: (result, ctx) => {
                if (result?.fireplaceLight) ctx.state.fireplaceLight = result.fireplaceLight;
                if (result?.update) ctx.registerUpdate('walls', result.update);
            }
        }),
        factoryEntry('Room', {
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
            call: (ctx) => getPropFactory('Clutter')(ctx.scene, ctx.physicsWorld),
            afterCreate: (result, ctx) => {
                if (result?.flamePosition) ctx.callbacks.setCandleFlamePos?.(result.flamePosition);
                if (result?.update) ctx.registerUpdate('clutter', result.update);
            }
        }),
        factoryEntry('TarotDeck', {
            call: (ctx) => getPropFactory('TarotDeck')(ctx.scene, ctx.physicsWorld)
        })
    ],
    tier1: [
        factoryEntry('Bookshelf', { position: { x: -18, y: -10, z: 0 }, rotation: Math.PI / 2 }),
        factoryEntry('DecorativeWalls', { call: (ctx) => getPropFactory('DecorativeWalls')(ctx.scene, ctx.physicsWorld) }),
        factoryEntry('Chair', { position: { x: -14, y: -9.5, z: 6 }, rotation: Math.PI / 3 }),
        factoryEntry('Chair', { name: 'ChairRight', factoryName: 'Chair', position: { x: 14, y: -9.5, z: -6 }, rotation: -Math.PI / 3 }),
        factoryEntry('Chest', {
            position: { x: -10, y: -9.5, z: -18 },
            rotation: Math.PI / 8,
            afterCreate: (result, ctx) => result?.update && ctx.registerUpdate('chest', result.update)
        }),
        factoryEntry('Rug', { call: (ctx) => getPropFactory('Rug')(ctx.scene) }),
        factoryEntry('Atmosphere', { call: (ctx) => getPropFactory('Atmosphere')(ctx.scene) }),
        factoryEntry('Lamp', {
            call: async (ctx) => {
                const result = await getPropFactory('Lamp')();
                ctx.scene.add(result.group);
                result.group.position.set(tier1Position.x, tier1Position.y, tier1Position.z);
                return result;
            },
            afterCreate: (result, ctx) => {
                registerInteractiveObject(result.group, result.toggle);
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
        factoryEntry('DiceTower', { position: { x: 0, y: -3.0, z: -14 }, rotation: 0 }),
        factoryEntry('DiceTray', { position: { x: 12, y: -2.75, z: 10 }, rotation: Math.PI / 6 }),
        factoryEntry('DiceJail', { position: { x: -13, y: -2.75, z: -13 }, rotation: -Math.PI / 4 }),
        factoryEntry('DiceBag', { position: { x: -10, y: -1.95, z: 12 }, rotation: Math.PI / 8 }),
        factoryEntry('Bell', { randomPool: true, call: (ctx) => getPropFactory('Bell')(ctx.scene, { x: 0, y: -2.75, z: 15 }) }),
        factoryEntry('TavernMeal', { randomPool: true, position: { x: 14, y: -2.75, z: 5 }, rotation: -Math.PI / 6 }),
        factoryEntry('Hourglass', { randomPool: true, position: { x: 11, y: -1.75, z: -11 }, rotation: Math.PI / 12 }),
        factoryEntry('Map', { randomPool: true, position: { x: -14, y: -2.75, z: 0 }, rotation: Math.PI / 3 }),
        factoryEntry('Scroll', { randomPool: true, position: { x: 10, y: -2.4, z: 13 }, rotation: -Math.PI / 8 }),
        factoryEntry('CrystalBall', { randomPool: true, position: { x: 13, y: -2.75, z: -13 }, rotation: 0 }),
        factoryEntry('PotionSet', { randomPool: true, position: { x: -13, y: -2.75, z: -6 }, rotation: Math.PI / 5 }),
        factoryEntry('Skull', {
            position: { x: -11, y: -2.4, z: 11 },
            rotation: Math.PI / 6,
            afterCreate: (result) => result?.toggleGlow && registerInteractiveObject(result.group, result.toggleGlow)
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
                ctx.registerUpdate('mysticOrb', result.update);
            }
        }),
        factoryEntry('DMScreen', { randomPool: true, position: { x: 0, y: -2.75, z: -16 }, rotation: 0 }),
        factoryEntry('DragonScale', { randomPool: true, position: { x: -14, y: -2.75, z: 0 }, rotation: Math.PI / 3 }),
        factoryEntry('Spyglass', { randomPool: true, position: { x: 14, y: -2.75, z: 6 }, rotation: -Math.PI / 6 }),
        factoryEntry('PlayingCards', { randomPool: true, position: { x: -2, y: -2.75, z: 13 }, rotation: Math.PI / 8 }),
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
        factoryEntry('Flute', { randomPool: true, name: 'FluteBack', factoryName: 'Flute', position: { x: -16, y: -2.75, z: -10 }, rotation: Math.PI / 4 }),
        factoryEntry('Flute', { randomPool: true, name: 'FluteFront', factoryName: 'Flute', position: { x: 2, y: -2.75, z: 14 }, rotation: -Math.PI / 8 }),
        factoryEntry('Apple', { randomPool: true, position: { x: 13, y: -2.75, z: 7 }, rotation: Math.PI / 6 }),
        factoryEntry('PocketFlask', { randomPool: true, position: { x: -4, y: -2.75, z: 2 }, rotation: Math.PI / 4 }),
        factoryEntry('WoodenSpoon', { randomPool: true, position: { x: 10, y: -2.75, z: 12 }, rotation: Math.PI / 3 })
    ]
};

export async function spawnProp(entry, context) {
    const factoryName = entry.factoryName || entry.name;
    let result;

    if (entry.call) {
        result = await entry.call(context);
    } else if (entry.position) {
        result = await getPropFactory(factoryName)(
            context.scene,
            context.physicsWorld,
            entry.position,
            entry.rotation ?? 0
        );
    } else {
        result = await getPropFactory(factoryName)(context.scene, context.physicsWorld);
    }

    if (entry.afterCreate) {
        entry.afterCreate(result, context);
    }

    if (entry.shadow === 'off' || SHADOW_DISABLED_PROP_NAMES.has(factoryName)) {
        applyShadowPolicyToResult(result, false);
    }

    return result;
}
