import * as THREE from 'three';

/** Interior radius / height used for scoop placement and WASM wall planes. */
export const DICE_CUP_INTERIOR_RADIUS = 0.42;
export const DICE_CUP_INTERIOR_HEIGHT = 0.95;
export const DICE_CUP_WALL_SEGMENTS = 8;

/**
 * Local-space inward-facing container planes (nx, ny, nz, d) for WASM.
 * d = dot(normal, pointOnPlane). Origin at cup base; Y up.
 */
export function buildDiceCupLocalPlanes(
    innerRadius = DICE_CUP_INTERIOR_RADIUS,
    floorY = 0.02,
    segments = DICE_CUP_WALL_SEGMENTS
) {
    const planes = [];
    planes.push(0, 1, 0, floorY);

    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const nx = -Math.cos(angle);
        const nz = -Math.sin(angle);
        const px = Math.cos(angle) * innerRadius;
        const pz = Math.sin(angle) * innerRadius;
        const d = nx * px + nz * pz;
        planes.push(nx, 0, nz, d);
    }
    return planes;
}

/**
 * Leather dice cup — procedural lathe mesh with exported interior plane defs.
 */
export function createDiceCup(
    scene,
    _physicsWorld,
    position = { x: 5, y: -2.75, z: 2 },
    rotationY = -Math.PI / 8
) {
    const group = new THREE.Group();
    group.name = 'DiceCup';

    const leatherMat = new THREE.MeshStandardMaterial({
        color: 0x5c3a21,
        roughness: 0.92,
        metalness: 0.0,
    });

    const stringMat = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b,
        roughness: 1.0,
        metalness: 0.0,
    });

    const _outerH = 1.05;
    const points = [];
    points.push(new THREE.Vector2(0, 0));
    points.push(new THREE.Vector2(0.35, 0.04));
    points.push(new THREE.Vector2(0.48, 0.2));
    points.push(new THREE.Vector2(0.52, 0.55));
    points.push(new THREE.Vector2(0.5, 0.85));
    points.push(new THREE.Vector2(0.55, 0.95));
    points.push(new THREE.Vector2(0.52, 1.0));
    points.push(new THREE.Vector2(0.46, 1.02));
    points.push(new THREE.Vector2(0.38, 0.98));
    points.push(new THREE.Vector2(0.32, 0.88));
    points.push(new THREE.Vector2(0, 0.82));

    const bodyGeo = new THREE.LatheGeometry(points, 32);
    const bodyMesh = new THREE.Mesh(bodyGeo, leatherMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    const tieGeo = new THREE.TorusGeometry(0.34, 0.035, 8, 32);
    const tieMesh = new THREE.Mesh(tieGeo, stringMat);
    tieMesh.rotation.x = Math.PI / 2;
    tieMesh.position.y = 0.88;
    tieMesh.castShadow = true;
    group.add(tieMesh);

    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    scene.add(group);

    const colliderLocalPlanes = buildDiceCupLocalPlanes();
    let interactCallback = null;

    return {
        group,
        colliderLocalPlanes,
        /** @param {() => void} fn */
        setInteract(fn) {
            interactCallback = fn;
        },
        interact() {
            interactCallback?.();
        },
        getState() {
            return {
                name: 'DiceCup',
                position: { x: group.position.x, y: group.position.y, z: group.position.z },
                rotationY: group.rotation.y,
            };
        },
    };
}
