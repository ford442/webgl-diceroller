import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createShield(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'VikingShield';

    // Dimensions
    const radius = 2.0;
    const thickness = 0.2;
    const rimThickness = 0.1;
    const bossRadius = 0.5;
    const bossHeight = 0.4;

    // --- Materials ---
    // Wood Planks
    const woodTexture = createShieldTexture();
    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodTexture,
        roughness: 0.8,
        metalness: 0.1,
        color: 0x8b4513
    });

    // Iron Rim & Boss
    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x444444,
        roughness: 0.5,
        metalness: 0.8
    });

    // Paint (Pattern) - baked into texture or overlay?
    // Let's stick to wood + iron for now, maybe simple paint strips in texture.

    // --- Geometries ---

    // 1. Main Disk
    const diskGeo = new THREE.CylinderGeometry(radius, radius, thickness, 32);
    // Cylinder is Y-up. Rotate to face Z.
    const disk = new THREE.Mesh(diskGeo, woodMaterial);
    disk.rotation.x = Math.PI / 2;
    disk.castShadow = true;
    disk.receiveShadow = true;
    group.add(disk);

    // 2. Iron Rim
    // Torus around edge
    const rimGeo = new THREE.TorusGeometry(radius, rimThickness, 8, 32);
    const rim = new THREE.Mesh(rimGeo, ironMaterial);
    // Torus lies in XY plane. Matches disk rotation if disk is rotated X 90?
    // Disk rotated X 90 -> Cylinder top faces Z. Side is cylinder wall.
    // Torus in XY needs to be rotated?
    // Let's visualize:
    // Cylinder default: Y axis. Top/Bottom circular faces.
    // Disk rotated X 90: Z axis. Faces forward/back.
    // Torus default: Ring in XY plane. Z axis is hole.
    // We want ring around Z axis.
    // So Torus default is correct if positioned at Z center?
    // Yes.
    rim.position.z = 0;
    rim.castShadow = true;
    rim.receiveShadow = true;
    group.add(rim);

    // 3. Boss (Center Dome)
    const bossGeo = new THREE.SphereGeometry(bossRadius, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const boss = new THREE.Mesh(bossGeo, ironMaterial);
    // Sphere dome is Y-up. Rotate to Z-forward.
    boss.rotation.x = Math.PI / 2;
    boss.position.z = thickness / 2; // Stick out front
    boss.castShadow = true;
    boss.receiveShadow = true;
    group.add(boss);

    // --- Position ---
    // Chimney breast at x=18 (surface), y=10, z=0.
    // Shield center at (18, 10, 0).
    // But it needs to face -X (Left).
    // Currently constructed facing Z.
    // Rotate Group -90 deg Y (-PI/2).
    // Facing Z -> Facing -X.

    group.position.set(18, 10, 0);
    group.rotation.y = -Math.PI / 2;

    // Tilt slightly down?
    group.rotation.z = -Math.PI / 12; // Tilt top forward (local Z rotation after Y rotation?)
    // Order: Y then Z?
    // Three.js Euler default is XYZ.
    // If Y=-90: Local X is now World Z. Local Z is World -X.
    // We want to tilt "down".
    // That means rotating around Local X (World Z).
    // So rotate X slightly?
    group.rotation.order = 'YXZ';
    group.rotation.x = 0; // No roll
    group.rotation.z = 0; // No tilt yet

    // Let's just use lookAt for simplicity or keep it flat against wall.
    // Wall mount usually flat.
    // Maybe slight random rotation around its center axis (Z in local).
    // Local Z is the face normal.
    // Rotating around Z spins it like a wheel.
    group.rotation.x = Math.random() * Math.PI; // Spin

    scene.add(group);

    // --- Physics ---
    // Static cylinder shape.
    // Shape orientation: Cylinder is Y-up.
    // Visual Disk is rotated X=90 (facing Z).
    // Group is rotated Y=-90 (facing -X).
    // Total Visual: Facing -X.
    // Physics Shape: Cylinder Y-up.
    // If we add Body to Group:
    // Body inherits Group transform.
    // Shape is local to Body.
    // We need Shape to match Visual *inside* the Group.
    // Visual Disk is Rot X 90.
    // So Physics Shape needs Rot X 90 relative to Y-up Cylinder?
    // Or just use a Box shape which is easier to orient?
    // Let's use Cylinder but rotate the local transform?
    // createStaticBody uses mesh.position/quaternion for the Body transform.
    // The Body center is at Group Origin.
    // The Shape is centered at Body Origin.
    // We need the Shape (Cylinder Y) to be rotated X 90 to match Visual (Cylinder Z).

    // Ammo CylinderShape is always Y-aligned.
    // We can't rotate the shape *inside* the body easily without CompoundShape.
    // Easier: Use a Box Shape approximating the shield.
    // Size: Radius*2 x Radius*2 x Thickness.
    // Box is axis aligned.
    // Visual Disk is Z-aligned (thickness in Z).
    // So Box dimensions: (Radius*2, Radius*2, Thickness).
    // This matches Visual (rotated X 90? No wait.)
    // Visual Cylinder(r, r, h):
    // r is in XZ plane (default). h is Y.
    // Rot X 90 -> r in XY plane. h in Z.
    // So Visual extends in X and Y (Radius). Thickness in Z.
    // Box(Width, Height, Depth) -> (2r, 2r, h).
    // This matches.

    const Ammo = getAmmo();
    const shape = new Ammo.btBoxShape(new Ammo.btVector3(radius, radius, thickness/2 + 0.1)); // Extra depth for rim/boss
    createStaticBody(physicsWorld, group, shape);
}

function createShieldTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Background (Dark Wood)
    ctx.fillStyle = '#5c4033';
    ctx.fillRect(0, 0, 512, 512);

    // Planks
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3e2b22';
    const plankCount = 8;
    const plankWidth = 512 / plankCount;

    for (let i = 0; i < plankCount; i++) {
        const x = i * plankWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 512);
        ctx.stroke();

        // Wood grain variation
        ctx.fillStyle = (i % 2 === 0) ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, 0, plankWidth, 512);
    }

    // Paint Design (e.g., Red Cross or Quartered)
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = '#880000'; // Red
    // Circle clip
    ctx.beginPath();
    ctx.arc(256, 256, 250, 0, Math.PI * 2);
    ctx.clip();

    // Cross
    ctx.fillRect(200, 0, 112, 512);
    ctx.fillRect(0, 200, 512, 112);

    // Nails / Rivets
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const cx = 256 + Math.cos(angle) * 200;
        const cy = 256 + Math.sin(angle) * 200;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI*2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
