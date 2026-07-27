import type { AmmoRigidBody } from './ammo';
import type { PhysicsPreset } from './physicsPresets';

export type DieTypeId = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export interface SpawnedDie {
    mesh: import('three').Mesh;
    body?: AmmoRigidBody | null;
    type: string;
    wasmId?: number | null;
    physicsPreset?: PhysicsPreset;
    audioBodyId?: number;
    inertiaScalar?: number;
    centerOfMassOffset?: import('three').Vector3 | null;
    massBiasOffset?: import('three').Vector3 | null;
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
