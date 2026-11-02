/**
 * The collider world is a pure function of the layout seed (#369).
 *
 * A share link's `layout-seed` is only a replay contract if two clients that
 * spawn the same table register the same colliders. These tests spawn real
 * prop factories through the real spawn paths with `Math.random` rigged to
 * differ between runs, and require the colliders they hand the physics bridge
 * to be identical anyway.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

/** Every collider spec a prop hands the bridge, with the pose it was anchored at. */
const registered = [];
vi.mock('../../src/core/StaticColliderBridge.js', () => {
    const record = (kind) => (_world, anchor, spec) => {
        registered.push({
            kind,
            anchor: anchor?.name ?? '',
            position: anchor?.position?.toArray?.() ?? null,
            yaw: anchor?.rotation?.y ?? null,
            spec,
        });
        return { wasmId: registered.length };
    };
    return {
        createStaticCollider: record('static'),
        createDynamicCollider: record('dynamic'),
        flattenColliderSpecs: (spec) => [spec],
        destroyWasmStaticCollider: () => {},
        destroyWasmDynamicCollider: () => {},
    };
});

// The shared PBR sets are loaded by the renderer at boot; a headless test only
// needs something texture-shaped to hang on a material.
vi.mock('../../src/core/TexturePipeline.js', () => {
    const set = () => ({
        diffuse: new THREE.Texture(),
        roughness: new THREE.Texture(),
        bump: new THREE.Texture(),
        normal: new THREE.Texture(),
        ao: new THREE.Texture(),
    });
    return {
        getWoodTextures: set,
        getTableTextures: set,
        getBrickTextures: set,
        getLampTextures: set,
    };
});

const { spawnProp, DECORATIVE_TIER_ENTRIES, TIER_PROP_DEFINITIONS } =
    await import('../../src/environment/PropRegistry.js');
const { createRandomClutter } = await import('../../src/environment/RandomClutter.js');
const { withPropScope, derivePropSeed, propRng, getPropScope } =
    await import('../../src/environment/propRng.js');
const { createProp } = await import('../../src/environment/propKit.js');

/** A `Math.random` that is a different, repeatable sequence per `salt`. */
function riggedRandom(salt) {
    let state = (salt * 2654435761) >>> 0 || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    registered.length = 0;
});

/** Run `fn` with `Math.random` replaced, returning what it registered. */
async function collect(salt, fn) {
    registered.length = 0;
    vi.spyOn(Math, 'random').mockImplementation(riggedRandom(salt));
    await fn();
    vi.restoreAllMocks();
    return JSON.parse(JSON.stringify(registered));
}

function tierContext(layoutSeed) {
    return {
        scene: new THREE.Scene(),
        physicsWorld: null,
        layoutConfig: { seed: layoutSeed },
        callbacks: {},
        state: {},
        scheduler: null,
        cullingSystem: null,
        registerUpdate: () => null,
    };
}

describe('derivePropSeed / withPropScope', () => {
    it('is a pure function of (layout seed, key, slot, ordinal)', () => {
        const base = derivePropSeed(7, 'Mug', 3, 0);
        expect(derivePropSeed(7, 'Mug', 3, 0)).toBe(base);
        expect(derivePropSeed(8, 'Mug', 3, 0)).not.toBe(base);
        expect(derivePropSeed(7, 'Chair', 3, 0)).not.toBe(base);
        expect(derivePropSeed(7, 'Mug', 4, 0)).not.toBe(base);
        expect(derivePropSeed(7, 'Mug', 3, 1)).not.toBe(base);
    });

    it('hands each claim in a scope its own stream, and closes the scope after', () => {
        const draw = (rng) => [rng(), rng(), rng()];
        let first;
        let second;
        withPropScope({ layoutSeed: 5, key: 'Meal', slot: 2 }, () => {
            first = draw(propRng('Tankard'));
            second = draw(propRng('FoodPlate'));
            expect(getPropScope()?.claimed).toBe(2);
        });
        expect(first).not.toEqual(second);
        expect(getPropScope()).toBeNull();

        let again;
        withPropScope({ layoutSeed: 5, key: 'Meal', slot: 2 }, () => {
            again = draw(propRng('Tankard'));
        });
        expect(again).toEqual(first);
    });

    it('still gives a deterministic stream outside any scope', () => {
        vi.spyOn(Math, 'random').mockImplementation(riggedRandom(1));
        const a = propRng('Lone')();
        vi.spyOn(Math, 'random').mockImplementation(riggedRandom(2));
        const b = propRng('Lone')();
        expect(a).toBe(b);
    });
});

describe('createProp', () => {
    it('hands build and a collider function the same seeded rng', () => {
        const spawn = () =>
            withPropScope({ layoutSeed: 3, key: 'Probe', slot: 0 }, () => {
                let built;
                createProp(new THREE.Scene(), null, {
                    name: 'Probe',
                    build({ rng }) {
                        built = rng();
                    },
                    colliders: ({ rng }) => [
                        { type: 'box', halfExtents: [1 + rng(), 1, 1], offset: { x: built } },
                    ],
                });
            });
        const a = (() => (spawn(), JSON.parse(JSON.stringify(registered))))();
        registered.length = 0;
        spawn();
        expect(JSON.parse(JSON.stringify(registered))).toEqual(a);
        expect(a).toHaveLength(1);
    });

    it('names the group after the registry entry when the author did not', () => {
        const scene = new THREE.Scene();
        const { group } = withPropScope({ layoutSeed: 1, key: 'Anon', name: 'Anon' }, () =>
            createProp(scene, null, { build: () => {} })
        );
        expect(group.name).toBe('Anon');
    });
});

describe('the tier spawn path', () => {
    // Coin, Runestones and TavernMeal used to lay their colliders out with
    // Math.random, so the fixture changed on every run.
    const formerlyRandom = ['Coin', 'Runestones', 'TavernMeal'];

    for (const name of formerlyRandom) {
        it(`${name} registers the same colliders whatever Math.random does`, async () => {
            const entry = DECORATIVE_TIER_ENTRIES.find((e) => (e.factoryName || e.name) === name);
            expect(entry, `${name} is a tier entry`).toBeTruthy();
            const spawn = () => spawnProp(entry, tierContext(1234), { slot: 5 });

            const a = await collect(1, spawn);
            const b = await collect(2, spawn);
            expect(a.length).toBeGreaterThan(0);
            expect(b).toEqual(a);
        });

        it(`${name} lays out differently on a different layout seed`, async () => {
            const entry = DECORATIVE_TIER_ENTRIES.find((e) => (e.factoryName || e.name) === name);
            const a = await collect(1, () => spawnProp(entry, tierContext(1), { slot: 5 }));
            const b = await collect(1, () => spawnProp(entry, tierContext(2), { slot: 5 }));
            expect(b).not.toEqual(a);
        });
    }

    it('two instances of one prop in two slots do not share a scatter', async () => {
        const entry = DECORATIVE_TIER_ENTRIES.find((e) => e.name === 'Coin');
        const slotA = await collect(1, () => spawnProp(entry, tierContext(9), { slot: 0 }));
        const slotB = await collect(1, () => spawnProp(entry, tierContext(9), { slot: 1 }));
        expect(slotB).not.toEqual(slotA);
    });

    it('every tabletop tier entry is a pure function of the layout seed', async () => {
        const entries = [...TIER_PROP_DEFINITIONS.tier2, ...TIER_PROP_DEFINITIONS.tier3].filter(
            // Entries that take a custom `call` need app callbacks (dice
            // controllers, audio); their colliders are declared statically.
            (entry) => !(/** @type {any} */ (entry).call)
        );
        expect(entries.length).toBeGreaterThan(30);

        const failures = [];
        for (const [slot, entry] of entries.entries()) {
            const spawn = () => spawnProp(entry, tierContext(77), { slot });
            try {
                const a = await collect(11, spawn);
                const b = await collect(22, spawn);
                if (JSON.stringify(a) !== JSON.stringify(b))
                    failures.push(`${entry.name}: differs`);
            } catch (err) {
                failures.push(`${entry.name}: threw ${err?.message}`);
            }
        }
        expect(failures).toEqual([]);
    });
});

describe('the clutter spawn path', () => {
    it('rebuilds the same scatter and colliders from one layout seed', async () => {
        const options = { seed: 4242, count: 10, theme: 'default' };
        const spawn = () => {
            const result = createRandomClutter(new THREE.Scene(), null, options);
            return result.selectedIds;
        };

        let idsA;
        let idsB;
        const a = await collect(1, () => (idsA = spawn()));
        const b = await collect(2, () => (idsB = spawn()));
        expect(idsA).toEqual(idsB);
        expect(b).toEqual(a);
        expect(a.length).toBeGreaterThan(0);
    });

    it('names clutter groups after their factory, as the tier path does', async () => {
        const scene = new THREE.Scene();
        createRandomClutter(scene, null, { seed: 8, count: 10, density: 'high' });
        const names = new Set();
        scene.traverse((obj) => {
            if (obj.type === 'Group' && obj.name) names.add(obj.name);
        });
        // `asClutter(createMug)` → "Mug", never a clutter-only alias.
        expect([...names].some((n) => /^Enhanced|Prop$/.test(n))).toBe(false);
    });
});
