import * as THREE from 'three';
import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { spawnedDice, getAmmoDiceBackend } from './DiceState.js';
import { isUsingWasmPhysics, needsAmmoDiceBackend } from './diceAmmoFlags.js';

const searchParams = new URLSearchParams(window.location.search);

export { isUsingWasmPhysics, needsAmmoDiceBackend };

export const DEFAULT_MASS_BIAS_RATIO = 0.0075;

export const PHYSICS_PRESETS = {
    d4: { mass: 5, friction: 0.85, rollingFriction: 0.35, dragFactor: 0.0024 },
    d6: { mass: 5, friction: 0.6, rollingFriction: 0.1, dragFactor: 0.002 },
    d8: { mass: 5, friction: 0.55, rollingFriction: 0.08, dragFactor: 0.0019 },
    d10: { mass: 5, friction: 0.5, rollingFriction: 0.06, dragFactor: 0.0018 },
    d12: { mass: 5, friction: 0.45, rollingFriction: 0.05, dragFactor: 0.0017 },
    d20: { mass: 5, friction: 0.4, rollingFriction: 0.03, dragFactor: 0.0016 },
};

export const getMassBiasRatio = () => {
    const raw = searchParams.get('bias-ratio');
    if (raw === null) return DEFAULT_MASS_BIAS_RATIO;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(value, 0.05)) : DEFAULT_MASS_BIAS_RATIO;
};

export const getDieSides = (type) => Number.parseInt(type.replace('d', ''), 10) || 6;

export const useMassBias = () => !searchParams.has('fair-dice');

export const getSecureRandom = () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
};

export function estimateInertiaScalar(geometry, mass) {
    const bbox = geometry.boundingBox ?? geometry.computeBoundingBox?.();
    const source = bbox || geometry.boundingBox;
    if (!source) return 0.4 * mass;

    const size = new THREE.Vector3();
    source.getSize(size);
    const ix = (mass / 12) * (size.y * size.y + size.z * size.z);
    const iy = (mass / 12) * (size.x * size.x + size.z * size.z);
    const iz = (mass / 12) * (size.x * size.x + size.y * size.y);
    return (ix + iy + iz) / 3;
}

export function getCenterOfMassOffset(die) {
    const offset =
        die?.centerOfMassOffset ??
        die?.body?._centerOfMassOffset ??
        die?.mesh?.userData?.centerOfMassOffset;
    if (!offset) return null;
    return offset;
}

export function getGeometryPositionFromBodyTransform(die, origin, quaternion) {
    const offset = getCenterOfMassOffset(die);
    if (!offset) {
        return { x: origin.x(), y: origin.y(), z: origin.z() };
    }

    const worldOffset = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion);
    return {
        x: origin.x() - worldOffset.x,
        y: origin.y() - worldOffset.y,
        z: origin.z() - worldOffset.z,
    };
}

export function getBodyPositionFromGeometry(position, quaternion, offset) {
    if (!offset) return position;
    const worldOffset = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion);
    return {
        x: position.x + worldOffset.x,
        y: position.y + worldOffset.y,
        z: position.z + worldOffset.z,
    };
}

export const applyDiceMassBiases = ({
    deltaTime = 1 / 60,
    applyAmmo = true,
    applyWasm = true,
} = {}) => {
    if (!useMassBias()) return;

    const ammoBackend = applyAmmo ? getAmmoDiceBackend() : null;
    const gravityForce = new THREE.Vector3(0, -15, 0);
    const worldOffset = new THREE.Vector3();
    const torque = new THREE.Vector3();

    spawnedDice.forEach((die) => {
        if (!die.massBiasOffset) return;

        worldOffset.copy(die.massBiasOffset).applyQuaternion(die.mesh.quaternion);
        torque.crossVectors(worldOffset, gravityForce).multiplyScalar(die.physicsPreset?.mass ?? 5);
        if (torque.lengthSq() < 1e-8) return;

        if (ammoBackend && die.body) {
            ammoBackend.applyAmmoMassBiasTorque(die, torque, deltaTime);
        }

        if (applyWasm && isUsingWasmPhysics() && die.wasmId != null) {
            getWasmEngine().applyTorqueImpulse(
                die.wasmId,
                torque.x * deltaTime,
                torque.y * deltaTime,
                torque.z * deltaTime
            );
        }
    });
};
