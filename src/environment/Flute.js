import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { playFluteMelody } from '../audio/DiceCollisionAudio.js';
import { registerInteractable } from '../interactables/InteractableRegistry.js';
import { tween } from '../interactables/tween.js';

export function createFlute(scene, physicsWorld, position = { x: 0, y: -2.75, z: 0 }, rotationY = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Flute';

    // Dimensions
    const length = 2.0;
    const radius = 0.08;
    const innerRadius = 0.05;

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b, // Brown wood
        roughness: 0.8,
        metalness: 0.0
    });

    const darkWoodMat = new THREE.MeshStandardMaterial({
        color: 0x3d2314, // Darker wood for accents
        roughness: 0.9,
        metalness: 0.0
    });

    // Main body
    const bodyGeo = new THREE.CylinderGeometry(radius, radius, length, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, woodMat);
    bodyMesh.rotation.z = Math.PI / 2; // Lay flat
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // Mouthpiece
    const mouthGeo = new THREE.CylinderGeometry(radius, radius * 0.8, 0.3, 16);
    const mouthMesh = new THREE.Mesh(mouthGeo, darkWoodMat);
    mouthMesh.position.x = -length / 2 - 0.15;
    mouthMesh.rotation.z = Math.PI / 2;
    mouthMesh.castShadow = true;
    mouthMesh.receiveShadow = true;
    group.add(mouthMesh);

    // Dark wood band at the end
    const bandGeo = new THREE.CylinderGeometry(radius + 0.01, radius + 0.01, 0.1, 16);
    const bandMesh = new THREE.Mesh(bandGeo, darkWoodMat);
    bandMesh.position.x = length / 2;
    bandMesh.rotation.z = Math.PI / 2;
    bandMesh.castShadow = true;
    bandMesh.receiveShadow = true;
    group.add(bandMesh);

    // Holes
    const holeGeo = new THREE.CylinderGeometry(0.02, 0.02, radius * 2.1, 8);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 }); // Black to look hollow

    for (let i = 0; i < 6; i++) {
        const hole = new THREE.Mesh(holeGeo, holeMat);
        hole.position.x = 0.1 + (i * 0.2); // Spread them out
        hole.rotation.x = Math.PI / 2;
        group.add(hole);
    }

    // Embouchure hole (blow hole)
    const blowHole = new THREE.Mesh(holeGeo, holeMat);
    blowHole.position.x = -0.7;
    blowHole.rotation.x = Math.PI / 2;
    group.add(blowHole);

    // Position and Rotation
    group.position.set(position.x, position.y + radius, position.z); // Adjust y by radius so it rests on surface
    group.rotation.y = rotationY;

    // Add to scene
    scene.add(group);

    // Physics
    const totalLength = length + 0.3; // Including mouthpiece
    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(totalLength / 2, radius, radius));
        
        const physicsDummy = new THREE.Object3D();
        physicsDummy.position.copy(group.position);
        physicsDummy.quaternion.copy(group.quaternion);
        physicsDummy.rotateY(Math.PI / 2); // btCylinderShape aligns with Y axis by default. We want it along local X.
        
        // Wait, btCylinderShape takes half extents (rx, ry, rz). The cylinder runs along the Y axis.
        // Our flute runs along the X axis. So we need to rotate the dummy by 90 degrees on Z.
        const dummyGroup = new THREE.Object3D();
        dummyGroup.position.copy(group.position);
        dummyGroup.rotation.y = group.rotation.y;
        dummyGroup.rotateZ(Math.PI / 2);
        
        createStaticBody(physicsWorld, dummyGroup, shape);
    }

    // --- Interaction: click to play a short melody, with a gentle lift/wobble ---
    let playCount = 0;
    let animating = false;
    const baseY = group.position.y;
    const baseRotX = group.rotation.x;

    const interact = () => {
        playCount++;
        playFluteMelody();
        if (!animating) {
            animating = true;
            tween({
                duration: 520,
                onUpdate: (e) => {
                    // A soft breathy lift + tilt while "played".
                    const lift = Math.sin(e * Math.PI);
                    group.position.y = baseY + lift * 0.12;
                    group.rotation.x = baseRotX + lift * 0.12;
                },
                onComplete: () => {
                    group.position.y = baseY;
                    group.rotation.x = baseRotX;
                    animating = false;
                }
            });
        }
    };

    registerInteractable('flute', {
        trigger: interact,
        getState: () => ({ playCount })
    });

    return {
        group,
        interact,
        dispose: () => { /* interactable handle is shared/overwritten across flutes */ }
    };
}
