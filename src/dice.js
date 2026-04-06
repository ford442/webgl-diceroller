import * as THREE from 'three';
import { createConvexHullShape, spawnDicePhysics, getAmmo } from './physics.js';

let diceModels = {};
export let spawnedDice = [];

// Helper for Crypto Randomness
const getSecureRandom = () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
};

// Exported for main.js to use during sequential loading
export const diceTypes = [
    { type: 'd4', file: 'die_4.dae' },
    { type: 'd6', file: 'die_6.dae' },
    { type: 'd8', file: 'die_8.dae' },
    { type: 'd10', file: 'die_10.dae' },
    { type: 'd12', file: 'die_12.dae' },
    { type: 'd20', file: 'die_20.dae' }
];

// Export diceModels so main.js can populate it
export { diceModels };

export const spawnObjects = (scene, world, config = null) => {
    // If config is an object (counts), flatten it.
    // If it's a list (array of strings), use it directly.
    let diceToSpawn = [];
    if (config && !Array.isArray(config)) {
        Object.keys(config).forEach(type => {
            const count = config[type];
            for (let i = 0; i < count; i++) diceToSpawn.push(type);
        });
    } else if (Array.isArray(config)) {
        diceToSpawn = config;
    } else {
        // Default
        diceToSpawn = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    }

    diceToSpawn.forEach((type, index) => {
        const template = diceModels[type];
        if (!template) return;

        const mesh = template.clone();

        // Lower spawn height (was 5 + index) to reduce "drop hardness"
        const x = (getSecureRandom() - 0.5) * 4;
        const y = 3 + (index * 0.5) + (getSecureRandom() * 1);
        const z = (getSecureRandom() - 0.5) * 4;

        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

        scene.add(mesh);

        const body = spawnDicePhysics(world, mesh, template.userData.physicsShape, {x, y, z}, mesh.rotation);
        mesh.userData.body = body;

        // Store type for smart updating
        spawnedDice.push({ mesh, body, type });
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

export const updateDiceSet = (scene, world, targetCounts) => {
    // 1. Count current dice
    const currentCounts = {};
    spawnedDice.forEach(d => {
        currentCounts[d.type] = (currentCounts[d.type] || 0) + 1;
    });

    // 2. Calculate Difference
    Object.keys(targetCounts).forEach(type => {
        const target = targetCounts[type];
        const current = currentCounts[type] || 0;
        const diff = target - current;

        if (diff > 0) {
            // Add 'diff' amount of this type
            const toAdd = [];
            for(let i=0; i<diff; i++) toAdd.push(type);
            spawnObjects(scene, world, toAdd);
        } else if (diff < 0) {
            // Remove 'abs(diff)' amount of this type
            let toRemove = Math.abs(diff);
            // Iterate backwards to safely remove
            for (let i = spawnedDice.length - 1; i >= 0; i--) {
                if (toRemove === 0) break;
                if (spawnedDice[i].type === type) {
                    // Remove physics
                    world.removeRigidBody(spawnedDice[i].body);
                    // Remove visual
                    scene.remove(spawnedDice[i].mesh);
                    // Remove from array
                    spawnedDice.splice(i, 1);
                    toRemove--;
                }
            }
        }
    });
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
        // Reduced spread
        const x = (getSecureRandom() - 0.5) * 4;
        const y = 4 + (index * 0.5); // Lower start height
        const z = (getSecureRandom() - 0.5) * 4;

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

        // Much softer throw forces
        const forceX = (getSecureRandom() - 0.5) * 25; // Was 80
        const forceY = (getSecureRandom()) * 10 - 5;   // Gentle vertical toss
        const forceZ = (getSecureRandom() - 0.5) * 25; // Was 80

        const spinX = (getSecureRandom() - 0.5) * 100; // Was 350
        const spinY = (getSecureRandom() - 0.5) * 100; // Was 350
        const spinZ = (getSecureRandom() - 0.5) * 100; // Was 350

        body.applyCentralImpulse(new Ammo.btVector3(forceX, forceY, forceZ));
        body.applyTorqueImpulse(new Ammo.btVector3(spinX, spinY, spinZ));
    });

    Ammo.destroy(transform);
};
