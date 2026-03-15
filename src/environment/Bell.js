import * as THREE from 'three';

export function createBell(scene, position = { x: -8, y: -2.75, z: 2 }) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);

    // Brass Material for the Bell
    const brassMaterial = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        roughness: 0.3,
        metalness: 0.8,
    });

    // Wood Material for the Handle
    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.8,
        metalness: 0.1,
    });

    // 1. The Bell Body (LatheGeometry for a nice bell shape)
    const points = [];
    points.push(new THREE.Vector2(0, 0));
    points.push(new THREE.Vector2(1.2, 0));
    points.push(new THREE.Vector2(1.1, 0.5));
    points.push(new THREE.Vector2(0.8, 1.0));
    points.push(new THREE.Vector2(0.5, 1.5));
    points.push(new THREE.Vector2(0.4, 1.8));
    points.push(new THREE.Vector2(0.0, 1.8));

    const bellGeometry = new THREE.LatheGeometry(points, 32);
    const bellBody = new THREE.Mesh(bellGeometry, brassMaterial);
    bellBody.castShadow = true;
    bellBody.receiveShadow = true;
    group.add(bellBody);

    // 2. The Bell Handle
    const handleGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 16);
    const handle = new THREE.Mesh(handleGeometry, woodMaterial);
    handle.position.set(0, 1.8 + 0.75, 0); // Above the bell body
    handle.castShadow = true;
    handle.receiveShadow = true;
    group.add(handle);

    // 3. The Bell Clapper (small sphere inside)
    const clapperGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const clapper = new THREE.Mesh(clapperGeometry, brassMaterial);
    clapper.position.set(0, 0.2, 0);
    clapper.castShadow = true;
    group.add(clapper);

    scene.add(group);

    return group;
}
