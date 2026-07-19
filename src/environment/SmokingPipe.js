import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createSmokingPipe(scene, physicsWorld, position = { x: -6, y: -2.75, z: 5 }, rotation = Math.PI / 8) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'SmokingPipe';

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.6,
        metalness: 0.1
    });

    const darkWoodMat = new THREE.MeshStandardMaterial({
        color: 0x5D3A1A,
        roughness: 0.7,
        metalness: 0.1
    });

    const leatherMat = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.9,
        bumpScale: 0.05
    });

    const tobaccoMat = new THREE.MeshStandardMaterial({
        color: 0x3D2314,
        roughness: 1.0
    });

    // --- The Pipe ---
    const pipeGroup = new THREE.Group();

    // Pipe Bowl (Bulbous part with opening)
    const bowlPoints = [];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const angle = Math.PI * t;
        const r = Math.sin(angle) * 0.35;
        const y = -Math.cos(angle) * 0.5 + 0.5;
        bowlPoints.push(new THREE.Vector2(r, y));
    }
    const bowlGeo = new THREE.LatheGeometry(bowlPoints, 16);
    const bowl = new THREE.Mesh(bowlGeo, woodMat);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    bowl.position.y = 0;
    pipeGroup.add(bowl);

    // Bowl rim (darker wood)
    const rimGeo = new THREE.TorusGeometry(0.35, 0.05, 8, 16);
    const rim = new THREE.Mesh(rimGeo, darkWoodMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.0;
    rim.castShadow = true;
    pipeGroup.add(rim);

    // Tobacco inside bowl
    const tobaccoGeo = new THREE.CircleGeometry(0.3, 16);
    const tobacco = new THREE.Mesh(tobaccoGeo, tobaccoMat);
    tobacco.rotation.x = -Math.PI / 2;
    tobacco.position.y = 0.95;
    pipeGroup.add(tobacco);

    // Pipe Stem (Curved tube)
    const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0.25, 0.8, 0),           // Start at bowl
        new THREE.Vector3(0.8, 1.0, 0),            // Control point (up curve)
        new THREE.Vector3(1.8, 0.3, 0)             // End at mouthpiece
    );
    const stemGeo = new THREE.TubeGeometry(curve, 16, 0.08, 8, false);
    const stem = new THREE.Mesh(stemGeo, darkWoodMat);
    stem.castShadow = true;
    stem.receiveShadow = true;
    pipeGroup.add(stem);

    // Mouthpiece
    const mouthpieceGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.4, 8);
    const mouthpiece = new THREE.Mesh(mouthpieceGeo, woodMat);
    mouthpiece.rotation.z = Math.PI / 2 + 0.3;
    mouthpiece.position.set(1.9, 0.25, 0);
    mouthpiece.castShadow = true;
    pipeGroup.add(mouthpiece);

    pipeGroup.position.set(-0.8, 0, 0);
    pipeGroup.rotation.y = -Math.PI / 6;
    group.add(pipeGroup);

    // --- The Tobacco Pouch ---
    const pouchGroup = new THREE.Group();

    // Main pouch body (deformed sphere for soft leather look)
    const pouchGeo = new THREE.SphereGeometry(0.5, 16, 12);
    // Flatten the bottom
    const pouchPositions = pouchGeo.attributes.position;
    for (let i = 0; i < pouchPositions.count; i++) {
        const y = pouchPositions.getY(i);
        if (y < 0) {
            pouchPositions.setY(i, y * 0.3); // Flatten bottom
        }
    }
    pouchGeo.computeVertexNormals();
    
    const pouch = new THREE.Mesh(pouchGeo, leatherMat);
    pouch.scale.set(1, 0.8, 0.6);
    pouch.castShadow = true;
    pouch.receiveShadow = true;
    pouchGroup.add(pouch);

    // Pouch opening/cuff
    const cuffGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.2, 16);
    const cuff = new THREE.Mesh(cuffGeo, darkWoodMat);
    cuff.position.y = 0.25;
    cuff.castShadow = true;
    pouchGroup.add(cuff);

    // Drawstring
    const drawstringCurve = new THREE.EllipseCurve(
        0, 0,           // center
        0.32, 0.32,     // x, y radius
        0, 2 * Math.PI, // start, end angle
        false,          // clockwise
        0               // rotation
    );
    const drawstringPoints = drawstringCurve.getPoints(32);
    const drawstringGeo = new THREE.BufferGeometry().setFromPoints(
        drawstringPoints.map(p => new THREE.Vector3(p.x, 0, p.y))
    );
    const drawstringMat = new THREE.LineBasicMaterial({ color: 0x3D2314 });
    const drawstring = new THREE.Line(drawstringGeo, drawstringMat);
    drawstring.position.y = 0.35;
    pouchGroup.add(drawstring);

    // Loose tobacco pieces scattered around
    for (let i = 0; i < 5; i++) {
        const flakeGeo = new THREE.BoxGeometry(0.05, 0.02, 0.08);
        const flake = new THREE.Mesh(flakeGeo, tobaccoMat);
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.6 + Math.random() * 0.4;
        flake.position.set(
            Math.cos(angle) * dist,
            0.01,
            Math.sin(angle) * dist
        );
        flake.rotation.y = Math.random() * Math.PI;
        flake.rotation.x = Math.random() * 0.3;
        flake.castShadow = true;
        pouchGroup.add(flake);
    }

    pouchGroup.position.set(0.6, 0, 0.3);
    pouchGroup.rotation.y = Math.PI / 4;
    group.add(pouchGroup);

    // --- Positioning ---
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotation;

    scene.add(group);

    // --- Smoke Particles (Optional visual effect) ---
    const smokeParticles = [];
    const smokeGroup = new THREE.Group();
    group.add(smokeGroup);

    // Simple smoke particles
    const smokeGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const smokeMat = new THREE.MeshBasicMaterial({
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.3
    });

    for (let i = 0; i < 8; i++) {
        const smoke = new THREE.Mesh(smokeGeo, smokeMat);
        smoke.position.set(
            -0.8 + Math.cos(rotation) * 0.2,
            1.2 + Math.random() * 0.5,
            0 + Math.sin(rotation) * 0.2
        );
        smoke.userData = {
            initialY: smoke.position.y,
            speed: 0.2 + Math.random() * 0.3,
            offset: Math.random() * Math.PI * 2,
            life: Math.random()
        };
        smokeGroup.add(smoke);
        smokeParticles.push(smoke);
    }

    // Store update function for animation
    group.userData.updateSmoke = (time) => {
        smokeParticles.forEach((smoke, idx) => {
            const data = smoke.userData;
            data.life += 0.01;
            
            if (data.life > 1) {
                data.life = 0;
                smoke.position.set(
                    -0.8 + (Math.random() - 0.5) * 0.1,
                    1.0,
                    (Math.random() - 0.5) * 0.1
                );
                smoke.scale.setScalar(1);
            }
            
            smoke.position.y += data.speed * 0.016;
            smoke.position.x += Math.sin(time * 2 + data.offset) * 0.002;
            
            const scale = 1 + data.life * 2;
            smoke.scale.setScalar(scale);
            smoke.material.opacity = 0.3 * (1 - data.life);
        });
    };

    // --- Physics ---
    // Pipe bowl physics (approximated as small box)
    if (ammo && physicsWorld) {
        const bowlShape = new ammo.btBoxShape(new ammo.btVector3(0.35, 0.5, 0.35));
        const bowlDummy = new THREE.Object3D();
        bowlDummy.position.copy(group.position).add(new THREE.Vector3(-0.8, 0.5, 0).applyEuler(group.rotation));
        bowlDummy.quaternion.copy(group.quaternion);
        createStaticBody(physicsWorld, bowlDummy, bowlShape);
    }

    // Pipe stem physics (approximated as small box)
    if (ammo && physicsWorld) {
        const stemShape = new ammo.btBoxShape(new ammo.btVector3(0.6, 0.1, 0.1));
        const stemDummy = new THREE.Object3D();
        stemDummy.position.copy(group.position).add(new THREE.Vector3(0.2, 0.3, 0).applyEuler(group.rotation));
        stemDummy.quaternion.copy(group.quaternion);
        stemDummy.rotation.y = rotation - Math.PI / 6;
        createStaticBody(physicsWorld, stemDummy, stemShape);
    }

    // Pouch physics
    if (ammo && physicsWorld) {
        const pouchShape = new ammo.btBoxShape(new ammo.btVector3(0.5, 0.3, 0.35));
        const pouchDummy = new THREE.Object3D();
        pouchDummy.position.copy(group.position).add(new THREE.Vector3(0.6, 0.15, 0.3).applyEuler(group.rotation));
        pouchDummy.quaternion.copy(group.quaternion);
        createStaticBody(physicsWorld, pouchDummy, pouchShape);
    }

    return { group, update: group.userData.updateSmoke };
}
