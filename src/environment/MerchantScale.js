import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createMerchantScale(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'MerchantScale';

    // Materials
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        metalness: 0.8,
        roughness: 0.3
    });

    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.7
    });

    // 1. Base
    const baseRadius = 1.0;
    const baseHeight = 0.2;
    const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius + 0.1, baseHeight, 16);
    const base = new THREE.Mesh(baseGeo, woodMat);
    base.position.y = baseHeight / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // 2. Column
    const colHeight = 3.5;
    const colRadius = 0.15;
    const colGeo = new THREE.CylinderGeometry(colRadius, colRadius + 0.05, colHeight, 16);
    const column = new THREE.Mesh(colGeo, brassMat);
    column.position.y = baseHeight + colHeight / 2;
    column.castShadow = true;
    column.receiveShadow = true;
    group.add(column);

    // 3. Beam Group (Pivots at top of column)
    const beamGroup = new THREE.Group();
    // Pivot point is at the top of the column
    beamGroup.position.y = baseHeight + colHeight;
    group.add(beamGroup);

    // Beam Geometry
    const beamLength = 4.0;
    const beamWidth = 0.1;
    const beamHeight = 0.2;
    const beamGeo = new THREE.BoxGeometry(beamLength, beamHeight, beamWidth);
    const beam = new THREE.Mesh(beamGeo, brassMat);
    beam.castShadow = true;
    beam.receiveShadow = true;
    beamGroup.add(beam);

    // Central decorative finial on beam
    const finialGeo = new THREE.ConeGeometry(0.1, 0.3, 16);
    const finial = new THREE.Mesh(finialGeo, brassMat);
    finial.position.y = 0.2;
    beamGroup.add(finial);

    // 4. Pans Assembly
    const chainLength = 2.0;
    const panRadius = 0.8;

    function createPanAssembly(xOffset) {
        const assembly = new THREE.Group();
        assembly.position.x = xOffset;
        // The pivot of the assembly is at the beam tip.

        // Chain (Simple Cylinder for now)
        const chainGeo = new THREE.CylinderGeometry(0.02, 0.02, chainLength, 8);
        const chain = new THREE.Mesh(chainGeo, brassMat);
        // Chain hangs down from 0,0,0
        chain.position.y = -chainLength / 2;
        chain.castShadow = true;
        assembly.add(chain);

        // Pan (Hemisphere)
        // SphereGeometry parameters: radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength
        const panGeo = new THREE.SphereGeometry(panRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const pan = new THREE.Mesh(panGeo, brassMat);
        // Pan is at bottom of chain.
        // SphereGeometry (thetaLength PI/2) creates top hemisphere (0 to PI/2).
        // We want it like a bowl. Rotate Z 180 (PI).
        pan.rotation.z = Math.PI;
        pan.position.y = -chainLength;
        pan.castShadow = true;
        pan.receiveShadow = true;
        assembly.add(pan);

        return assembly;
    }

    const leftPan = createPanAssembly(-beamLength / 2 + 0.1);
    const rightPan = createPanAssembly(beamLength / 2 - 0.1);

    beamGroup.add(leftPan);
    beamGroup.add(rightPan);

    // --- Position ---
    // Table Top -2.75.
    // Base is at y=0 local.
    // Place at (-5, -2.75, 5).
    group.position.set(-5, -2.75, 5);
    group.rotation.y = -Math.PI / 4; // Angle it

    scene.add(group);

    // --- Physics ---
    if (physicsWorld) {
        const ammo = getAmmo();

        // Helper to create body at world position
        const createBody = (mesh, shape) => {
             // Ensure matrices are updated
            mesh.updateWorldMatrix(true, false);
            const worldPos = new THREE.Vector3();
            const worldQuat = new THREE.Quaternion();
            mesh.getWorldPosition(worldPos);
            mesh.getWorldQuaternion(worldQuat);

            const dummy = new THREE.Object3D();
            dummy.position.copy(worldPos);
            dummy.quaternion.copy(worldQuat);

            createStaticBody(physicsWorld, dummy, shape);
        };

        // Base Body
        createBody(base, new ammo.btCylinderShape(new ammo.btVector3(baseRadius, baseHeight/2, baseRadius)));

        // Column Body
        createBody(column, new ammo.btCylinderShape(new ammo.btVector3(colRadius, colHeight/2, colRadius)));
    }

    // --- Animation ---
    const update = (time) => {
        // Sway
        const angle = Math.sin(time * 1.5) * 0.05; // +/- 0.05 rads
        beamGroup.rotation.z = angle;

        // Counter-rotate pans to keep them level (and chains vertical)
        leftPan.rotation.z = -angle;
        rightPan.rotation.z = -angle;
    };

    return {
        group,
        update
    };
}
