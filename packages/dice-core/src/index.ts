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

export {
    HOPPER_DROP_SPEED,
    HOPPER_LATERAL_KICK,
    HOPPER_SPIN,
    HOPPER_STACK_SPACING,
    applyDropParams,
    computeSeededHopperDropParams,
    identityHopperFrame,
    type SeededDropParam,
    type SeededHopperFrame,
} from './wasm/seededHopperDrop.js';

export { PHYSICS_FLAG_NO_DRAG, parsePhysicsFlags } from './wasm/physicsFlags.js';

export {
    WASM_SCALAR_DIR,
    WASM_SIMD_DIR,
    getPhysicsSearchParams,
    instantiateDicePhysicsModule,
    resolveWasmArtifactDir,
} from './wasm/wasmArtifact.js';

export { supportsWasmSimd, WASM_SIMD_PROBE_BYTES } from './wasm/simdSupport.js';

export {
    formatSolverBuildId,
    getSolverBuildId,
    loadSolverBuildId,
    loadWasmBuildInfo,
    type WasmBuildInfo,
} from './wasm/SolverBuildId.js';

export {
    AssetNotFoundError,
    fetchAssetSource,
    fsAssetSource,
    type AssetSource,
} from './assets/AssetSource.js';

export { SIM_FIXED_DT, SIM_MAX_CATCH_UP_TICKS, SimClock } from './wasm/SimClock.js';

export { HULL_TABLE_PATH, loadHullTable } from './wasm/hullTable.js';

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
    defaultHeadlessAssets,
    type HeadlessRollResult,
    type HeadlessRollTrace,
    type HeadlessDieResult,
    type RollHeadlessOptions,
} from './rollHeadless.js';

export { createCommit, generateNonce, verifyReveal, commitHash } from './net/CommitReveal.js';

export {
    IllegalActionError,
    createRngRoller,
    playGame,
    replayGame,
    type ActionLogEntry,
    type GamePolicy,
    type GameRoller,
    type GameRules,
    type Outcome,
    type PlayGameOptions,
    type PlayedGame,
    type SeatId,
    type SeededRng,
    type SettledRoll,
    type ThrowDie,
    type ThrowRequest,
} from './game/GameRules.js';

export {
    DEFAULT_FARKLE_CONFIG,
    FARKLE_DICE,
    bestFarkleScore,
    createFarkleRules,
    scoreFarkleKeep,
    type FarkleAction,
    type FarkleConfig,
    type FarkleDie,
    type FarklePhase,
    type FarkleState,
    type FarkleTurnResult,
} from './game/Farkle.js';

export { createFarkleBot, farkleRollStats, type FarkleRollStats } from './game/FarkleBot.js';

export { createHeadlessRoller } from './game/headlessRoller.js';
