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
} from '../wasm/seededThrowParams.js';
import { TABLE_SURFACE_Y } from '../core/SceneMetrics.js';
import { spawnedDice, getAmmoDiceBackend } from './DiceState.js';
import { isUsingWasmPhysics, getSecureRandom } from './DicePhysicsPresets.js';
import { applyWasmImpulseForDie } from './DiceSync.js';

/** @typedef {import('../types/dice').SpawnedDie} SpawnedDie */

const _flickForward = new THREE.Vector3();
const _flickRight = new THREE.Vector3();
const _flickImpulse = new THREE.Vector3();
const _flickTorque = new THREE.Vector3();
const MAX_FLICK_IMPULSE = 28;

/**
 * @param {import('three').Scene} scene
 * @param {import('../types/ammo').AmmoWorld | null | undefined} world
 * @param {number | null} [seed]
 */
export const throwDice = (scene, world, seed = null) => {
    const ammoBackend = getAmmoDiceBackend();
    const transform = ammoBackend?.createAmmoThrowTransform() ?? null;
    const engine = isUsingWasmPhysics() ? getWasmEngine() : null;

    const useDeterministic = seed !== null;
    const throwDiceList = spawnedDice.map((die, index) => ({
        id: die.wasmId ?? index,
        index,
    }));
    const wasmDice = engine
        ? throwDiceList.filter((d) => spawnedDice[d.index]?.wasmId != null)
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

    spawnedDice.forEach((die, index) => {
        die.mesh.userData.physicsAuthority = engine ? 'wasm' : 'ammo';

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

        const paramKey = die.wasmId ?? index;
        const preset = paramsById?.get(paramKey);
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

        if (ammoBackend && die.body && transform) {
            ammoBackend.applyAmmoThrowImpulse(die, transform, {
                x,
                y,
                z,
                q,
                forceX,
                forceY,
                forceZ,
                spinX,
                spinY,
                spinZ,
            });
        }
    });

    if (transform && ammoBackend) {
        ammoBackend.destroyAmmoThrowTransform(transform);
    }
};

export function applyFlickImpulseToDice(
    camera,
    velX,
    velY,
    { normOriginX = 0, normOriginY = 0 } = {}
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

    const ammoBackend = getAmmoDiceBackend();
    spawnedDice.forEach((die) => {
        if (isUsingWasmPhysics() && die.wasmId != null) {
            applyWasmImpulseForDie(die.mesh, _flickImpulse, _flickTorque);
            return;
        }
        if (ammoBackend && die.body) {
            ammoBackend.applyAmmoFlickImpulse(die, _flickImpulse, _flickTorque);
        }
    });
}
