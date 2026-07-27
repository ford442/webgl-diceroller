import * as THREE from 'three';
import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { diceModels, spawnedDice, diceTypes } from './DiceState.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';
import { getDieQuaternion } from './DiceTransformRead.js';

const _invQ = new THREE.Quaternion();
const _localUp = new THREE.Vector3();

export const readDiceValue = (die) => {
    const model = diceModels[die.type];
    if (!model) return null;

    const faceNormals = model.userData.faceNormals;
    const faceValues = model.userData.faceValues;
    if (!faceNormals || !faceNormals.length || !faceValues) return null;

    const dieQuaternion = getDieQuaternion(die);

    _invQ.copy(dieQuaternion).invert();
    _localUp.set(0, 1, 0).applyQuaternion(_invQ);

    const useBottomFace = die.type === 'd4';
    let bestDot = useBottomFace ? Infinity : -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < faceNormals.length; i++) {
        const d = faceNormals[i].dot(_localUp);
        if (useBottomFace) {
            if (d < bestDot) {
                bestDot = d;
                bestIdx = i;
            }
        } else if (d > bestDot) {
            bestDot = d;
            bestIdx = i;
        }
    }

    return faceValues[bestIdx];
};

export const getSpawnedDiceCounts = () => {
    const counts = Object.fromEntries(diceTypes.map(({ type }) => [type, 0]));
    spawnedDice.forEach((die) => {
        if (counts[die.type] != null) counts[die.type]++;
    });
    return counts;
};

export const readAllDiceValues = () =>
    spawnedDice.map((die) => ({
        type: die.type,
        value: readDiceValue(die),
        role: die.role ?? null,
        groupIndex: die.groupIndex ?? 0,
        dieIndex: die.dieIndex ?? 0,
    }));

export const getDiceValueDebugSnapshot = () =>
    spawnedDice.map((die) => {
        const model = diceModels[die.type];
        const faceNormals = model?.userData?.faceNormals ?? [];
        const faceValues = model?.userData?.faceValues ?? [];
        const value = readDiceValue(die);
        const dieQuaternion = getDieQuaternion(die);

        _invQ.copy(dieQuaternion).invert();
        _localUp.set(0, 1, 0).applyQuaternion(_invQ);

        const useBottomFace = die.type === 'd4';
        let bestDot = useBottomFace ? Infinity : -Infinity;
        let bestIdx = -1;
        for (let i = 0; i < faceNormals.length; i++) {
            const dot = faceNormals[i].dot(_localUp);
            if ((useBottomFace && dot < bestDot) || (!useBottomFace && dot > bestDot)) {
                bestDot = dot;
                bestIdx = i;
            }
        }

        return {
            type: die.type,
            value,
            selectedFaceIndex: bestIdx,
            selectedFaceValue: bestIdx >= 0 ? faceValues[bestIdx] : null,
            selectedDot: bestDot,
            localUp: { x: _localUp.x, y: _localUp.y, z: _localUp.z },
            faceMap: faceNormals.map((normal, index) => ({
                index,
                value: faceValues[index],
                normal: { x: normal.x, y: normal.y, z: normal.z },
            })),
        };
    });

export const areDiceSettled = () => {
    if (spawnedDice.length === 0) return true;

    const wasmDice = spawnedDice.filter(
        (die) => die.wasmId != null && die.mesh.userData.physicsAuthority !== 'ammo'
    );

    if (isUsingWasmPhysics() && wasmDice.length > 0) {
        if (!getWasmEngine().areAllSettled()) return false;
    }

    let allStable = true;
    spawnedDice.forEach((die) => {
        if (die.mesh.userData.physicsAuthority === 'wasm' && die.wasmId != null) return;
        if (!die.body) return;
        const linear = die.body.getLinearVelocity();
        const angular = die.body.getAngularVelocity();
        const velSq = linear.x() * linear.x() + linear.y() * linear.y() + linear.z() * linear.z();
        const angSq =
            angular.x() * angular.x() + angular.y() * angular.y() + angular.z() * angular.z();
        if (velSq > 1.0 || angSq > 1.0) allStable = false;
    });

    return allStable;
};
