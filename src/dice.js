/**
 * Dice module barrel — stable public API for main.js, interaction.js, and tests.
 * Implementation lives under src/dice/.
 */

export { spawnedDice } from './dice/DiceState.js';
export { diceModels, diceTypes, loadDiceModels } from './dice/DiceModels.js';
export {
    initDiceAppearance,
    getDiceAppearanceConfig,
    setDieTypeAppearance,
    setDiceAppearanceQualityProfile,
    refreshDiceAppearance,
    applyDicePresencePayload,
    buildDicePresencePayload,
} from './dice/DiceModels.js';

export { PHYSICS_PRESETS, applyDiceMassBiases } from './dice/DicePhysicsPresets.js';

export {
    readDiceValue,
    readAllDiceValues,
    getDiceValueDebugSnapshot,
    areDiceSettled,
    getSpawnedDiceCounts,
} from './dice/DiceResults.js';

export {
    spawnObjects,
    replaceDiceSet,
    clearDice,
    updateDiceSet,
    syncAllDiceToWasm,
} from './dice/DiceSpawn.js';

export {
    updateDiceVisuals,
    setDiePhysicsAuthority,
    prepareDieForAmmoInteraction,
    syncDieBodyStateToWasm,
    syncDieMeshStateToWasm,
    applyWasmImpulseForDie,
    driveDieWasmTransform,
    setDieWasmKinematic,
    setDieWasmVelocity,
    getDieWasmTransform,
    pollPhysicsCollisionEvents,
} from './dice/DiceSync.js';

export { throwDice, applyFlickImpulseToDice } from './dice/DiceThrow.js';

export {
    findSpawnedDieByMesh,
    findSpawnedDieByPhysicsId,
    enrichCollisionEventForAudio,
} from './dice/DiceLookup.js';
