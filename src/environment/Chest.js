import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createChest(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'Chest';

    // Dimensions
    const width = 1.6;  // X axis
    const depth = 1.0;  // Z axis
    const baseHeight = 0.8; // Y axis
    const lidHeight = 0.5; // Radius of cylinder part approx

    // --- Materials ---
    const loader = new THREE.TextureLoader();
    const woodDiffuse = loader.load('/images/wood_diffuse.jpg');
    const woodBump = loader.load('/images/wood_bump.jpg');
    const woodRoughness = loader.load('/images/wood_roughness.jpg');

    [woodDiffuse, woodBump, woodRoughness].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = (t === woodDiffuse) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    });

    const woodMat = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.1,
        roughnessMap: woodRoughness,
        color: 0x5c4033, // Dark Wood
        roughness: 0.8
    });

    const ironMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        metalness: 0.8,
        roughness: 0.4
    });

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.9,
        roughness: 0.3
    });

    // --- Geometry ---

    // 1. Base (Box)
    const baseGeo = new THREE.BoxGeometry(width, baseHeight, depth);
    const baseMesh = new THREE.Mesh(baseGeo, woodMat);
    // Position so bottom is at 0 (local). Center Y = baseHeight/2.
    baseMesh.position.y = baseHeight / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Lid (Rounded Top)
    // Cylinder: Radius = depth/2 = 0.5. Length = width.
    // Cylinder is Y-up by default. We want it along X axis.
    // Rotate Z 90 deg.
    // ThetaLength = PI (Half cylinder).
    // ThetaStart = 0? Default is 0 to 2PI.
    // Half cylinder: 0 to PI.
    // If we rotate Z 90, the circular face is in YZ plane. The length is along X.
    // The "cut" plane is XZ.
    // We want the flat part down.

    const lidRadius = depth / 2;
    const lidGeo = new THREE.CylinderGeometry(lidRadius, lidRadius, width, 16, 1, false, 0, Math.PI);
    const lidMesh = new THREE.Mesh(lidGeo, woodMat);

    // Rotate:
    // Cylinder Y axis (length) -> X axis. Rotate Z -90 deg.
    // Circular face starts at +X (in local cylinder space) and goes to -X via Z (or Y?).
    // Theta starts at +Z axis (usually).
    // Let's just create it and rotate until it looks right.
    // Default Cylinder: vertical.
    // Rotate Z -PI/2 -> Horizontal along X.
    // The cut part is now on top or bottom depending on theta.
    // If 0 to PI, it's half circle.
    // We need to rotate around X (local cylinder length) to orient the dome up.

    lidMesh.rotation.z = -Math.PI / 2;
    lidMesh.rotation.x = -Math.PI / 2; // Orient dome up

    // Position: Top of base.
    // Center of cylinder is axis. Axis should be at baseHeight.
    lidMesh.position.y = baseHeight;
    lidMesh.castShadow = true;
    lidMesh.receiveShadow = true;
    group.add(lidMesh);

    // Fill the flat side of the lid (cylinder doesn't cap the cut face)
    // Actually CylinderGeometry with thetaLength doesn't create the flat face.
    // We can add a plane or just let it be if it's closed?
    // Let's add a thin box for the lid bottom if needed, but it's sitting on the base, so hidden.
    // But the sides (caps) need to be filled. CylinderGeometry creates caps if openEnded is false.
    // Yes, caps are sectors.

    // 3. Iron Bands (Reinforcements)
    // Vertical bands around base and lid.
    // Band dimensions: slightly larger than chest.
    const bandWidth = 0.15;
    const bandThickness = 0.05;

    const bandXOffsets = [-width/3, width/3];

    bandXOffsets.forEach(x => {
        // Base Band (Box frame?)
        // Front/Back/Bottom.
        // Or just a slightly larger box intersecting.
        const bandBaseGeo = new THREE.BoxGeometry(bandWidth, baseHeight, depth + bandThickness);
        const bandBase = new THREE.Mesh(bandBaseGeo, ironMat);
        bandBase.position.set(x, baseHeight/2, 0);
        bandBase.receiveShadow = true;
        bandBase.castShadow = true;
        group.add(bandBase);

        // Lid Band (Torus segment or larger cylinder)
        const bandLidGeo = new THREE.CylinderGeometry(lidRadius + bandThickness/2, lidRadius + bandThickness/2, bandWidth, 16, 1, false, 0, Math.PI);
        const bandLid = new THREE.Mesh(bandLidGeo, ironMat);
        bandLid.rotation.z = -Math.PI / 2;
        bandLid.rotation.x = -Math.PI / 2;
        bandLid.position.set(x, baseHeight, 0);
        bandLid.castShadow = true;
        bandLid.receiveShadow = true;
        group.add(bandLid);
    });

    // 4. Lock (Front Center)
    const lockGeo = new THREE.BoxGeometry(0.2, 0.25, 0.1);
    const lock = new THREE.Mesh(lockGeo, goldMat);
    // Position: Front face of base, near top.
    // Base Front is Z = depth/2.
    // Y = baseHeight - 0.15.
    lock.position.set(0, baseHeight - 0.2, depth/2 + 0.02); // Slightly protruding
    lock.castShadow = true;
    lock.receiveShadow = true;
    group.add(lock);

    // Lock Hasp (Lid part)
    const haspGeo = new THREE.BoxGeometry(0.15, 0.2, 0.1);
    const hasp = new THREE.Mesh(haspGeo, ironMat);
    // Position: Bottom of lid front.
    // Lid starts at baseHeight.
    hasp.position.set(0, baseHeight + 0.05, depth/2 + 0.02);
    group.add(hasp);


    // --- Position Group ---
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    scene.add(group);

    // --- Physics ---
    if (physicsWorld) {
        const ammo = getAmmo();
        // Static Box Shape enclosing base + lid
        // Total Height = baseHeight + lidRadius (0.8 + 0.5 = 1.3).
        // Center Y (relative to group origin): 1.3 / 2 = 0.65.
        // Group Origin is at bottom of chest.

        // We can use a compound shape or a simple bounding box.
        // Simple bounding box is fine for static prop.
        const totalHeight = baseHeight + lidRadius;
        const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, totalHeight/2, depth/2));

        // Create a proxy object for physics positioning (center of mass)
        const proxy = new THREE.Object3D();
        // Visual group origin is at (x,y,z).
        // Physics center needs to be at (x, y + totalHeight/2, z).
        // Apply rotation to the offset?
        // Yes.
        const offset = new THREE.Vector3(0, totalHeight/2, 0);
        // No need to rotate offset because it's Y-axis aligned and we only rotate Y?
        // Rotation is Y-axis only. So Y offset is constant.

        proxy.position.copy(group.position).add(offset);
        proxy.quaternion.copy(group.quaternion);

        createStaticBody(physicsWorld, proxy, shape);
    }

    return group;
}
