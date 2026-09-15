import * as THREE from 'three';
import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { spawnedDice, diceTypes } from './DiceState.js';
import { getDieTemplate } from './DiceModels.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';
import { getDieQuaternion } from './DiceTransformRead.js';
import { getWasmFaceValueForDie } from './DiceFaceValueRead.js';
import { resolveDieFaceValue } from './DiceSetRuntime.js';

const _invQ = new THREE.Quaternion();
const _localUp = new THREE.Vector3();

/** Legacy visual-mesh face clusterer (debug fallback when the WASM engine value is 0). */
export const readDiceValueVisual = (die) => {
    const model = getDieTemplate(die.type);
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

/**
 * The face value as the *mesh* reads it: 1..faceCount, the hull's own numbering.
 * Never show this to a player — a dF settles on a natural 6.
 */
export const readNaturalDiceValue = (die) => {
    if (isUsingWasmPhysics() && die?.wasmId != null) {
        const engineValue = getWasmFaceValueForDie(die.wasmId);
        if (engineValue > 0) return engineValue;
        return 0;
    }

    return readDiceValueVisual(die);
};

/**
 * The value the die actually shows, per its descriptor entry.
 *
 * The hull, the physics engine and the face-normal clusterer all speak natural
 * faces; `NumberingSpec` is what turns face 6 of a dF into a `+1`. Everything
 * player-facing goes through here.
 */
export const readDiceValue = (die) => {
    const natural = readNaturalDiceValue(die);
    if (!natural) return natural;
    return resolveDieFaceValue(die.type, natural);
};

/**
 * How many of each die key are on the table. The shapes are always present (the
 * dice tray shows a zero), and a derived key only appears once one is spawned.
 */
export const getSpawnedDiceCounts = () => {
    const counts = Object.fromEntries(diceTypes.map(({ type }) => [type, 0]));
    spawnedDice.forEach((die) => {
        counts[die.type] = (counts[die.type] ?? 0) + 1;
    });
    return counts;
};

export const readAllDiceValues = () =>
    spawnedDice.map((die) => ({
        type: die.type,
        value: readDiceValue(die),
        naturalValue: readNaturalDiceValue(die),
        role: die.role ?? null,
        groupIndex: die.groupIndex ?? 0,
        dieIndex: die.dieIndex ?? 0,
    }));

const debugEnabled =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('debug') ||
        new URLSearchParams(window.location.search).has('debug-perf'));

export const getDiceValueDebugSnapshot = () =>
    spawnedDice.map((die) => {
        const model = getDieTemplate(die.type);
        const faceNormals = model?.userData?.faceNormals ?? [];
        const faceValues = model?.userData?.faceValues ?? [];
        const engineValue = isUsingWasmPhysics() ? readNaturalDiceValue(die) : null;
        const visualValue = readDiceValueVisual(die);
        const value = isUsingWasmPhysics() ? engineValue : visualValue;
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
            displayValue: value ? resolveDieFaceValue(die.type, value) : value,
            engineValue,
            visualValue,
            disagrees:
                debugEnabled &&
                isUsingWasmPhysics() &&
                engineValue != null &&
                visualValue != null &&
                engineValue !== visualValue,
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
    if (!isUsingWasmPhysics()) return true;

    const wasmDice = spawnedDice.filter((die) => die.wasmId != null);
    if (wasmDice.length > 0 && !getWasmEngine().areAllSettled()) return false;
    return true;
};
