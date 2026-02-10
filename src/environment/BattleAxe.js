import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createBattleAxe(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'BattleAxe';

    // Dimensions
    const handleLen = 8.0;
    const handleRad = 0.15;
    const bladeWidth = 2.0; // Tip to tip
    const bladeHeight = 1.5;
    const bladeThick = 0.2;

    // Materials
    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.9,
        metalness: 0.1
    });

    const steelMaterial = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        roughness: 0.3,
        metalness: 0.9
    });

    // --- Geometries ---

    // 1. Handle (Cylinder)
    const handleGeo = new THREE.CylinderGeometry(handleRad, handleRad, handleLen, 16);
    const handle = new THREE.Mesh(handleGeo, woodMaterial);
    handle.castShadow = true;
    handle.receiveShadow = true;
    // Move pivot to bottom so rotation is easier?
    // Or center?
    // Let's center handle Y at handleLen/2.
    // So handle pivot is at bottom end.
    handle.position.y = handleLen / 2;
    group.add(handle);

    // 2. Axe Head (Double Blade)
    // Draw shape
    const shape = new THREE.Shape();
    // Start at center (0,0) - attachment to handle
    shape.moveTo(0, -0.5); // Bottom of center
    shape.lineTo(0.5, -0.5); // Right
    // Curve out for right blade
    shape.quadraticCurveTo(bladeWidth/2, -bladeHeight/2, bladeWidth/2 + 0.5, -bladeHeight/2 - 0.5); // Bottom tip
    shape.quadraticCurveTo(bladeWidth/2 - 0.2, 0, bladeWidth/2 + 0.5, bladeHeight/2 + 0.5); // Top tip
    shape.quadraticCurveTo(bladeWidth/2, bladeHeight/2, 0.5, 0.5); // Top right center
    // Left side (symmetric)
    shape.lineTo(-0.5, 0.5);
    shape.quadraticCurveTo(-bladeWidth/2, bladeHeight/2, -bladeWidth/2 - 0.5, bladeHeight/2 + 0.5);
    shape.quadraticCurveTo(-bladeWidth/2 + 0.2, 0, -bladeWidth/2 - 0.5, -bladeHeight/2 - 0.5);
    shape.quadraticCurveTo(-bladeWidth/2, -bladeHeight/2, -0.5, -0.5);
    shape.lineTo(0, -0.5); // Close loop

    const extrudeSettings = {
        steps: 1,
        depth: bladeThick,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 2
    };

    const headGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Center the extrusion
    headGeo.center();

    const head = new THREE.Mesh(headGeo, steelMaterial);
    // Position at top of handle
    head.position.y = handleLen - 1.0;
    // Rotate 90 deg so blade faces forward?
    // Shape is in XY plane. Extrusion depth Z.
    // Handle is Y-up.
    // Blade edge should be forward/back or left/right?
    // Let's make it face X (Right) / -X (Left).
    // So flat side faces Z?
    // Currently shape in XY -> Flat facing Z. Correct.
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    // --- Position ---
    // Lean against table leg at (9.25, -3, 9.25).
    // Floor at -10.
    // Axe base at (x, -10, z).
    // Lean top against leg.
    // Handle length 8.
    // Triangle: H = 8. Height = 7 (from -10 to -3).
    // Base dist = sqrt(8^2 - 7^2) = sqrt(64 - 49) = sqrt(15) ~ 3.8.
    // So base should be ~3.8 units away from leg.

    const legPos = new THREE.Vector3(9.25, -3, 9.25);
    // Lean direction: Towards center? Or just against outside corner?
    // Let's lean against the outside corner leg.
    // Base at (9.25 + 2, -10, 9.25 + 2).
    const basePos = new THREE.Vector3(12, -10, 12);

    // Set Group Position to base
    group.position.copy(basePos);

    // Look At leg top
    group.lookAt(legPos);
    // This orients Z axis to look at leg.
    // Handle is along Y.
    // We want handle (Y) to point to leg.
    // Rotate X 90?
    // If LookAt aligns Z, and we want Y to align Z: Rotate X -90.
    group.rotateX(Math.PI / 2); // Rotate up 90 deg around X (local)

    // Now handle points to leg.
    // Distance check: base to leg is ~4. handle is 8.
    // It will poke through leg.
    // But it's decorative.
    // We want it to just touch.
    // Handle len 8.
    // Base at 0. Tip at 8.
    // Leg is at distance ~4.
    // So handle goes through leg and extends 4 units beyond.
    // We want tip to rest on leg?
    // Or just lean.
    // Let's shorten handle visual or move base further?
    // Or just let it stick up past the table edge.
    // If it leans against leg, the head is usually at the top.
    // Head is at handleLen - 1 = 7.
    // Leg height -3. Floor -10. Diff 7.
    // So head is exactly at table height.
    // Perfect.

    scene.add(group);

    // --- Physics ---
    // Approximating with a Box Hull around the whole axe?
    // Long thin box.
    // Or just a Cylinder for handle. Head doesn't need collision if it's high up.
    // Handle is main obstacle.
    // Size: Radius*2, Length, Radius*2.
    // Shape orientation: Y-up.
    // Group orientation: Angled.
    // Body inherits Group.
    // So Y-up Cylinder Shape inside Body matches Y-up Handle visual.
    // Correct.

    // Shape center is at (0,0,0) local.
    // Handle visual center is at (0, handleLen/2, 0) local (pivot at bottom).
    // Wait, handle mesh position was y = handleLen/2.
    // Shape needs to be at same relative position to Group pivot (0,0,0).
    // Group pivot is at base (0,0,0).
    // Handle visual center (0, 4, 0).
    // Physics Shape center must be at (0, 4, 0) relative to Body (0,0,0).
    // But createStaticBody uses mesh.position for Body Origin.
    // Body Origin = Group Origin = Base.
    // Shape is centered on Body Origin by default unless we offset it.
    // createStaticBody assumes Mesh Center == Body Center.
    // Here Group Center != Visual Center.
    // If we use createStaticBody(group), Body is at Group.position.
    // Shape is at (0,0,0) relative to Body.
    // Visual handle is at (0, 4, 0).
    // We need Shape at (0, 4, 0).
    // Can we offset shape? CompoundShape.

    // Or just use a Box spanning the length?
    // Or move Group origin to center of handle?
    // If we move group origin to center:
    // Group.position = Midpoint(Base, Tip).
    // Visual handle.position = 0.
    // Then createStaticBody works.

    // Let's adjust Group Pivot.
    // Center of axe is at handleLen/2 = 4.
    // Group Position should be Base + (Leg - Base).normalize() * 4.
    // Visual Handle position = 0.
    // Visual Head position = (handleLen - 1) - 4 = 3.

    // Re-calculate
    const direction = new THREE.Vector3().subVectors(legPos, basePos).normalize();
    const midPoint = new THREE.Vector3().copy(basePos).add(direction.clone().multiplyScalar(handleLen / 2));

    group.position.copy(midPoint);
    group.lookAt(legPos);
    group.rotateX(Math.PI / 2);

    // Reset visual positions relative to new center
    handle.position.y = 0; // Centered
    head.position.y = (handleLen / 2) - 1.0; // Top part

    // Re-add to scene (it was added before pos update, which is fine, but good to be clean)

    // Now create physics
    const Ammo = getAmmo();
    const physicsShape = new Ammo.btCylinderShape(new Ammo.btVector3(handleRad, handleLen/2, handleRad));
    createStaticBody(physicsWorld, group, physicsShape);
}
