import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export async function createLamp(scene) {
    const loader = new OBJLoader();
    const textureLoader = new THREE.TextureLoader();

    // 1. Load Textures
    const texCopper = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_cooper.jpg');
    const texGlass = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass.jpg');
    const texSteel = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_steel.jpg');
    const texWood = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_wood.jpg');

    // Materials
    const matCopper = new THREE.MeshStandardMaterial({ map: texCopper, roughness: 0.4, metalness: 0.8, color: 0xffaa88 });
    const matSteel = new THREE.MeshStandardMaterial({ map: texSteel, roughness: 0.5, metalness: 0.7, color: 0xaaaaaa });
    const matWood = new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.7, metalness: 0.0 });
    const matGlass = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: texGlass, metalness: 0, roughness: 0.1, 
        transmission: 0.9, transparent: true, opacity: 0.3, thickness: 0.1, side: THREE.DoubleSide
    });

    const lampGroup = new THREE.Group();
    lampGroup.name = 'BilliardLamp';

    let object;
    try {
        object = await loader.loadAsync('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp.obj');
    } catch (e) {
        console.error("Failed to load lamp OBJ:", e);
        return { group: lampGroup, toggle: () => {} };
    }

    // 2. Apply Materials
    object.traverse((child) => {
        if (child.isMesh) {
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

    // 3. Safely Normalize Scale and Position using Group Wrappers
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Use the largest horizontal dimension to prevent explosions if the model is rotated
    const rawWidth = Math.max(size.x, size.z); 
    const targetWidth = 22.0;
    const scaleFactor = rawWidth > 0.001 ? (targetWidth / rawWidth) : 1.0;

    // Create a visual wrapper to hold the scaled/centered object
    const visualWrapper = new THREE.Group();
    
    // Shift the raw object inside the wrapper so its Top-Center is exactly at (0,0,0)
    object.position.set(-center.x, -box.max.y, -center.z);
    visualWrapper.add(object);

    // Apply the scale to the wrapper, NOT the raw geometry
    visualWrapper.scale.set(scaleFactor, scaleFactor, scaleFactor);
    lampGroup.add(visualWrapper);

    // 4. Align Lights Perfectly Inside the Shade
    const scaledHeight = size.y * scaleFactor;
    const spacing = targetWidth * 0.30; // Spread lights across 30% of the width
    const lightY = -scaledHeight * 0.45; // Push lights down into the bottom half of the shade

    const lights = [];
    const positions = [-spacing, 0, spacing];

    positions.forEach(x => {
        const light = new THREE.PointLight(0xffffee, 100, 30);
        light.position.set(x, lightY, 0);
        light.castShadow = true;
        light.shadow.bias = -0.0001;

        // Emissive Bulb Mesh
        const bulbGeo = new THREE.SphereGeometry(targetWidth * 0.02, 16, 16);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, lightY, 0);

        lampGroup.add(light);
        lampGroup.add(bulb);

        lights.push({ light, bulb, originalIntensity: 100 });
    });

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
