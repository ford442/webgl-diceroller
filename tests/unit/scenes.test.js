import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const engine = { init: vi.fn() };
vi.mock('../../src/wasm/PhysicsBridge.js', () => ({
    loadWasmEngine: vi.fn(async () => true),
    isWasmAvailable: vi.fn(() => true),
    getWasmEngine: vi.fn(() => engine),
    setPhysicsHidden: vi.fn(),
    createWasmTableBounds: vi.fn(),
}));

const registry = await import('../../src/environment/PropRegistry.js');
const { TIER_PROP_DEFINITIONS, DECORATIVE_TIER_ENTRIES, PROP_INDEX, PROP_FACTORIES } = registry;
const { compileScene, getRandomProps, selectDecorPoolEntries } = registry;
const { SCENES, SCENE_IDS, DEFAULT_SCENE_ID, getSceneDocument, resolveSceneDocument } =
    await import('../../src/scenes/index');
const { validateSceneDocument, propId } = await import('../../src/scenes/SceneDocument');
const { TAVERN_SCENE } = await import('../../src/scenes/tavern');
const { CHART_ROOM_SCENE } = await import('../../src/scenes/chartRoom');
const { LIGHTING_PRESETS, LIGHTING_PRESET_IDS, getLightingPreset } =
    await import('../../src/core/LightingPresets');
const { bootstrapPhysics } = await import('../../src/app/PhysicsBootstrap.js');

const options = {
    factories: new Set(Object.keys(PROP_FACTORIES)),
    lightingIds: LIGHTING_PRESET_IDS,
};

afterEach(() => {
    vi.restoreAllMocks();
    engine.init.mockClear();
});

/** What a tier entry means to the spawn path, minus the closures. */
function project(tier, entry, index) {
    const { name, factoryName, position, rotation, randomPool, cull } = entry;
    return {
        tier,
        index,
        name,
        factoryName: factoryName ?? null,
        position: position ?? null,
        rotation: rotation ?? null,
        randomPool: randomPool ?? null,
        cull: cull ?? null,
    };
}

describe('the tavern, extracted to a document', () => {
    const golden = JSON.parse(
        readFileSync(resolve(process.cwd(), 'tests/golden/tavern-entries.json'), 'utf8')
    );

    it('spawns the same props in the same order as the hand-written tier lists', () => {
        const actual = [];
        for (const [tier, list] of Object.entries(TIER_PROP_DEFINITIONS)) {
            list.forEach((entry, index) => actual.push(project(tier, entry, index)));
        }
        const expected = golden.entries.map((e) =>
            project(e.tier, { ...e, factoryName: e.factoryName ?? undefined }, e.index)
        );
        expect(actual).toEqual(expected);
    });

    it('keeps the decor list order, which is each prop’s RNG slot', () => {
        expect(DECORATIVE_TIER_ENTRIES.map((e) => e.name)).toEqual(golden.decorativeOrder);
    });

    it('keeps every prop’s category and tags', () => {
        const actual = PROP_INDEX.map((d) => ({
            name: d.name,
            tier: d.tier,
            category: d.category,
            tags: [...d.tags].sort(),
        }));
        expect(actual).toEqual(golden.index);
    });

    it('hangs the lamp from the ceiling and puts the bell on the table by document pose', () => {
        const lamp = TIER_PROP_DEFINITIONS.tier1.find((e) => e.name === 'Lamp');
        const bell = TIER_PROP_DEFINITIONS.tier2.find((e) => e.name === 'Bell');
        expect(lamp.position).toEqual({ x: 0, y: 38, z: 0 });
        expect(typeof lamp.call).toBe('function');
        expect(bell.position).toEqual({ x: 0, y: -2.75, z: 15 });
        expect(typeof bell.call).toBe('function');
    });

    it('carries the physics numbers that used to be literals in PhysicsBootstrap', () => {
        expect(TAVERN_SCENE.gravity).toBe(-15);
        expect(TAVERN_SCENE.table).toEqual({ y: -2.75, halfW: 18, halfD: 18 });
    });

    it('compiles once: the same document yields the same entry objects', () => {
        expect(compileScene(TAVERN_SCENE)).toBe(compileScene(TAVERN_SCENE));
        expect(compileScene(TAVERN_SCENE).tier0[0]).toBe(TIER_PROP_DEFINITIONS.tier0[0]);
    });
});

describe('validateSceneDocument', () => {
    it('accepts every registered scene against the real factories and presets', () => {
        for (const id of SCENE_IDS) {
            expect(validateSceneDocument(SCENES[id], options), id).toEqual([]);
        }
    });

    it('keys every scene by its own id', () => {
        for (const [key, doc] of Object.entries(SCENES)) expect(doc.id).toBe(key);
    });

    const bad = (patch) => ({ ...TAVERN_SCENE, ...patch });
    const withProps = (...extra) => bad({ props: [...TAVERN_SCENE.props, ...extra] });

    it.each([
        [
            'an unknown factory',
            withProps({ factory: 'Nope', tier: 2 }),
            /no prop factory named "Nope"/,
        ],
        ['a duplicate id', withProps({ factory: 'Mug', tier: 2 }), /duplicate id/],
        [
            'randomPool on a tier-1 prop',
            withProps({ factory: 'Coin', tier: 1, randomPool: true }),
            /randomPool only applies/,
        ],
        [
            'a non-finite position',
            withProps({ factory: 'Coin', tier: 2, id: 'C2', position: { x: NaN, y: 0, z: 0 } }),
            /position must be finite/,
        ],
        [
            'a bad scale',
            withProps({ factory: 'Coin', tier: 2, id: 'C2', scale: 0 }),
            /scale must be/,
        ],
        ['an out-of-range tier', withProps({ factory: 'Coin', tier: 7, id: 'C2' }), /tier must be/],
        ['upward gravity', bad({ gravity: 15 }), /gravity must be/],
        ['an empty table', bad({ table: { y: 0, halfW: 0, halfD: 18 } }), /halfW/],
        ['an unknown lighting preset', bad({ lighting: 'noon' }), /unknown lighting preset "noon"/],
        [
            'no table prop',
            bad({ props: TAVERN_SCENE.props.filter((p) => p.factory !== 'Table') }),
            /exactly one "Table"/,
        ],
        ['a non-kebab id', bad({ id: 'Chart Room' }), /kebab-case/],
        ['no props', bad({ props: [] }), /non-empty/],
    ])('rejects %s', (_label, doc, message) => {
        expect(validateSceneDocument(doc, options).join('\n')).toMatch(message);
    });

    it('does not throw on a malformed document', () => {
        expect(() => validateSceneDocument(/** @type {any} */ ({}), options)).not.toThrow();
        expect(validateSceneDocument(/** @type {any} */ ({}), options).length).toBeGreaterThan(0);
    });

    it('compileScene refuses an invalid document with every problem listed', () => {
        const doc = bad({ lighting: 'noon', gravity: 3 });
        expect(() => compileScene(doc)).toThrow(/Invalid scene document[\s\S]*gravity[\s\S]*noon/);
    });
});

describe('choosing a scene', () => {
    it('defaults to the tavern', () => {
        expect(DEFAULT_SCENE_ID).toBe('tavern');
        expect(resolveSceneDocument('')).toBe(TAVERN_SCENE);
        expect(resolveSceneDocument('?test&webgl')).toBe(TAVERN_SCENE);
    });

    it('loads a known scene by ?scene=', () => {
        expect(resolveSceneDocument('?scene=chart-room')).toBe(CHART_ROOM_SCENE);
        expect(resolveSceneDocument(new URLSearchParams('scene=tavern'))).toBe(TAVERN_SCENE);
        expect(getSceneDocument(' Chart-Room ')).toBe(CHART_ROOM_SCENE);
    });

    it('falls back to the tavern and logs for an unknown id', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(resolveSceneDocument('?scene=moon-base')).toBe(TAVERN_SCENE);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown scene "moon-base"'));
    });

    it('does not resolve inherited object keys as scenes', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(getSceneDocument('constructor')).toBe(TAVERN_SCENE);
        expect(getSceneDocument('__proto__')).toBe(TAVERN_SCENE);
    });
});

describe('physics bounds come from the document', () => {
    it('initialises the engine with the tavern’s numbers by default', async () => {
        await bootstrapPhysics(/** @type {any} */ ({ physics: {} }), TAVERN_SCENE);
        expect(engine.init).toHaveBeenCalledWith(-15, -2.75, 18, 18);
    });

    it('initialises the engine with whatever the loaded document says', async () => {
        const doc = { ...CHART_ROOM_SCENE, gravity: -9.81, table: { y: -1, halfW: 12, halfD: 7 } };
        await bootstrapPhysics(/** @type {any} */ ({ physics: {} }), doc);
        expect(engine.init).toHaveBeenCalledWith(-9.81, -1, 12, 7);
    });
});

describe('the second scene', () => {
    const chart = compileScene(CHART_ROOM_SCENE);

    it('is built from catalogue factories, with no TavernWalls and no new geometry', () => {
        const factories = CHART_ROOM_SCENE.props.map((p) => p.factory);
        expect(factories).not.toContain('TavernWalls');
        for (const name of ['Table', 'DiceCup', 'DiceTower', 'DiceTray', 'DiceJail']) {
            expect(factories).toContain(name);
        }
        for (const factory of factories) expect(PROP_FACTORIES[factory]).toBeTypeOf('function');
    });

    it('wires the dice furniture through the same named hooks as the tavern', () => {
        for (const name of ['DiceCup', 'DiceTower', 'DiceTray', 'DiceJail']) {
            const entry = chart.decorative.find((e) => e.name === name);
            expect(entry, name).toBeTruthy();
            expect(entry.afterCreate, name).toBeTypeOf('function');
            expect(entry.randomPool).toBeUndefined();
        }
        expect(chart.tier0.find((e) => e.name === 'Table').call).toBeTypeOf('function');
    });

    it('draws its decor pool from its own list, never the tavern’s', () => {
        const names = new Set(chart.decorative.map((e) => e.name));
        for (const seed of [1, 7, 4242]) {
            const picked = selectDecorPoolEntries(chart.decorative, 6, { seed, theme: 'default' });
            expect(picked.length).toBeGreaterThan(0);
            for (const entry of picked) {
                expect(names.has(entry.name), `${entry.name} is a chart-room prop`).toBe(true);
                expect(chart.decorative).toContain(entry);
            }
        }
    });

    it('seeds the same draw twice and a different draw for another seed', () => {
        const draw = (seed) =>
            selectDecorPoolEntries(chart.decorative, 5, { seed, theme: 'default' }).map(
                (e) => e.name
            );
        expect(draw(11)).toEqual(draw(11));
        expect(draw(11)).not.toEqual(draw(12));
    });

    it('uses a lighting preset with no moon, and no tavern geometry', () => {
        expect(getLightingPreset(CHART_ROOM_SCENE.lighting).moon).toBeNull();
        expect(getLightingPreset(TAVERN_SCENE.lighting).moon).not.toBeNull();
    });
});

describe('decor selection', () => {
    it('is unchanged for the tavern: the scene-list draw equals the catalogue draw', () => {
        for (const seed of [1, 99, 0xdec0 + 5]) {
            for (const theme of ['default', 'wizard', 'battle']) {
                for (const count of [4, 9, 15]) {
                    const viaScene = selectDecorPoolEntries(DECORATIVE_TIER_ENTRIES, count, {
                        seed,
                        theme,
                    }).map((e) => e.name);
                    const viaCatalogue = getRandomProps({ count, seed, theme }).map((e) => e.name);
                    expect(viaScene).toEqual(viaCatalogue);
                }
            }
        }
    });
});

describe('lighting presets', () => {
    it('keeps the tavern rig’s numbers', () => {
        const tavern = LIGHTING_PRESETS['tavern-night'];
        expect(tavern.candle).toEqual({ color: 0xff9933, intensity: 2.2, distance: 22 });
        expect(tavern.moon).toEqual({ color: 0x5566bb, intensity: 2.2 });
        expect(tavern.fog).toEqual({ color: 0x111111, density: 0.015 });
        expect(tavern.diceZone.intensity).toBe(2.8);
        expect(tavern.ambient.intensity).toEqual({ webgl: 0.09, webgpu: 0.16 });
    });

    it('falls back to the tavern rig for an unknown id', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(getLightingPreset('noon')).toBe(LIGHTING_PRESETS['tavern-night']);
        expect(getLightingPreset(undefined)).toBe(LIGHTING_PRESETS['tavern-night']);
    });

    it('is named by every scene', () => {
        for (const doc of Object.values(SCENES)) {
            expect(LIGHTING_PRESET_IDS.has(doc.lighting)).toBe(true);
        }
        expect(propId({ factory: 'Chair', tier: 1, id: 'ChairRight' })).toBe('ChairRight');
    });
});
