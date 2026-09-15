/**
 * Headless dice core: WASM loader, worker/in-process bridges, notation,
 * shareable dice sets, and `rollHeadless()`. This graph must stay free of
 * Three.js and of `document` / `window` module imports.
 */

export { publicAssetUrl, resolvePublicAssetUrl } from './publicAssetUrl.js';

export {
    DICE_SET_VERSION,
    DIE_SHAPE_FACE_COUNT,
    DIE_SHAPE_IDS,
    DIE_TYPE_CATALOG,
    canonicalizeDiceSet,
    computeDiceSetId,
    createDefaultDiceSet,
    createDefaultEntry,
    normalizeDiceSet,
    resolveFaceValue,
    withComputedId,
    type DiceSet,
    type DiceSetEntry,
    type DieShapeId,
} from './dice/DiceSetFormat.js';

export {
    DICE_SET_PARAM,
    decodeDiceSet,
    encodeDiceSet,
    type DiceSetPresencePayload,
} from './dice/ShareableDiceSet.js';

export {
    NotationError,
    parseNotation,
    evaluateRoll,
    buildSpawnSpecs,
    DEFAULT_ROLL_SYSTEM,
} from './roll/Notation.js';

export { createRollSession, isNotationRollActive } from './roll/RollSession.js';

export {
    applyThrowParams,
    computeSeededThrowParams,
    createSeededRng,
    type SeededDieRef,
    type SeededThrowParam,
} from './wasm/seededThrowParams.js';

export { PHYSICS_FLAG_NO_DRAG, parsePhysicsFlags } from './wasm/physicsFlags.js';

export {
    WASM_SCALAR_DIR,
    WASM_SIMD_DIR,
    getPhysicsSearchParams,
    instantiateDicePhysicsModule,
    resolveWasmArtifactDir,
} from './wasm/wasmArtifact.js';

export { supportsWasmSimd, WASM_SIMD_PROBE_BYTES } from './wasm/simdSupport.js';

export { loadSolverBuildId, getSolverBuildId } from './wasm/SolverBuildId.js';

export {
    createInProcessPhysicsSession,
    loadWasmEngine,
    isWasmAvailable,
    getWasmEngine,
} from './wasm/WasmPhysicsBridge.js';

export {
    DIE_PHYSICS_PRESETS,
    PHYSICS_GRAVITY,
    PHYSICS_TABLE_HALF,
    PHYSICS_TABLE_Y,
    THROW_TABLE_SURFACE_Y,
} from './wasm/physicsPresets.js';

export {
    rollHeadless,
    wasmArtifactsPresent,
    defaultPublicDir,
    createNodeAssetUrl,
    type HeadlessRollResult,
    type HeadlessRollTrace,
    type HeadlessDieResult,
    type RollHeadlessOptions,
} from './rollHeadless.js';

export { createCommit, generateNonce, verifyReveal, commitHash } from './net/CommitReveal.js';
