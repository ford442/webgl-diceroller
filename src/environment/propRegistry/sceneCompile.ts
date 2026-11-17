/**
 * Compile a scene document into the tier entries `spawnProp` consumes.
 *
 * The document is data (`src/scenes/`); an entry is that data plus the named
 * hooks for its factory (`propHooks.js`). Compiling is the only place the two
 * meet, so `LoadingTiers` and `RandomLayout` never branch on a prop name.
 */
import { LIGHTING_PRESET_IDS } from '../../core/LightingPresets';
import {
    propId,
    validateSceneDocument,
    type SceneDocument,
    type SceneProp,
    type SceneTier,
} from '../../scenes/SceneDocument';
import { factoryEntry } from './entryHelpers.js';
import { PROP_FACTORIES } from './factories.js';
import { PROP_HOOKS } from './propHooks.js';

/** A spawnable entry (the `factoryEntry` shape, open for `spawnProp`'s optional keys). */
export type TierEntry = { name: string; factoryName?: string; tier: string } & Record<string, any>;

export interface CompiledScene {
    tier0: TierEntry[];
    tier1: TierEntry[];
    tier2: TierEntry[];
    tier3: TierEntry[];
    /**
     * Tiers 2 + 3 in document order: the decor list. An entry's *slot* is its
     * index here, which keys its RNG stream, so the order is part of the
     * scene's collider-world contract.
     */
    decorative: TierEntry[];
}

function compileEntry(prop: SceneProp): TierEntry {
    const id = propId(prop);
    const hook = PROP_HOOKS[prop.factory];
    const entry: TierEntry = factoryEntry(id, {
        ...(id !== prop.factory ? { factoryName: prop.factory } : {}),
        tier: `tier${prop.tier}`,
        ...(prop.randomPool ? { randomPool: true } : {}),
        ...(prop.cull === false ? { cull: false } : {}),
        ...(prop.position ? { position: { ...prop.position } } : {}),
        ...(prop.rotationY !== undefined ? { rotation: prop.rotationY } : {}),
        ...(prop.scale !== undefined ? { scale: prop.scale } : {}),
    });
    if (hook?.create) {
        const create = hook.create;
        entry.call = (ctx: unknown) => create(ctx, entry);
    }
    if (hook?.afterCreate) {
        const afterCreate = hook.afterCreate;
        entry.afterCreate = (result: unknown, ctx: unknown) => afterCreate(result, ctx, entry);
    }
    return entry;
}

const compiled = new WeakMap<SceneDocument, CompiledScene>();

/**
 * Validate and compile `doc` once; later calls return the same entry objects,
 * which the prop index and the layout manager rely on for identity.
 * @throws if the document would build a broken table.
 */
export function compileScene(doc: SceneDocument): CompiledScene {
    const cached = compiled.get(doc);
    if (cached) return cached;

    const errors = validateSceneDocument(doc, {
        factories: new Set(Object.keys(PROP_FACTORIES)),
        lightingIds: LIGHTING_PRESET_IDS,
    });
    if (errors.length) {
        throw new Error(`Invalid scene document:\n  ${errors.join('\n  ')}`);
    }

    const tiers: Record<SceneTier, TierEntry[]> = { 0: [], 1: [], 2: [], 3: [] };
    for (const prop of doc.props) tiers[prop.tier].push(compileEntry(prop));

    const result: CompiledScene = {
        tier0: tiers[0],
        tier1: tiers[1],
        tier2: tiers[2],
        tier3: tiers[3],
        decorative: [...tiers[2], ...tiers[3]],
    };
    compiled.set(doc, result);
    return result;
}
