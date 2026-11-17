import * as THREE from 'three';
import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { TABLE_SURFACE_Y } from '../core/SceneMetrics.js';
import { spawnedDice } from './DiceState.js';
import { isUsingWasmPhysics, getSecureRandom } from './DicePhysicsPresets.js';
import { applyWasmImpulseForDie } from './DiceSync.js';
import { selectThrowDice, type ThrowSelectionOptions } from './DiceThrowSelection.js';
import { forgetLastThrow, throwAndRecord } from './ThrowRecord.js';

const _flickForward = new THREE.Vector3();
const _flickRight = new THREE.Vector3();
const _flickImpulse = new THREE.Vector3();
const _flickTorque = new THREE.Vector3();
const MAX_FLICK_IMPULSE = 28;

export type ThrowDiceOptions = ThrowSelectionOptions;

/**
 * Throw dice. With no `ids`, every die that is not held (kinematic) is thrown:
 * the R key, a notation roll and a share-link replay all want the whole table.
 * With `ids` (physics body ids) exactly those dice are thrown and the rest are
 * left where they lie — a game re-throwing what it did not set aside.
 *
 * The throw's pose and kick for each die come from the seeded stream in table
 * order, so the same seed over the same dice set and the same `ids` lands the
 * same faces on every page.
 *
 * @param _scene unused — kept for call-site compatibility
 * @param _world unused — kept for call-site compatibility
 * @returns the physics ids of the dice that were thrown, in throw order
 */
export const throwDice = (
    _scene: unknown,
    _world: unknown,
    seed: number | null = null,
    options: ThrowDiceOptions = {}
): number[] => {
    const engine = isUsingWasmPhysics() ? getWasmEngine() : null;

    const useDeterministic = seed !== null;
    const targets = selectThrowDice(spawnedDice, options);
    const wasmDice = engine
        ? targets.filter(({ die }) => die.wasmId != null).map(({ id, index }) => ({ id, index }))
        : [];

    if (useDeterministic) {
        // One path for the worker and the in-process engine: the engine seeds,
        // draws and applies the throw, and captures the world it started from
        // so the roll theatre can seek it (ThrowRecord / replayThrow.ts).
        if (wasmDice.length > 0) {
            throwAndRecord({
                kind: 'throw',
                seed,
                dice: wasmDice,
                tableSurfaceY: TABLE_SURFACE_Y,
            });
        } else {
            forgetLastThrow();
        }
        return targets.map(({ id }) => id);
    }
    forgetLastThrow();

    const rand = getSecureRandom;
    targets.forEach(({ die, index }) => {
        if (!engine || die.wasmId == null) return;
        const x = (rand() - 0.5) * 4;
        const y = TABLE_SURFACE_Y + 6.75 + index * 0.5;
        const z = (rand() - 0.5) * 4;
        const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2)
        );
        const forceX = (rand() - 0.5) * 25;
        const forceY = rand() * 10 - 5;
        const forceZ = (rand() - 0.5) * 25;
        const spinX = (rand() - 0.5) * 100;
        const spinY = (rand() - 0.5) * 100;
        const spinZ = (rand() - 0.5) * 100;
        engine.setDieTransform(die.wasmId, x, y, z, q.x, q.y, q.z, q.w);
        engine.setDieVelocity(die.wasmId, 0, 0, 0, 0, 0, 0);
        engine.applyImpulse(die.wasmId, forceX, forceY, forceZ);
        engine.applyTorqueImpulse(die.wasmId, spinX, spinY, spinZ);
    });

    return targets.map(({ id }) => id);
};

export function applyFlickImpulseToDice(
    camera: any,
    velX: any,
    velY: any,
    { normOriginX = 0, normOriginY = 0 }: any = {}
) {
    if (!spawnedDice.length) return;

    camera.getWorldDirection(_flickForward);
    _flickForward.y = 0;
    if (_flickForward.lengthSq() < 1e-6) _flickForward.set(0, 0, -1);
    _flickForward.normalize();

    _flickRight.crossVectors(_flickForward, new THREE.Vector3(0, 1, 0)).normalize();
    _flickImpulse
        .copy(_flickRight)
        .multiplyScalar(velX * 0.04)
        .add(_flickForward.clone().multiplyScalar(-velY * 0.04));

    const speed = Math.hypot(velX, velY);
    const strength = Math.min(MAX_FLICK_IMPULSE, 8 + speed * 0.06);
    if (_flickImpulse.lengthSq() < 1e-4) return;
    _flickImpulse.setLength(strength);

    _flickTorque.set(
        (normOriginY + 0.2) * strength * 0.08,
        strength * 0.04,
        -normOriginX * strength * 0.08
    );

    forgetLastThrow();
    spawnedDice.forEach((die) => {
        if (isUsingWasmPhysics() && die.wasmId != null) {
            applyWasmImpulseForDie(die.mesh, _flickImpulse, _flickTorque);
        }
    });
}
