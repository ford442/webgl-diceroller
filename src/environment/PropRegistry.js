/**
 * Prop registry — tier definitions, factory discovery, spawn helpers, and query API.
 *
 * Implementation is split under `propRegistry/`; this file re-exports the public
 * surface so existing imports from `./environment/PropRegistry.js` stay stable.
 */

export { PROP_FACTORIES, getPropFactory } from './propRegistry/factories.js';

export {
    SHADOW_DISABLED_PROP_NAMES,
    resolveRootObject,
    applyShadowPolicyToResult,
    applyFarShadowLOD,
} from './propRegistry/shadowPolicy.js';

export { TIER_PROP_DEFINITIONS, DECORATIVE_TIER_ENTRIES } from './propRegistry/tierDefinitions.js';

export {
    PROP_INDEX,
    getPropDescriptor,
    getPropsByTag,
    getPropsByCategory,
    getAllTags,
    getAllCategories,
    getClutterPool,
} from './propRegistry/propIndex.js';

export { getRandomProps, selectDecorPoolEntries } from './propRegistry/randomPool.js';

export { spawnProp, spawnTierWithRandomPool, despawnProp } from './propRegistry/spawn.js';
