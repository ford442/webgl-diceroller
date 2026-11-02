import * as THREE from 'three';
import {
    getWasmEngine,
    seedPhysicsRNG,
    randomPhysicsFloat,
    seededPhysicsThrow,
    isUsingWorkerPhysics,
} from '../wasm/PhysicsBridge.js';
import {
    computeSeededThrowParams,
    applyThrowParams,
    createSeededRng,
} from 'dice-core/wasm/seededThrowParams';
import { TABLE_SURFACE_Y } from '../core/SceneMetrics.js';
import { spawnedDice } from './DiceState.js';
import { isUsingWasmPhysics, getSecureRandom } from './DicePhysicsPresets.js';
import { applyWasmImpulseForDie } from './DiceSync.js';
import { selectThrowDice, type ThrowSelectionOptions } from './DiceThrowSelection.js';

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
    const throwDiceList = targets.map(({ id, index }) => ({ id, index }));
    const wasmDice = engine
        ? targets.filter(({ die }) => die.wasmId != null).map(({ id, index }) => ({ id, index }))
        : [];

    let paramsById = null;
    const workerThrow = useDeterministic && isUsingWorkerPhysics() && wasmDice.length > 0;

    if (workerThrow) {
        seededPhysicsThrow(seed, wasmDice, TABLE_SURFACE_Y);
        paramsById = new Map(
            computeSeededThrowParams(createSeededRng(seed), wasmDice, TABLE_SURFACE_Y).map((p) => [
                p.id,
                p,
            ])
        );
    } else if (useDeterministic && engine) {
        seedPhysicsRNG(seed);
        const params = computeSeededThrowParams(
            () => randomPhysicsFloat(),
            wasmDice,
            TABLE_SURFACE_Y
        );
        applyThrowParams(engine, params);
        paramsById = new Map(params.map((p) => [p.id, p]));
    } else if (useDeterministic) {
        const params = computeSeededThrowParams(
            createSeededRng(seed),
            throwDiceList,
            TABLE_SURFACE_Y
        );
        paramsById = new Map(params.map((p) => [p.id, p]));
    }

    const rand = () => {
        if (!useDeterministic) return getSecureRandom();
        if (engine) return randomPhysicsFloat();
        return getSecureRandom();
    };

    targets.forEach(({ die, id, index }) => {
        let x;
        let y;
        let z;
        let q;
        let forceX;
        let forceY;
        let forceZ;
        let spinX;
        let spinY;
        let spinZ;

        const preset = paramsById?.get(id);
        if (paramsById) {
            if (!preset) return;
            ({ x, y, z, forceX, forceY, forceZ, spinX, spinY, spinZ } = preset);
            q = new THREE.Quaternion(preset.qx, preset.qy, preset.qz, preset.qw);
        } else {
            x = (rand() - 0.5) * 4;
            y = TABLE_SURFACE_Y + 6.75 + index * 0.5;
            z = (rand() - 0.5) * 4;
            q = new THREE.Quaternion();
            q.setFromEuler(
                new THREE.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2)
            );
            forceX = (rand() - 0.5) * 25;
            forceY = rand() * 10 - 5;
            forceZ = (rand() - 0.5) * 25;
            spinX = (rand() - 0.5) * 100;
            spinY = (rand() - 0.5) * 100;
            spinZ = (rand() - 0.5) * 100;

            if (engine && die.wasmId != null) {
                engine.setDieTransform(die.wasmId, x, y, z, q.x, q.y, q.z, q.w);
                engine.setDieVelocity(die.wasmId, 0, 0, 0, 0, 0, 0);
                engine.applyImpulse(die.wasmId, forceX, forceY, forceZ);
                engine.applyTorqueImpulse(die.wasmId, spinX, spinY, spinZ);
            }
        }
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

    spawnedDice.forEach((die) => {
        if (isUsingWasmPhysics() && die.wasmId != null) {
            applyWasmImpulseForDie(die.mesh, _flickImpulse, _flickTorque);
        }
    });
}
