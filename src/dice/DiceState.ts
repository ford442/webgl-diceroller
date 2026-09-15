/** Shared mutable dice runtime state (templates, spawned set, mesh pool). */

import type { Mesh } from 'three';
import type { DiceModelTemplate, SpawnedDie } from '../types/dice.js';

export const diceModels: Record<string, DiceModelTemplate> = {};

export let spawnedDice: SpawnedDie[] = [];

export let nextAudioBodyId = 1;

export const diceMeshPool: Record<string, Mesh[]> = {};

export function clearSpawnedDice(): void {
    spawnedDice = [];
}

export function allocateAudioBodyId(): number {
    return nextAudioBodyId++;
}

export const diceTypes = [
    { type: 'd4', file: 'dice/die_4.glb' },
    { type: 'd6', file: 'dice/die_6.glb' },
    { type: 'd8', file: 'dice/die_8.glb' },
    { type: 'd10', file: 'dice/die_10.glb' },
    { type: 'd12', file: 'dice/die_12.glb' },
    { type: 'd20', file: 'dice/die_20.glb' },
] as const;
