import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { createConvexHullShape, spawnDicePhysics, getAmmo } from './physics.js';

let diceModels = {};
export let spawnedDice = [];

const loader = new ColladaLoader();

// Map of dice types to their filenames
const diceTypes = [
    { type: 'd4', file: 'die_4.dae' },
    { type: 'd6', file: 'die_6.dae' },
    { type: 'd8', file: 'die_8.dae' },
    { type: 'd10', file: 'die_10.dae' },
    { type: 'd12', file: 'die_12.dae' },
    { type: 'd20', file: 'die_20.dae' }
];

export const loadDiceModels = async () => {
    const promises = diceTypes.map(d => {
        return new Promise((resolve, reject) => {
            let timedOut = false;
            const url = `./images/${d.file}`; // Serve from public root so dev/build servers (Vite) will find them
            const timer = setTimeout(() => {
                console.warn(`Timeout loading ${url} (file: ${d.file}) - check network/asset path`);
                timedOut = true;
                resolve(); // Resolve anyway to unblock
            }, 15000); // longer timeout for slower networks

            loader.load(url, (collada) => {
                if (timedOut) return;
                clearTimeout(timer);
                let mesh = null;
                collada.scene.traverse((child) => {
                    if (child.isMesh) {
                        mesh = child;
                    }
                });

                if (mesh) {
                    const geometry = mesh.geometry.clone();
                    mesh.updateMatrixWorld(true);
                    geometry.applyMatrix4(mesh.matrixWorld);
                    geometry.rotateX(-Math.PI / 2);
                    
                    let material = mesh.material;
                    if (material) {
                        material = Array.isArray(material) ? material.map(m => m.clone()) : material.clone();
                    } else {
                        console.warn(`No material found for ${d.file}, using default magenta material`);
                        material = new THREE.MeshStandardMaterial({ color: 0xff00ff });
                    }
                    const cleanMesh = new THREE.Mesh(geometry, material);
                    
                    cleanMesh.position.set(0, 0, 0);
                    cleanMesh.rotation.set(0, 0, 0);
                    cleanMesh.scale.set(1, 1, 1);

                    diceModels[d.type] = cleanMesh;
                    cleanMesh.castShadow = true;
                    cleanMesh.receiveShadow = true;

                    diceModels[d.type].userData.physicsShape = createConvexHullShape(cleanMesh);
                    resolve();
                } else {
                    console.error(`No mesh found in ${d.file}`);
                    resolve();
                }
            }, undefined, (e) => {
                if (timedOut) return;
                clearTimeout(timer);
                console.error(`Error loading ${d.file}`, e);
                resolve();
            });
        });
    });

    await Promise.all(promises);
    console.log("All dice models loaded");
};

// Config is { d4: 1, d6: 2, ... }
export const spawnObjects = (scene, world, config = null) => {
    // Default config if none provided (backward compatibility)
    if (!config) {
        config = { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1, d20: 1 };
    }

    const diceToSpawn = [];
    Object.keys(config).forEach(type => {
        const count = config[type];
        for (let i = 0; i < count; i++) {
            diceToSpawn.push(type);
        }
    });

    diceToSpawn.forEach((type, index) => {
        const template = diceModels[type];
        if (!template) return;

        const mesh = template.clone();

        // Spread them out a bit randomly around the center but high up
        const x = (Math.random() - 0.5) * 5;
        const y = 5 + index * 1.5; // Stagger height to avoid immediate collision
        const z = (Math.random() - 0.5) * 5;

        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);

        scene.add(mesh);

        const body = spawnDicePhysics(world, mesh, template.userData.physicsShape, {x, y, z}, mesh.rotation);

        // Link mesh and body for interaction
        mesh.userData.body = body;

        spawnedDice.push({ mesh, body });
    });
};

export const updateDiceVisuals = () => {
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

export const clearDice = (scene, world) => {
    spawnedDice.forEach(die => {
        scene.remove(die.mesh);
        world.removeRigidBody(die.body);
    });
    spawnedDice = [];
};

export const updateDiceSet = (scene, world, config) => {
    clearDice(scene, world);
    spawnObjects(scene, world, config);
};

export const throwDice = (scene, world) => {
    // For a throw/reset: we can just lift them up and randomize rotation/velocity
    const Ammo = getAmmo();
    const transform = new Ammo.btTransform();

    spawnedDice.forEach((die, index) => {
        const body = die.body;

        // Stop current movement
        body.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
        body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));

        // Reset position to high up
        const x = (Math.random() - 0.5) * 5;
        const y = 5 + index * 1.5;
        const z = (Math.random() - 0.5) * 5;

        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(x, y, z));

        // Random rotation
        const q = new THREE.Quaternion();
        q.setFromEuler(new THREE.Euler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        ));
        transform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));

        body.setWorldTransform(transform);
        body.getMotionState().setWorldTransform(transform);

        // Wake up
        body.activate();
    });

    Ammo.destroy(transform);
};
