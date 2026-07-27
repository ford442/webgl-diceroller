import * as THREE from 'three';
import { getPropAmmo, createPropStaticBody } from './PropPhysics.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createDiceTower(
    scene,
    physicsWorld,
    position = { x: 12, y: -3.0, z: -8 },
    rotationY = -Math.PI / 6
) {
    const ammo = getPropAmmo();
    const group = new THREE.Group();
    group.name = 'DiceTower';

    const { diffuse: woodDiffuse, bump: woodBump, roughness: woodRoughness } = getWoodTextures();

    const woodMat = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.1,
        roughnessMap: woodRoughness,
        color: 0x8b5a2b,
        roughness: 0.8,
    });

    const width = 6;
    const depth = 6;
    const height = 15;
    const thickness = 0.5;

    const compoundShape = ammo && physicsWorld ? new ammo.btCompoundShape() : null;

    function addPart(w, h, d, x, y, z, rotX = 0, rotY = 0, rotZ = 0) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, woodMat);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rotX, rotY, rotZ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        if (compoundShape && ammo) {
            const shape = new ammo.btBoxShape(new ammo.btVector3(w / 2, h / 2, d / 2));
            const transform = new ammo.btTransform();
            transform.setIdentity();
            transform.setOrigin(new ammo.btVector3(x, y, z));
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ));
            transform.setRotation(new ammo.btQuaternion(q.x, q.y, q.z, q.w));
            compoundShape.addChildShape(transform, shape);
            ammo.destroy(transform);
        }
    }

    addPart(width, height, thickness, 0, height / 2, -depth / 2 + thickness / 2);
    addPart(thickness, height, depth, -width / 2 + thickness / 2, height / 2, 0);
    addPart(thickness, height, depth, width / 2 - thickness / 2, height / 2, 0);

    const frontH = height / 3;
    addPart(width, frontH, thickness, 0, height - frontH / 2, depth / 2 - thickness / 2);

    const rampThick = 0.2;
    const rampW = width - thickness * 2 - 0.1;
    const rampLen = depth * 0.9;

    addPart(rampW, rampThick, rampLen, 0, 11, -0.5, 0.6, 0, 0);
    addPart(rampW, rampThick, rampLen, 0, 7, 0.5, -0.6, 0, 0);
    addPart(rampW, rampThick, rampLen + 1, 0, 3, -0.5, 0.6, 0, 0);

    const trayDepth = 8;
    const trayHeight = 2;
    const trayZ = depth / 2 + trayDepth / 2 - thickness;

    addPart(width, thickness, trayDepth, 0, thickness / 2, trayZ);
    addPart(thickness, trayHeight, trayDepth, -width / 2 + thickness / 2, trayHeight / 2, trayZ);
    addPart(thickness, trayHeight, trayDepth, width / 2 - thickness / 2, trayHeight / 2, trayZ);
    addPart(width, trayHeight, thickness, 0, trayHeight / 2, trayZ + trayDepth / 2 - thickness / 2);

    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    scene.add(group);

    if (compoundShape && physicsWorld) {
        createPropStaticBody(physicsWorld, group, compoundShape);
    }

    return { group };
}
