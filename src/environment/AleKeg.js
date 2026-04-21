import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createAleKeg(scene, physicsWorld, position, rotationY) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    group.name = 'AleKeg';

    const textureLoader = new THREE.TextureLoader();

    // Wood material
    const woodDiffuse = textureLoader.load('./images/wood_diffuse.jpg');
    const woodRoughness = textureLoader.load('./images/wood_roughness.jpg');
    const woodBump = textureLoader.load('./images/wood_bump.jpg');

    [woodDiffuse, woodRoughness, woodBump].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
    });
    woodDiffuse.colorSpace = THREE.SRGBColorSpace;
    woodRoughness.colorSpace = THREE.NoColorSpace;
    woodBump.colorSpace = THREE.NoColorSpace;

    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        roughnessMap: woodRoughness,
        bumpMap: woodBump,
        bumpScale: 0.02,
        color: 0x5c4033, // Dark brown wood
        roughness: 0.9,
    });

    // Iron material for bands
    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        metalness: 0.8,
        roughness: 0.4
    });

    // Keg dimensions
    const radiusTop = 1.2;
    const radiusBottom = 1.2;
    const radiusMiddle = 1.4;
    const height = 3.5;

    // Create a barrel shape by scaling a cylinder
    const barrelGeo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 16);
    // Expand the middle vertices to create a bulge
    const positionAttr = barrelGeo.attributes.position;
    for (let i = 0; i < positionAttr.count; i++) {
        const y = positionAttr.getY(i);
        const yNorm = y / (height / 2); // -1 to 1
        const bulge = 1 - Math.abs(yNorm) * 0.5; // Basic curve
        const scale = 1 + (radiusMiddle / radiusTop - 1) * bulge;

        positionAttr.setX(i, positionAttr.getX(i) * scale);
        positionAttr.setZ(i, positionAttr.getZ(i) * scale);
    }
    barrelGeo.computeVertexNormals();

    const barrelMesh = new THREE.Mesh(barrelGeo, woodMaterial);
    barrelMesh.castShadow = true;
    barrelMesh.receiveShadow = true;

    // Shift mesh up so its bottom is at 0 (local y)
    barrelMesh.position.y = height / 2;
    group.add(barrelMesh);

    // Iron bands
    const bandOffsets = [-height * 0.35, -height * 0.15, height * 0.15, height * 0.35];
    bandOffsets.forEach(yOffset => {
        const yNorm = yOffset / (height / 2);
        const bulge = 1 - Math.abs(yNorm) * 0.5;
        const scale = 1 + (radiusMiddle / radiusTop - 1) * bulge;
        const bandRadius = radiusTop * scale + 0.02; // slightly larger than barrel at this height

        const bandGeo = new THREE.CylinderGeometry(bandRadius, bandRadius, 0.15, 16);
        const bandMesh = new THREE.Mesh(bandGeo, ironMaterial);
        bandMesh.position.y = height / 2 + yOffset;
        bandMesh.castShadow = true;
        bandMesh.receiveShadow = true;
        group.add(bandMesh);
    });

    // Spigot (Tap)
    const spigotGroup = new THREE.Group();
    spigotGroup.position.set(0, height * 0.2, radiusTop + 0.2); // Near the bottom, protruding

    const tapBaseGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8);
    tapBaseGeo.rotateX(Math.PI / 2);
    const tapBaseMesh = new THREE.Mesh(tapBaseGeo, ironMaterial);
    spigotGroup.add(tapBaseMesh);

    const tapHandleGeo = new THREE.BoxGeometry(0.05, 0.4, 0.05);
    const tapHandleMesh = new THREE.Mesh(tapHandleGeo, ironMaterial);
    tapHandleMesh.position.set(0, 0.1, 0.15);
    spigotGroup.add(tapHandleMesh);

    group.add(spigotGroup);

    scene.add(group);

    // Physics
    const Ammo = getAmmo();
    // Ammo.btCylinderShape expects half-extents. We use the middle radius for bounding
    const halfExtents = new Ammo.btVector3(radiusMiddle, height / 2, radiusMiddle);
    const shape = new Ammo.btCylinderShape(halfExtents);

    // Create static body centered on the group (needs to be offset by height/2 since we shifted the mesh)
    // Wait, the group's origin is at the bottom, so we'll offset the body internally if possible,
    // or just set the group position to the center. Let's adjust group to be centered.
    group.position.y += height / 2;
    barrelMesh.position.y = 0;
    bandOffsets.forEach((yOffset, i) => {
        group.children[i + 1].position.y = yOffset; // band meshes
    });
    spigotGroup.position.y -= height / 2; // adjust relative to new center
    spigotGroup.position.y += height * 0.2; // back to tap position

    const body = createStaticBody(physicsWorld, group, shape);

    // Cleanup
    Ammo.destroy(halfExtents);

    return { group, body };
}
