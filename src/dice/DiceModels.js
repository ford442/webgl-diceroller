import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ensureBodyPipGroups } from './DiceGeometryGroups.js';
import {
    createDiceMaterials,
    applyMaterialsToDieMesh,
    disposeDiceMaterials,
} from './DiceMaterials.js';
import {
    resolveDiceAppearanceConfig,
    persistDiceAppearanceConfig,
    DICE_TYPES as APPEARANCE_DICE_TYPES,
    buildDicePresencePayload,
    mergeDicePresencePayload,
} from './DiceAppearanceConfig.js';
import { diceModels, spawnedDice, diceMeshPool, diceTypes } from './DiceState.js';
import { finalizeDieTemplateUserData } from './DiceFaceData.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

let diceAppearanceConfig = null;
let diceAppearanceScene = null;
let diceAppearanceEnvMap = null;
let diceAppearanceQualityProfile = null;

function getAppearanceOptions() {
    return {
        envMap: diceAppearanceEnvMap ?? diceAppearanceScene?.environment ?? null,
        qualityProfile:
            diceAppearanceQualityProfile ??
            (typeof window !== 'undefined' ? window.qualityProfile : null),
    };
}

function applyAppearanceToMesh(mesh, type, { disposePrevious = true } = {}) {
    if (!diceAppearanceConfig || !mesh) return;
    const appearance = diceAppearanceConfig[type];
    if (!appearance) return;

    const previous = mesh.material;
    const materials = createDiceMaterials(appearance.preset, appearance, getAppearanceOptions());
    applyMaterialsToDieMesh(mesh, materials);
    mesh.userData.diceAppearance = { ...appearance };

    if (disposePrevious) disposeDiceMaterials(previous);
}

function applyAppearanceToTemplate(type) {
    applyAppearanceToMesh(diceModels[type], type);
}

export function acquireDiceMesh(type) {
    const pool = diceMeshPool[type];
    if (pool && pool.length > 0) {
        const mesh = pool.pop();
        mesh.visible = true;
        return mesh;
    }
    const template = diceModels[type];
    return template ? template.clone() : null;
}

export function releaseDiceMesh(scene, type, mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.userData.body = null;
    (diceMeshPool[type] ??= []).push(mesh);
}

export const loadDiceModels = async (onProgress) => {
    let done = 0;
    const total = diceTypes.length;

    const report = (label) => {
        if (typeof onProgress === 'function') onProgress(done, total, label);
    };

    await Promise.all(
        diceTypes.map(
            (d) =>
                new Promise((resolve) => {
                    let timedOut = false;
                    const url = `./images/${d.file}`;
                    const timer = setTimeout(() => {
                        console.warn(`Timeout loading ${url}`);
                        timedOut = true;
                        done++;
                        report(d.type);
                        resolve();
                    }, 15000);

                    loader.load(
                        url,
                        (gltf) => {
                            if (timedOut) return;
                            clearTimeout(timer);

                            /** @type {import('three').Mesh | null} */
                            let mesh = null;
                            gltf.scene.traverse((child) => {
                                if (
                                    /** @type {import('three').Object3D & { isMesh?: boolean }} */ (
                                        child
                                    ).isMesh
                                )
                                    mesh = /** @type {import('three').Mesh} */ (child);
                            });

                            if (mesh) {
                                const geometry = mesh.geometry.clone();
                                geometry.center();
                                mesh.updateMatrixWorld(true);
                                geometry.applyMatrix4(mesh.matrixWorld);
                                geometry.rotateX(-Math.PI / 2);
                                geometry.center();
                                ensureBodyPipGroups(geometry);

                                const cleanMesh = new THREE.Mesh(
                                    geometry,
                                    new THREE.MeshStandardMaterial({
                                        color: 0xcccccc,
                                        roughness: 0.3,
                                        metalness: 0.0,
                                    })
                                );
                                cleanMesh.position.set(0, 0, 0);
                                cleanMesh.rotation.set(0, 0, 0);
                                cleanMesh.scale.set(1, 1, 1);
                                cleanMesh.castShadow = true;
                                cleanMesh.receiveShadow = true;
                                cleanMesh.userData.physicsShape = null;
                                cleanMesh.geometry.computeBoundingBox();

                                finalizeDieTemplateUserData(cleanMesh, d.type);
                                diceModels[d.type] = cleanMesh;
                            }

                            done++;
                            report(d.type);
                            resolve();
                        },
                        undefined,
                        (error) => {
                            if (timedOut) return;
                            clearTimeout(timer);
                            console.warn(`Error loading ${url}:`, error);
                            done++;
                            report(d.type);
                            resolve();
                        }
                    );
                })
        )
    );

    console.log('All dice models loaded');
};

export function initDiceAppearance(scene, options = {}) {
    diceAppearanceScene = scene;
    diceAppearanceEnvMap = options.envMap ?? scene?.environment ?? null;
    diceAppearanceQualityProfile = options.qualityProfile ?? options.adaptiveProfile ?? null;
    diceAppearanceConfig = resolveDiceAppearanceConfig();
    APPEARANCE_DICE_TYPES.forEach((type) => applyAppearanceToTemplate(type));
}

/** Update quality profile used when (re)building dice materials. */
export function setDiceAppearanceQualityProfile(profile) {
    diceAppearanceQualityProfile = profile ?? null;
}

export function getDiceAppearanceConfig() {
    if (!diceAppearanceConfig) diceAppearanceConfig = resolveDiceAppearanceConfig();
    return diceAppearanceConfig;
}

export function setDieTypeAppearance(type, partial) {
    if (!diceAppearanceConfig) diceAppearanceConfig = resolveDiceAppearanceConfig();
    diceAppearanceConfig[type] = { ...diceAppearanceConfig[type], ...partial };
    refreshDiceAppearance(type);
    persistDiceAppearanceConfig(diceAppearanceConfig);
    return diceAppearanceConfig[type];
}

export function refreshDiceAppearance(type = null) {
    const types = type ? [type] : APPEARANCE_DICE_TYPES;
    const toDispose = new Set();

    types.forEach((dieType) => {
        const targets = [];
        if (diceModels[dieType]) targets.push(diceModels[dieType]);
        spawnedDice.forEach((die) => {
            if (die.type === dieType) targets.push(die.mesh);
        });
        (diceMeshPool[dieType] ?? []).forEach((mesh) => targets.push(mesh));

        targets.forEach((mesh) => {
            if (!mesh) return;
            const previous = mesh.material;
            applyAppearanceToMesh(mesh, dieType, { disposePrevious: false });
            const track = (mat) => {
                if (mat) toDispose.add(mat);
            };
            if (Array.isArray(previous)) previous.forEach(track);
            else track(previous);
        });
    });

    toDispose.forEach((mat) => mat?.dispose?.());
}

export function applyDicePresencePayload(presence) {
    diceAppearanceConfig = mergeDicePresencePayload(getDiceAppearanceConfig(), presence);
    refreshDiceAppearance();
    persistDiceAppearanceConfig(diceAppearanceConfig);
    return diceAppearanceConfig;
}

export { buildDicePresencePayload, diceModels, diceTypes };
