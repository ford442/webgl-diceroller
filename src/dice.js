import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { createConvexHullShape, spawnDicePhysics, getAmmo } from './physics.js';

let diceModels = {};
export let spawnedDice = [];

const loader = new ColladaLoader();

const diceTypes = [
    { type: 'd4', file: 'die_4.dae' },
    { type: 'd6', file: 'die_6.dae' },
    { type: 'd8', file: 'die_8.dae' },
    { type: 'd10', file: 'die_10.dae' },
    { type: 'd12', file: 'die_12.dae' },
    { type: 'd20', file: 'die_20.dae' }
];

// Helper for Crypto Randomness
const getSecureRandom = () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
};

export const loadDiceModels = async () => {
    const promises = diceTypes.map(d => {
        return new Promise((resolve, reject) => {
            let timedOut = false;
            const url = `./images/${d.file}`;
            const timer = setTimeout(() => {
                console.warn(`Timeout loading ${url}`);
                timedOut = true;
                resolve();
            }, 15000);

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

                    // CRITICAL: Center the geometry to ensure the Center of Mass is correct
                    geometry.center();

                    mesh.updateMatrixWorld(true);
                    geometry.applyMatrix4(mesh.matrixWorld);
                    geometry.rotateX(-Math.PI / 2);
                    
                    // Re-center again after rotation to be safe
                    geometry.center();

                    let material = mesh.material;
                    if (material) {
                        material = Array.isArray(material) ? material.map(m => m.clone()) : material.clone();
                    } else {
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
                    resolve();
                }
            }, undefined, (e) => {
                if (timedOut) return;
                clearTimeout(timer);
                resolve();
            });
        });
    });

    await Promise.all(promises);
    console.log("All dice models loaded");
};

export const spawnObjects = (scene, world, config = null) => {
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

        // Initial spawn spread
        const x = (getSecureRandom() - 0.5) * 5;
        const y = 5 + index * 1.5;
        const z = (getSecureRandom() - 0.5) * 5;

        mesh.position.set(x, y, z);
        mesh.rotation.set(getSecureRandom() * Math.PI * 2, getSecureRandom() * Math.PI * 2, getSecureRandom() * Math.PI * 2);

        scene.add(mesh);

        const body = spawnDicePhysics(world, mesh, template.userData.physicsShape, {x, y, z}, mesh.rotation);
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
    const Ammo = getAmmo();
    const transform = new Ammo.btTransform();

    spawnedDice.forEach((die, index) => {
        const body = die.body;

        // Reset velocity
        body.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
        body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));

        // Group them near the top center for the throw
        // Use crypto random for position jitter
        const x = (getSecureRandom() - 0.5) * 2;
        const y = 8 + (index * 0.5); // Stack them slightly but high up
        const z = (getSecureRandom() - 0.5) * 2;

        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(x, y, z));

        // Random starting orientation
        const q = new THREE.Quaternion();
        q.setFromEuler(new THREE.Euler(
            getSecureRandom() * Math.PI * 2,
            getSecureRandom() * Math.PI * 2,
            getSecureRandom() * Math.PI * 2
        ));
        transform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));

        body.setWorldTransform(transform);
        body.getMotionState().setWorldTransform(transform);

        // Wake up
        body.activate();

        // FORCE IMPULSE (The "Throw")
        // Apply random forces to scatter them and create spin
        const forceX = (getSecureRandom() - 0.5) * 50; // Horizontal scatter
        const forceY = (getSecureRandom()) * 10 - 20; // Downward/Upward variation
        const forceZ = (getSecureRandom() - 0.5) * 50;

        const spinX = (getSecureRandom() - 0.5) * 100;
        const spinY = (getSecureRandom() - 0.5) * 100;
        const spinZ = (getSecureRandom() - 0.5) * 100;

        body.applyCentralImpulse(new Ammo.btVector3(forceX, forceY, forceZ));
        body.applyTorqueImpulse(new Ammo.btVector3(spinX, spinY, spinZ));
    });

    Ammo.destroy(transform);
};
