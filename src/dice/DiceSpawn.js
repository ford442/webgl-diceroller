import { getWasmEngine, loadHullForDie } from '../wasm/PhysicsBridge.js';
import { TABLE_SURFACE_Y } from '../core/SceneMetrics.js';
import { spawnedDice, clearSpawnedDice, allocateAudioBodyId } from './DiceState.js';
import {
    PHYSICS_PRESETS,
    getDieSides,
    isUsingWasmPhysics,
    useMassBias,
    getSecureRandom,
    estimateInertiaScalar,
} from './DicePhysicsPresets.js';
import { acquireDiceMesh, ensureDressedTemplate, releaseDiceMesh } from './DiceModels.js';
import { getDieShape } from './DiceSetRuntime.js';

/** @typedef {import('../types/dice').SpawnedDie} SpawnedDie */

/**
 * @param {import('three').Scene} scene
 * @param {unknown} world unused — kept for call-site compatibility
 * @param {Record<string, number> | Array<string | SpawnedDie> | null} [config]
 */
export const spawnObjects = (scene, world, config = null) => {
    // No physics engine, no dice: every spawn path (initial load, and later
    // UI-driven updateDiceSet() calls) funnels through here, so guarding only
    // the call site in LoadingTiers.js would still let a dice-count change
    // spawn static, non-simulated meshes once WASM is unavailable.
    if (!isUsingWasmPhysics()) return;

    let diceToSpawn = [];
    if (config && !Array.isArray(config)) {
        Object.keys(config).forEach((type) => {
            const count = config[type];
            for (let i = 0; i < count; i++) diceToSpawn.push({ type });
        });
    } else if (Array.isArray(config)) {
        diceToSpawn = config.map((entry) => (typeof entry === 'string' ? { type: entry } : entry));
    } else {
        diceToSpawn = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].map((type) => ({ type }));
    }

    diceToSpawn.forEach((spec, index) => {
        const type = spec.type;
        // A derived type (dF, d100) has no mesh of its own — it rides its shape's
        // hull, and physics only ever hears about the shape.
        const shape = getDieShape(type);
        const template = ensureDressedTemplate(type);
        if (!template) return;

        const mesh = acquireDiceMesh(type);
        if (!mesh) return;

        const x = (getSecureRandom() - 0.5) * 4;
        const y = TABLE_SURFACE_Y + 5.75 + index * 0.5 + getSecureRandom() * 1;
        const z = (getSecureRandom() - 0.5) * 4;

        mesh.position.set(x, y, z);
        mesh.rotation.set(
            getSecureRandom() * Math.PI,
            getSecureRandom() * Math.PI,
            getSecureRandom() * Math.PI
        );
        mesh.updateMatrixWorld(true);

        scene.add(mesh);

        const physicsPreset = PHYSICS_PRESETS[shape] ?? PHYSICS_PRESETS.d6;
        const centerOfMassOffset = useMassBias()
            ? (template.userData.massBiasOffset?.clone() ?? null)
            : null;

        const audioBodyId = allocateAudioBodyId();
        const inertiaScalar = estimateInertiaScalar(template.geometry, physicsPreset.mass);

        mesh.userData.isDie = true;
        mesh.userData.physicsPreset = physicsPreset;

        let wasmId = null;
        if (isUsingWasmPhysics()) {
            const engine = getWasmEngine();
            const sides = getDieSides(shape);
            wasmId = engine.addDie(sides, x, y, z);
            engine.setDieMaterial(wasmId, physicsPreset.friction, physicsPreset.rollingFriction);
            engine.setDieDrag(wasmId, physicsPreset.dragFactor ?? 0);
            loadHullForDie(wasmId, sides);
            engine.setDieTransform(
                wasmId,
                mesh.position.x,
                mesh.position.y,
                mesh.position.z,
                mesh.quaternion.x,
                mesh.quaternion.y,
                mesh.quaternion.z,
                mesh.quaternion.w
            );
        }

        spawnedDice.push({
            mesh,
            type,
            wasmId,
            physicsPreset,
            audioBodyId,
            inertiaScalar,
            centerOfMassOffset,
            massBiasOffset: template.userData.massBiasOffset?.clone() ?? null,
            role: spec.role ?? null,
            groupIndex: spec.groupIndex ?? 0,
            dieIndex: spec.dieIndex ?? index,
            explode: spec.explode === true,
        });
    });
};

export const replaceDiceSet = (scene, world, specs) => {
    clearDice(scene, world);
    spawnObjects(scene, world, specs);
};

export const clearDice = (scene, _world) => {
    const engine = isUsingWasmPhysics() ? getWasmEngine() : null;
    spawnedDice.forEach((die) => {
        releaseDiceMesh(scene, die.type, die.mesh);
        if (engine && die.wasmId != null) engine.removeDie(die.wasmId);
    });
    clearSpawnedDice();
};

export const updateDiceSet = (scene, world, targetCounts) => {
    if (!targetCounts || typeof targetCounts !== 'object') return;

    const currentCounts = {};
    spawnedDice.forEach((d) => {
        currentCounts[d.type] = (currentCounts[d.type] || 0) + 1;
    });

    Object.keys(targetCounts).forEach((type) => {
        const target = targetCounts[type];
        const current = currentCounts[type] || 0;
        const diff = target - current;

        if (diff > 0) {
            const toAdd = [];
            for (let i = 0; i < diff; i++) toAdd.push(type);
            spawnObjects(scene, world, toAdd);
        } else if (diff < 0) {
            let toRemove = Math.abs(diff);
            for (let i = spawnedDice.length - 1; i >= 0; i--) {
                if (toRemove === 0) break;
                if (spawnedDice[i].type === type) {
                    const die = spawnedDice[i];
                    if (isUsingWasmPhysics() && die.wasmId != null) {
                        getWasmEngine().removeDie(die.wasmId);
                    }
                    releaseDiceMesh(scene, die.type, die.mesh);
                    spawnedDice.splice(i, 1);
                    toRemove--;
                }
            }
        }
    });
};

export const syncAllDiceToWasm = () => {
    if (!isUsingWasmPhysics()) return;

    const engine = getWasmEngine();
    engine.clearAllDice();

    spawnedDice.forEach((die) => {
        // The shape wins over whatever preset the die was spawned with: a set
        // that re-shaped this key clears it, and a stale preset would simulate
        // the hull this die no longer has.
        const shape = getDieShape(die.type);
        const sides = getDieSides(shape);
        const physicsPreset = PHYSICS_PRESETS[shape] ?? die.physicsPreset ?? PHYSICS_PRESETS.d6;
        die.physicsPreset = physicsPreset;
        die.wasmId = engine.addDie(
            sides,
            die.mesh.position.x,
            die.mesh.position.y,
            die.mesh.position.z
        );
        engine.setDieMaterial(die.wasmId, physicsPreset.friction, physicsPreset.rollingFriction);
        engine.setDieDrag(die.wasmId, physicsPreset.dragFactor ?? 0);
        loadHullForDie(die.wasmId, sides);

        engine.setDieTransform(
            die.wasmId,
            die.mesh.position.x,
            die.mesh.position.y,
            die.mesh.position.z,
            die.mesh.quaternion.x,
            die.mesh.quaternion.y,
            die.mesh.quaternion.z,
            die.mesh.quaternion.w
        );
    });
};
