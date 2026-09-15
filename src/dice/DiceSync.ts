import type { Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { SpawnedDie } from '../types/dice.js';
import type { CollisionEvent } from '../types/physics.js';
import { getWasmEngine, pollCollisionEvents } from '../wasm/PhysicsBridge.js';
import { spawnedDice } from './DiceState.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';
import { findSpawnedDieByMesh } from './DiceLookup.js';
import { getWasmTransformForDie, WASM_TRANSFORM_STRIDE } from './DiceTransformRead.js';

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

interface SyncOptions {
    position?: Vector3 | Vec3;
    quaternion?: Quaternion | { x: number; y: number; z: number; w: number };
    linearVelocity?: Vec3 | null;
    angularVelocity?: Vec3 | null;
}

function syncWasmTransformForDie(die: SpawnedDie, options: SyncOptions = {}): void {
    if (!isUsingWasmPhysics() || die?.wasmId == null) return;

    const {
        position = die.mesh.position,
        quaternion = die.mesh.quaternion,
        linearVelocity = null,
        angularVelocity = null,
    } = options;

    const engine = getWasmEngine();
    engine.setDieTransform(
        die.wasmId,
        position.x,
        position.y,
        position.z,
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w
    );

    if (linearVelocity || angularVelocity) {
        engine.setDieVelocity(
            die.wasmId,
            linearVelocity?.x ?? 0,
            linearVelocity?.y ?? 0,
            linearVelocity?.z ?? 0,
            angularVelocity?.x ?? 0,
            angularVelocity?.y ?? 0,
            angularVelocity?.z ?? 0
        );
    }
}

export const updateDiceVisuals = (): void => {
    if (!isUsingWasmPhysics()) return;

    const transforms = getWasmEngine().getTransforms();
    const ids =
        typeof getWasmEngine().getDieIds === 'function' ? getWasmEngine().getDieIds() : null;

    spawnedDice.forEach((die) => {
        if (die.wasmId == null) return;

        let offset = -1;
        if (ids?.length) {
            for (let i = 0; i < ids.length; i++) {
                if (Math.round(ids[i] ?? 0) === die.wasmId) {
                    offset = i * WASM_TRANSFORM_STRIDE;
                    break;
                }
            }
        } else {
            offset = spawnedDice.indexOf(die) * WASM_TRANSFORM_STRIDE;
        }

        if (offset < 0 || offset + (WASM_TRANSFORM_STRIDE - 1) >= transforms.length) return;

        die.mesh.position.set(
            transforms[offset + 0] ?? 0,
            transforms[offset + 1] ?? 0,
            transforms[offset + 2] ?? 0
        );
        die.mesh.quaternion.set(
            transforms[offset + 3] ?? 0,
            transforms[offset + 4] ?? 0,
            transforms[offset + 5] ?? 0,
            transforms[offset + 6] ?? 0
        );
    });
};

export const syncDieMeshStateToWasm = (mesh: Object3D): void => {
    const die = findSpawnedDieByMesh(mesh);
    if (!die) return;
    syncWasmTransformForDie(die);
};

export const applyWasmImpulseForDie = (
    mesh: Object3D,
    impulse: Vec3 | null | undefined,
    torque: Vec3 | null | undefined
): void => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;

    const engine = getWasmEngine();
    if (impulse) {
        engine.applyImpulse(die.wasmId, impulse.x, impulse.y, impulse.z);
    }
    if (torque) {
        engine.applyTorqueImpulse(die.wasmId, torque.x, torque.y, torque.z);
    }
};

export const driveDieWasmTransform = (
    mesh: Object3D,
    position: Vector3 | Vec3,
    quaternion: Quaternion | { x: number; y: number; z: number; w: number }
): void => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    syncWasmTransformForDie(die, { position, quaternion });
};

let _warnedMissingKinematic = false;

export const setDieWasmKinematic = (mesh: Object3D, kinematic: boolean): void => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    const engine = getWasmEngine();
    if (typeof engine.setDieKinematic === 'function') {
        engine.setDieKinematic(die.wasmId, kinematic);
        return;
    }

    if (!_warnedMissingKinematic) {
        _warnedMissingKinematic = true;
        console.warn(
            '[DiceSync] WASM engine lacks setDieKinematic — rebuild with `npm run build:wasm`. ' +
                'Falling back to velocity clamping for held dice.'
        );
    }
    if (kinematic) {
        engine.setDieVelocity(die.wasmId, 0, 0, 0, 0, 0, 0);
    }
};

export const setDieWasmVelocity = (
    mesh: Object3D,
    linear: Vec3 | null = null,
    angular: Vec3 | null = null
): void => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    getWasmEngine().setDieVelocity(
        die.wasmId,
        linear?.x ?? 0,
        linear?.y ?? 0,
        linear?.z ?? 0,
        angular?.x ?? 0,
        angular?.y ?? 0,
        angular?.z ?? 0
    );
};

export const getDieWasmTransform = (mesh: Mesh | Object3D) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return null;
    return getWasmTransformForDie(die.wasmId);
};

export const pollPhysicsCollisionEvents = (): Array<CollisionEvent & { otherSurface?: string }> => {
    const SURFACES = ['default', 'velvet', 'wood', 'metal', 'leather'] as const;
    return pollCollisionEvents().map((ev) => {
        if (ev.materialTag != null && ev.materialTag > 0) {
            return {
                ...ev,
                otherSurface: SURFACES[ev.materialTag] ?? 'default',
            };
        }
        if (ev.idB <= -2000) {
            return { ...ev, otherSurface: SURFACES[ev.materialTag ?? 0] ?? 'default' };
        }
        if (ev.idB <= -100) {
            return { ...ev, otherSurface: 'leather' };
        }
        if (ev.idB === -1) {
            return { ...ev, otherSurface: 'velvet' };
        }
        return ev;
    });
};
