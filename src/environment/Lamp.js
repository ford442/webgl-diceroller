import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export async function createLamp(scene) {
    const loader = new OBJLoader();
    const textureLoader = new THREE.TextureLoader();

    // 1. Load Textures
    const texCopper = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_cooper.jpg');
    const texGlass = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass.jpg');
    // const texGlassBlend = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass_blend.jpg');
    // const texGlassBump = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass_bump.jpg');
    const texSteel = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_steel.jpg');
    const texWood = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_wood.jpg');

    // Materials
    const matCopper = new THREE.MeshStandardMaterial({
        map: texCopper,
        roughness: 0.4,
        metalness: 0.8,
        color: 0xffaa88
    });

    const matSteel = new THREE.MeshStandardMaterial({
        map: texSteel,
        roughness: 0.5,
        metalness: 0.7,
        color: 0xaaaaaa
    });

    const matWood = new THREE.MeshStandardMaterial({
        map: texWood,
        roughness: 0.7,
        metalness: 0.0
    });

    const matGlass = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: texGlass, // or use for transmission?
        metalness: 0,
        roughness: 0.1,
        transmission: 0.9,
        transparent: true,
        opacity: 0.3,
        thickness: 0.1,
        side: THREE.DoubleSide
    });

    // 2. Load Model
    const lampGroup = new THREE.Group();
    lampGroup.name = 'BilliardLamp';

    const object = await loader.loadAsync('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp.obj');

    // 3. Process Geometry
    // Calculate Center
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Move object to center (0,0,0) locally
    // Adjust Y so the top of the lamp is at 0 (hanging point)
    // The model is likely way off origin.
    // The "top" is box.max.y.
    const topY = box.max.y;

    object.position.set(-center.x, -topY, -center.z);

    // Add object to group
    lampGroup.add(object);

    // Apply Materials
    object.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            // Heuristic material assignment based on mesh names?
            // If OBJ doesn't have named groups, this might be tricky.
            // But usually export preserves names.
            // If no names, we might have to just apply a default.
            // Let's assume we can try to guess or just use steel/copper mix.
            // Since we can't see the structure, let's look at the texture usage.
            // The object is "triple billiard lamp".
            // It probably has shades (glass/metal) and a bar (wood/metal).

            // As a fallback, use Copper for everything except if we detect 'Glass'.
            // If the OBJ is a single mesh, we are stuck with one material unless we use multi-material based on groups.
            // OBJLoader creates groups for 'g' tags.

            // Let's log the child name to console if we could (we can't see it).
            // Default to Copper for metal parts, Glass for shades.
            // Since we can't distinguish easily without inspection,
            // we will make a best guess:
            // If multiple meshes exist, hopefully they are named.
            // If not, we might apply a generic "Lamp" material.

            // Let's try to map names.
            const name = child.name.toLowerCase();
            if (name.includes('glass') || name.includes('shade')) {
                child.material = matGlass;
            } else if (name.includes('wood')) {
                child.material = matWood;
            } else if (name.includes('steel') || name.includes('chain')) {
                child.material = matSteel;
            } else {
                // Default
                child.material = matCopper;
            }
        }
    });

    scene.add(lampGroup);

    // 4. Lights
    // Add 3 SpotLights along the X axis (assuming X is the long axis)
    // Box dimensions: size.x, size.y, size.z
    // We centered the object.
    // The lights should be inside the shades.
    // Shades are likely hanging down.
    // Center is at 0, -size.y/2, 0 roughly? No, we aligned Top to 0.
    // So center Y is -size.y/2.
    // If it is a triple lamp, the lights are at x = -spacing, 0, +spacing.
    // Spacing approx size.x / 3 ?

    const lights = [];
    const spacing = size.x * 0.25; // Guess
    const lightY = -size.y * 0.5; // Halfway down? Maybe lower?

    // Check if box dimensions are sane. If model scale is huge/tiny, we might need to scale lampGroup.
    // The vertices in OBJ were ~2000. If units are mm, that's 2 meters. Reasonable.
    // If units are cm, that's 20 meters. Too big.
    // If units are meters, that's 2km.
    // Most standard Three.js scenes are in meters.
    // Vertices ~2000 suggests scale might be huge (e.g. mm).
    // Our room is ~20 units high. 2000 is way too big.
    // We likely need to scale down by 0.01 or 0.001.
    // Let's scale based on assumption that a billiard lamp is ~1.5 meters wide.
    const targetWidth = 10.0; // 1.5m is too small for our physics units?
    // In our scene: Table is ~10x10?
    // Table.js: Surface 13 width.
    // So Lamp should be around 10-12 width.

    const scaleFactor = targetWidth / size.x;
    lampGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);

    // Re-calculate local offsets for lights based on SCALED size logic (or apply to group)
    // Lights are children of lampGroup, so they scale with it?
    // PointLights scale? No, PointLight range scales if in a scaled group? No.
    // We should compute positions in local space.

    // Spacing in unscaled local space:
    const localSpacing = size.x * 0.30;
    const localLightY = -size.y * 0.2; // Near the top inside the shade?

    const positions = [-localSpacing, 0, localSpacing];

    positions.forEach(x => {
        const light = new THREE.PointLight(0xffffee, 100, 30); // Intensity, Distance
        light.position.set(x, localLightY, 0);
        light.castShadow = true;
        light.shadow.bias = -0.0001;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;

        // Emissive Bulb Mesh (Visual)
        const bulbGeo = new THREE.SphereGeometry(size.x * 0.02, 16, 16);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, localLightY, 0);

        lampGroup.add(light);
        lampGroup.add(bulb);

        lights.push({ light, bulb, originalIntensity: 100 });
    });

    // Toggle Logic
    let isOn = true;
    const toggle = () => {
        isOn = !isOn;
        lights.forEach(l => {
            l.light.intensity = isOn ? l.originalIntensity : 0;
            l.bulb.material.color.setHex(isOn ? 0xffffee : 0x111111);
        });
    };

    return { group: lampGroup, toggle };
}
