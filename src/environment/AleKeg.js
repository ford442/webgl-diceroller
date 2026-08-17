import * as THREE from 'three';
import { getWoodTextures } from '../core/TexturePipeline.js';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createAleKeg(scene, physicsWorld, position, rotationY) {
    const radiusTop = 1.2;
    const radiusBottom = 1.2;
    const radiusMiddle = 1.4;
    const height = 3.5;
    const bandOffsets = [-height * 0.35, -height * 0.15, height * 0.15, height * 0.35];

    const { diffuse: woodDiffuse, roughness: woodRoughness, bump: woodBump } = getWoodTextures();

    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        roughnessMap: woodRoughness,
        bumpMap: woodBump,
        bumpScale: 0.02,
        color: 0x5c4033,
        roughness: 0.9,
    });

    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        metalness: 0.8,
        roughness: 0.4,
    });

    return createProp(scene, physicsWorld, {
        name: 'AleKeg',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'cylinder',
                radius: radiusMiddle,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const barrelGeo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 16);
            const positionAttr = barrelGeo.attributes.position;
            for (let i = 0; i < positionAttr.count; i++) {
                const y = positionAttr.getY(i);
                const yNorm = y / (height / 2);
                const bulge = 1 - Math.abs(yNorm) * 0.5;
                const scale = 1 + (radiusMiddle / radiusTop - 1) * bulge;
                positionAttr.setX(i, positionAttr.getX(i) * scale);
                positionAttr.setZ(i, positionAttr.getZ(i) * scale);
            }
            barrelGeo.computeVertexNormals();

            group.add(mesh(barrelGeo, woodMaterial));

            bandOffsets.forEach((yOffset) => {
                const yNorm = yOffset / (height / 2);
                const bulge = 1 - Math.abs(yNorm) * 0.5;
                const scale = 1 + (radiusMiddle / radiusTop - 1) * bulge;
                const bandRadius = radiusTop * scale + 0.02;

                const bandGeo = new THREE.CylinderGeometry(bandRadius, bandRadius, 0.15, 16);
                group.add(mesh(bandGeo, ironMaterial, { position: { y: yOffset } }));
            });

            const spigotGroup = new THREE.Group();
            spigotGroup.position.set(0, height * 0.2 - height / 2, radiusTop + 0.2);

            const tapBaseGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8);
            tapBaseGeo.rotateX(Math.PI / 2);
            spigotGroup.add(mesh(tapBaseGeo, ironMaterial));

            const tapHandleGeo = new THREE.BoxGeometry(0.05, 0.4, 0.05);
            spigotGroup.add(
                mesh(tapHandleGeo, ironMaterial, { position: { x: 0, y: 0.1, z: 0.15 } })
            );

            group.add(spigotGroup);
        },
    });
}
