import type { PhysicsPreset } from 'dice-core/types/physicsPresets';

export type DieTypeId = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export interface SpawnedDie {
    mesh: import('three').Mesh;
    type: string;
    wasmId?: number | null;
    /**
     * Mirrors the engine's kinematic flag, written only by `setDieWasmKinematic`
     * (the one door every grab, cup, tray and jail goes through). A kinematic
     * die is held by something — a throw with no explicit id list skips it.
     */
    kinematic?: boolean;
    physicsPreset?: PhysicsPreset;
    audioBodyId?: number;
    inertiaScalar?: number;
    role?: 'tens' | 'ones' | null;
    groupIndex?: number;
    dieIndex?: number;
    explode?: boolean;
}

export type DiceModelTemplate = import('three').Mesh;

export interface DiceReadValue {
    type: string;
    value: number | null;
    role?: 'tens' | 'ones' | null;
    groupIndex?: number;
    dieIndex?: number;
}
