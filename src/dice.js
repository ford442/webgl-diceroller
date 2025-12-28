import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { createConvexHullShape, spawnDicePhysics, getAmmo } from './physics.js';

let diceModels = {};
let spawnedDice = [];

const loader = new ColladaLoader();

// Map of dice types to their filenames
const diceTypes = [
    { type: 'd4', file: 'die_4.dae' },
    { type: 'd6', file: 'die_6.dae' },
    { type: 'd8', file: 'die_8.dae' },
    { type: 'd10', file: 'die_10.dae' }, // Added d10 as it was in original
    { type: 'd12', file: 'die_12.dae' },
    { type: 'd20', file: 'die_20.dae' }
];

export const loadDiceModels = async () => {
    const promises = diceTypes.map(d => {
        return new Promise((resolve, reject) => {
            loader.load(`./images/${d.file}`, (collada) => {
                // Find the mesh in the scene
                let mesh = null;
                collada.scene.traverse((child) => {
                    if (child.isMesh) {
                        mesh = child;
                    }
                });

                if (mesh) {
                    // The ColladaLoader rotates the scene container for Z-UP assets,
                    // but doesn't convert vertex data. We need to:
                    // 1. Get the world-transformed geometry (accounts for parent rotations)
                    // 2. Convert to Y-UP by rotating geometry vertices
                    
                    // Clone the geometry to avoid modifying the original
                    const geometry = mesh.geometry.clone();
                    
                    // Update the mesh's world matrix to account for parent transforms
                    mesh.updateMatrixWorld(true);
                    
                    // Apply the world transform to the geometry vertices
                    // This bakes in any rotations from the collada.scene parent
                    geometry.applyMatrix4(mesh.matrixWorld);
                    
                    // Create a clean mesh with the transformed geometry
                    // Handle material cloning properly - might be null or an array
                    let material = mesh.material;
                    if (material) {
                        material = Array.isArray(material) ? material.map(m => m.clone()) : material.clone();
                    } else {
                        // Create a default material if none exists
                        console.warn(`No material found for ${d.file}, using default magenta material`);
                        material = new THREE.MeshStandardMaterial({ color: 0xff00ff }); // Magenta for visibility
                    }
                    const cleanMesh = new THREE.Mesh(geometry, material);
                    
                    // Reset transforms ensuring we have a clean "prefab" at origin with identity transform
                    cleanMesh.position.set(0, 0, 0);
                    cleanMesh.rotation.set(0, 0, 0);
                    cleanMesh.scale.set(1, 1, 1);

                    diceModels[d.type] = cleanMesh;
                    cleanMesh.castShadow = true;
                    cleanMesh.receiveShadow = true;

                    // Pre-calculate physics shape from the clean mesh
                    // The geometry now has Y-UP vertex data baked in
                    diceModels[d.type].userData.physicsShape = createConvexHullShape(cleanMesh);
                    resolve();
                } else {
                    console.error(`No mesh found in ${d.file}`);
                    resolve(); // Resolve anyway to not block app
                }
            }, undefined, (e) => {
                console.error(`Error loading ${d.file}`, e);
                resolve();
            });
        });
    });

    await Promise.all(promises);
    console.log("All dice models loaded");
};

export const spawnObjects = (scene, world) => {
    const diceList = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

    diceList.forEach((type, index) => {
        const template = diceModels[type];
        if (!template) return;

        const mesh = template.clone();

        // Initial position logic from original: [(i - 2) * 2, -3, 0] -> but y is -3?
        // Original: position:[(i -2) * 2, -3, 0] with floor at -5. So they are floating slightly above.
        // Let's spawn them higher to drop.
        const x = (index - 2.5) * 3;
        const y = 5;
        const z = 0;

        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);

        scene.add(mesh);

        const body = spawnDicePhysics(world, mesh, template.userData.physicsShape, {x, y, z}, mesh.rotation);

        spawnedDice.push({ mesh, body });
    });
};

export const updateDiceVisuals = () => {
    // Sync physics to visual
    const Ammo = getAmmo();

    const transform = new Ammo.btTransform();

    spawnedDice.forEach(die => {
        const body = die.body;
        const mesh = die.mesh;

        if (body && body.getMotionState()) {
            body.getMotionState().getWorldTransform(transform);
            const origin = transform.getOrigin();
            const rotation = transform.getRotation();

            mesh.position.set(origin.x(), origin.y(), origin.z());
            mesh.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
        }
    });

    Ammo.destroy(transform);
};

// Helper for "reset" functionality if needed
export const resetDice = (scene, world) => {
    spawnedDice.forEach(die => {
        scene.remove(die.mesh);
        world.removeRigidBody(die.body);
    });
    spawnedDice = [];
    spawnObjects(scene, world);
};
