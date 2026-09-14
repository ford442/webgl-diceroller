/** Shared mutable dice runtime state (templates, spawned set, mesh pool). */

/** @type {Record<string, import('../types/dice').DiceModelTemplate>} */
export const diceModels = {};

/** @type {import('../types/dice').SpawnedDie[]} */
export let spawnedDice = [];

export let nextAudioBodyId = 1;

/** @type {Record<string, import('three').Mesh[]>} */
export const diceMeshPool = {};

export function clearSpawnedDice() {
    spawnedDice = [];
}

export function allocateAudioBodyId() {
    return nextAudioBodyId++;
}

export const diceTypes = [
    { type: 'd4', file: 'dice/die_4.glb' },
    { type: 'd6', file: 'dice/die_6.glb' },
    { type: 'd8', file: 'dice/die_8.glb' },
    { type: 'd10', file: 'dice/die_10.glb' },
    { type: 'd12', file: 'dice/die_12.glb' },
    { type: 'd20', file: 'dice/die_20.glb' },
];
