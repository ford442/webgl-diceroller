import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

function createRopeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Base color
    ctx.fillStyle = '#bfa577';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw fibers
    ctx.lineWidth = 2;
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const length = 20 + Math.random() * 40;

        ctx.beginPath();
        // Slightly diagonal strokes to simulate twist
        ctx.moveTo(x, y);
        ctx.lineTo(x + length, y + length * 0.5);

        // Randomize dark/light fibers
        if (Math.random() > 0.5) {
            ctx.strokeStyle = `rgba(139, 115, 85, ${0.1 + Math.random() * 0.3})`;
        } else {
            ctx.strokeStyle = `rgba(205, 186, 150, ${0.1 + Math.random() * 0.3})`;
        }
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // High repeat value along the length (S) to show the fibers properly
    texture.repeat.set(20, 2);
    texture.colorSpace = THREE.SRGBColorSpace;

    return texture;
}

function createRopeBumpTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Neutral bump base
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw fibers
    ctx.lineWidth = 2;
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const length = 20 + Math.random() * 40;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + length, y + length * 0.5);

        // Darker lines for crevices
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.2 + Math.random() * 0.4})`;
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 2);
    return texture;
}

export function createRope(scene, physicsWorld, position = {x: 0, y: -2.75, z: 0}, rotation = 0) {
    const group = new THREE.Group();
    group.name = 'Rope';

    // We'll place the group origin exactly at `position`
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotation;

    const ropeTex = createRopeTexture();
    const bumpTex = createRopeBumpTexture();

    const ropeMat = new THREE.MeshStandardMaterial({
        map: ropeTex,
        bumpMap: bumpTex,
        bumpScale: 0.1,
        roughness: 0.9,
        metalness: 0.0
    });

    const coilRadius = 1.0;
    const ropeThickness = 0.15;
    const coils = 4;
    const totalHeight = ropeThickness * coils * 1.5;

    // Create a spiral/coil using a series of toruses offset vertically
    for (let i = 0; i < coils; i++) {
        // Slight randomness in radius to look natural
        const r = coilRadius + (Math.random() * 0.1 - 0.05);
        // Shrink top coil slightly
        const currentRadius = (i === coils - 1) ? r * 0.9 : r;

        const torusGeo = new THREE.TorusGeometry(currentRadius, ropeThickness, 16, 64);
        const torus = new THREE.Mesh(torusGeo, ropeMat);

        // Torus is usually upright (XY plane). Rotate to sit flat (XZ plane).
        torus.rotation.x = Math.PI / 2;

        // Add some slight tilt and offset for realism
        torus.rotation.y = (Math.random() - 0.5) * 0.1;
        torus.position.y = ropeThickness + (i * ropeThickness * 1.3); // Stack them up
        torus.position.x = (Math.random() - 0.5) * 0.1;
        torus.position.z = (Math.random() - 0.5) * 0.1;

        torus.castShadow = true;
        torus.receiveShadow = true;
        group.add(torus);
    }

    // Add a loose end crossing over the coil
    // Use a TubeGeometry along a quadratic bezier curve
    class CustomSinCurve extends THREE.Curve {
        constructor(scale = 1) {
            super();
            this.scale = scale;
        }
        getPoint(t, optionalTarget = new THREE.Vector3()) {
            // Start inside the coil, loop over the top, and fall to the side
            const x = (t - 0.5) * 3;
            const y = Math.sin(Math.PI * t) * 1.5;
            const z = (t - 0.2) * 2;
            return optionalTarget.set(x, y, z).multiplyScalar(this.scale);
        }
    }

    const path = new CustomSinCurve(0.6);
    const tubeGeo = new THREE.TubeGeometry(path, 20, ropeThickness, 8, false);
    const looseEnd = new THREE.Mesh(tubeGeo, ropeMat);
    looseEnd.position.y = totalHeight; // Position near top
    looseEnd.rotation.y = Math.PI / 4;
    looseEnd.castShadow = true;
    looseEnd.receiveShadow = true;
    group.add(looseEnd);

    scene.add(group);

    if (physicsWorld && getAmmo()) {
        const Ammo = getAmmo();

        // Bounding box for the coil
        if (Ammo && physicsWorld) {
            const halfExtents = new Ammo.btVector3(coilRadius + ropeThickness, totalHeight / 2, coilRadius + ropeThickness);
            if (Ammo && physicsWorld) {
                const shape = new Ammo.btBoxShape(halfExtents);
        
                // Center the physics body on the visual bounds
                const physTransform = new THREE.Group();
                physTransform.position.copy(group.position);
                physTransform.position.y += totalHeight / 2; // Offset to center of mass
                physTransform.rotation.copy(group.rotation);
        
                createStaticBody(physicsWorld, physTransform, shape);
            }
        }
    }

    return group;
}
