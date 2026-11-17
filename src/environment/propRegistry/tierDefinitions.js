import { TAVERN_SCENE } from '../../scenes/tavern';
import { compileScene } from './sceneCompile';

/**
 * The tavern's tier entries, compiled from `src/scenes/tavern.ts`. The scene is
 * data; the `call` / `afterCreate` special cases live in `propHooks.js`. These
 * exports stay the prop *catalogue's* view (tags, categories, the unit tests);
 * the scene actually being loaded comes from `compileScene(sceneDocument)`.
 */
const tavern = compileScene(TAVERN_SCENE);

export const TIER_PROP_DEFINITIONS = {
    tier0: tavern.tier0,
    tier1: tavern.tier1,
    tier2: tavern.tier2,
    tier3: tavern.tier3,
};

export const DECORATIVE_TIER_ENTRIES = tavern.decorative;
