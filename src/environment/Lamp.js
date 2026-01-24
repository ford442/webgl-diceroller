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
        map: texGlass,
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

    let object;
    try {
        object = await loader.loadAsync('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp.obj');
    } catch (e) {
        console.error("Failed to load lamp OBJ:", e);
        return { group: lampGroup, toggle: () => {} };
    }

    // 3. Clean and Sanitize Geometry (Fix for Precision Errors and Division by Zero)
    // The raw OBJ likely has huge coordinates or degenerate data causing X4122/X4008 errors.

    // Step A: Calculate Initial Bounding Box of the Raw Object
    const initialBox = new THREE.Box3().setFromObject(object);
    const center = initialBox.getCenter(new THREE.Vector3());
    const size = initialBox.getSize(new THREE.Vector3());

    // Target Dimensions
    const targetWidth = 10.0;
    // Prevent division by zero if size is invalid
    const rawWidth = size.x > 0.001 ? size.x : 1.0;
    const scaleFactor = targetWidth / rawWidth;

    // We want the 'Top' of the lamp (hanging point) to be at Y=0.
    // In raw coords, Top Y is initialBox.max.y.
    // We want to translate such that:
    // (Vertex - Center) * Scale ... wait.
    // If we just Center, the origin is at Center.
    // We want origin at Top Center.
    // So we translate by (-center.x, -initialBox.max.y, -center.z).

    const translation = new THREE.Vector3(-center.x, -initialBox.max.y, -center.z);

    // Apply Transformation to GEOMETRY directly
    object.traverse((child) => {
        if (child.isMesh) {
            // 1. Translate
            child.geometry.translate(translation.x, translation.y, translation.z);

            // 2. Scale
            child.geometry.scale(scaleFactor, scaleFactor, scaleFactor);

            // 3. Recompute Normals (Fixes potential 0,0,0 normals causing div by zero)
            child.geometry.computeVertexNormals();

            // 4. Ensure Bounding Sphere/Box are updated
            child.geometry.computeBoundingBox();
            child.geometry.computeBoundingSphere();

            // 5. Apply Materials
            child.castShadow = true;
            child.receiveShadow = true;

            const name = child.name.toLowerCase();
            if (name.includes('glass') || name.includes('shade')) {
                child.material = matGlass;
            } else if (name.includes('wood')) {
                child.material = matWood;
            } else if (name.includes('steel') || name.includes('chain')) {
                child.material = matSteel;
            } else {
                child.material = matCopper;
            }
        }
    });

    lampGroup.add(object);
    scene.add(lampGroup);

    // 4. Lights
    // Now the object is normalized.
    // Width is exactly targetWidth (10.0).
    // Height and Depth are scaled proportionally.
    // We can rely on these numbers.

    const scaledHeight = size.y * scaleFactor;

    // Lights are spaced along X.
    // Spacing: 30% of width?
    const spacing = targetWidth * 0.30;
    const lightY = -scaledHeight * 0.2; // Estimate inside the shade

    const lights = [];
    const positions = [-spacing, 0, spacing];

    positions.forEach(x => {
        const light = new THREE.PointLight(0xffffee, 100, 30); // Intensity, Distance
        light.position.set(x, lightY, 0);
        light.castShadow = true;
        light.shadow.bias = -0.0001;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;

        // Emissive Bulb Mesh
        const bulbGeo = new THREE.SphereGeometry(targetWidth * 0.02, 16, 16);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, lightY, 0);

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
