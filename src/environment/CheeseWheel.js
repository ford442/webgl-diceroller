import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createCheeseWheel(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'CheeseWheel';

    // Visuals: A cheese wheel with a wedge taken out
    const radius = 0.8;
    const height = 0.4;

    // Extrude a Pacman shape
    const shape = new THREE.Shape();
    // Arc: x, y, radius, startAngle, endAngle, clockwise
    shape.moveTo(0, 0);
    shape.arc(0, 0, radius, 0, Math.PI * 1.7, false);
    shape.lineTo(0, 0);

    const extrudeSettings = {
        depth: height,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.05,
        bevelThickness: 0.05
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // ExtrudeGeometry builds along the Z axis (from 0 to depth).
    // Let's rotate it to lay flat on the XZ plane.
    // By default, front face is XY.
    // Rotate 90 degrees around X axis so Z becomes -Y.
    // That means it will go from Y=0 to Y=-height.
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
        color: 0xfada5e, // Cheese yellow
        roughness: 0.6,
        metalness: 0.0,
        bumpScale: 0.02
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Shift the geometry up so it's centered on Y
    // Currently it goes from 0 to height. We want -height/2 to height/2.
    // Wait, rotateX(-Math.PI/2) maps Z (0 to depth) to Y (0 to depth). Wait, Z becomes Y if we rotate around X?
    // Let's check: vector(0,0,1) rotated around X by -90:
    // x = 0, y = -sin(-90)*1 = 1. So Z becomes +Y.
    // It goes from Y=0 to Y=height.
    // To center, we shift by -height/2.
    geometry.translate(0, -height / 2, 0);

    group.add(mesh);

    // Position on table
    // Table top is -2.75. Center of cheese = -2.75 + height/2.
    group.position.set(-6, -2.75 + height / 2, -2);
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    if (physicsWorld) {
        const ammo = getAmmo();
        // Approximate with a full cylinder shape for physics
        // btCylinderShape expects a vector of half-extents.
        // For a cylinder along Y axis, the half-extents are (radius, height/2, radius).
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height / 2, radius));
        createStaticBody(physicsWorld, group, shape);
    }

    return { group };
}
