import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

// Light Effect Modes
export const LampMode = {
    NORMAL: 'normal',
    UV: 'uv',
    STROBE: 'strobe',
    RGB: 'rgb',
    LASER: 'laser',
    CRITICAL: 'critical'
};

// Colors for different modes
const MODE_COLORS = {
    [LampMode.NORMAL]: 0xffffee,
    [LampMode.UV]: 0x8b00ff,
    [LampMode.STROBE]: 0xffffff,
    [LampMode.RGB]: null,
    [LampMode.LASER]: 0xff0000,
    [LampMode.CRITICAL]: 0xffd700
};

export async function createLamp(scene) {
    const loader = new OBJLoader();
    const textureLoader = new THREE.TextureLoader();

    // Load Textures
    const texCopper = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_cooper.jpg');
    const texGlass = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass.jpg');
    const texSteel = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_steel.jpg');
    const texWood = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_wood.jpg');

    const matCopper = new THREE.MeshStandardMaterial({
        map: texCopper, roughness: 0.4, metalness: 0.8, color: 0xffaa88
    });
    const matSteel = new THREE.MeshStandardMaterial({
        map: texSteel, roughness: 0.5, metalness: 0.7, color: 0xaaaaaa
    });
    const matWood = new THREE.MeshStandardMaterial({
        map: texWood, roughness: 0.7, metalness: 0.0
    });
    const matGlass = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: texGlass, metalness: 0, roughness: 0.1,
        transmission: 0.9, transparent: true, opacity: 0.3,
        thickness: 0.1, side: THREE.DoubleSide
    });

    const lampGroup = new THREE.Group();
    lampGroup.name = 'BilliardLamp';

    let object;
    try {
        object = await loader.loadAsync('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp.obj');
    } catch (e) {
        console.error("Failed to load lamp OBJ:", e);
        return { group: lampGroup, toggle: () => {}, setMode: () => {}, update: () => {} };
    }

    // Compute bounding box of raw object
    const initialBox = new THREE.Box3().setFromObject(object);
    const center = initialBox.getCenter(new THREE.Vector3());
    const size = initialBox.getSize(new THREE.Vector3());

    console.log('[Lamp] Raw model bounds:', {
        min: initialBox.min.toArray(),
        max: initialBox.max.toArray(),
        center: center.toArray(),
        size: size.toArray()
    });

    // Target dimensions
    const targetWidth = 22.0;
    const targetHeight = 6.0; // Maximum height we want the lamp to be

    // Calculate uniform scale to fit width
    const scaleX = targetWidth / size.x;
    
    // Apply scale to all axes uniformly to maintain proportions, then squash if too tall
    const uniformScale = scaleX;
    const scaledHeight = size.y * uniformScale;
    const squashY = scaledHeight > targetHeight ? targetHeight / scaledHeight : 1.0;
    const finalScaleY = uniformScale * squashY;

    console.log('[Lamp] Scaling:', {
        rawSize: size.toArray(),
        scaleX,
        uniformScale,
        scaledHeight,
        squashY,
        finalScaleY,
        finalHeight: size.y * finalScaleY
    });

    // Transform geometry: 
    // 1. Center in X and Z
    // 2. Move top to Y=0 (so lamp hangs DOWN from its position)
    // 3. Scale
    object.traverse((child) => {
        if (child.isMesh) {
            // Translate: center X/Z, move top to 0
            child.geometry.translate(-center.x, -initialBox.max.y, -center.z);
            
            // Scale: uniform X/Z, potentially squashed Y
            child.geometry.scale(uniformScale, finalScaleY, uniformScale);
            
            // Recompute
            child.geometry.computeVertexNormals();
            child.geometry.computeBoundingBox();
            child.geometry.computeBoundingSphere();

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

    // Verify final bounds
    const finalBox = new THREE.Box3().setFromObject(object);
    console.log('[Lamp] Final model bounds:', {
        min: finalBox.min.toArray(),
        max: finalBox.max.toArray(),
        size: finalBox.getSize(new THREE.Vector3()).toArray()
    });

    lampGroup.add(object);
    scene.add(lampGroup);

    // Lights - position inside the lamp shade
    const finalSize = finalBox.getSize(new THREE.Vector3());
    const lightY = -finalSize.y * 0.3; // Inside the shade, not at bottom
    const spacing = targetWidth * 0.25;

    const lights = [];
    const positions = [-spacing, 0, spacing];

    positions.forEach(x => {
        const light = new THREE.PointLight(MODE_COLORS[LampMode.NORMAL], 80, 25);
        light.position.set(x, lightY, 0);
        light.castShadow = true;
        light.shadow.bias = -0.0001;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;

        const bulbGeo = new THREE.SphereGeometry(0.3, 16, 16);
        const bulbMat = new THREE.MeshBasicMaterial({ color: MODE_COLORS[LampMode.NORMAL] });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, lightY, 0);

        lampGroup.add(light);
        lampGroup.add(bulb);
        lights.push({ light, bulb, originalIntensity: 80 });
    });

    // Laser beams
    const lasers = [];
    const laserGeo = new THREE.CylinderGeometry(0.02, 0.02, 15, 8);
    laserGeo.translate(0, -7.5, 0);
    
    positions.forEach((x, i) => {
        const laserMat = new THREE.MeshBasicMaterial({ 
            color: 0xff0000, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending
        });
        const laser = new THREE.Mesh(laserGeo, laserMat);
        laser.position.set(x, lightY, 0);
        laser.rotation.z = (i - 1) * 0.15;
        lampGroup.add(laser);
        lasers.push(laser);
    });

    // State
    let currentMode = LampMode.NORMAL;
    let isOn = true;
    let strobeState = false;
    let strobeTimer = 0;
    let rgbHue = 0;
    let criticalTime = 0;
    let isRolling = false;

    const updateLights = () => {
        const color = MODE_COLORS[currentMode] || MODE_COLORS[LampMode.NORMAL];
        lights.forEach(l => {
            if (!isOn) {
                l.light.intensity = 0;
                l.bulb.material.color.setHex(0x111111);
            } else {
                l.light.intensity = l.originalIntensity;
                l.light.color.setHex(color);
                l.bulb.material.color.setHex(color);
            }
        });
    };

    const setMode = (mode) => {
        if (!Object.values(LampMode).includes(mode)) return;
        currentMode = mode;
        strobeState = false;
        strobeTimer = 0;
        criticalTime = 0;
        lasers.forEach(l => l.material.opacity = 0);
        updateLights();
    };

    const setRolling = (rolling) => {
        isRolling = rolling;
    };

    const triggerCritical = () => {
        const prevMode = currentMode;
        setMode(LampMode.CRITICAL);
        criticalTime = 0;
        setTimeout(() => {
            if (currentMode === LampMode.CRITICAL) setMode(prevMode);
        }, 3000);
    };

    const toggle = () => {
        isOn = !isOn;
        updateLights();
    };

    const update = (deltaTime, elapsedTime) => {
        if (!isOn) return;

        switch (currentMode) {
            case LampMode.STROBE:
            case LampMode.NORMAL:
                if (isRolling || currentMode === LampMode.STROBE) {
                    strobeTimer += deltaTime;
                    if (strobeTimer > 0.05) {
                        strobeTimer = 0;
                        strobeState = !strobeState;
                        lights.forEach(l => {
                            l.light.intensity = strobeState ? l.originalIntensity * 2 : 0;
                        });
                    }
                } else if (!isRolling) {
                    lights.forEach(l => l.light.intensity = l.originalIntensity);
                }
                break;

            case LampMode.RGB:
                rgbHue += deltaTime * 60;
                if (rgbHue > 360) rgbHue -= 360;
                const rgbColor = new THREE.Color().setHSL(rgbHue / 360, 1, 0.5);
                lights.forEach(l => {
                    l.light.color.copy(rgbColor);
                    l.bulb.material.color.copy(rgbColor);
                });
                break;

            case LampMode.UV:
                const uvPulse = 0.8 + Math.sin(elapsedTime * 3) * 0.2;
                lights.forEach(l => l.light.intensity = l.originalIntensity * uvPulse);
                break;

            case LampMode.LASER:
                lasers.forEach((laser, i) => {
                    laser.material.opacity = 0.6 + Math.sin(elapsedTime * 5 + i) * 0.2;
                    laser.rotation.y = elapsedTime * 2 + i * (Math.PI * 2 / 3);
                });
                lights.forEach(l => {
                    l.light.intensity = l.originalIntensity * 0.3;
                    l.light.color.setHex(0xff0000);
                });
                break;

            case LampMode.CRITICAL:
                criticalTime += deltaTime;
                const flash = Math.sin(criticalTime * 20) > 0;
                const critColor = flash ? 0xffd700 : 0xffffff;
                lights.forEach(l => {
                    l.light.color.setHex(critColor);
                    l.light.intensity = flash ? 150 : 100;
                    l.bulb.material.color.setHex(critColor);
                });
                lasers.forEach((laser, i) => {
                    laser.material.color.setHex(0xffd700);
                    laser.material.opacity = 0.8;
                    laser.rotation.y = criticalTime * 8 + i * (Math.PI * 2 / 3);
                });
                break;
        }
    };

    const handleKey = (key) => {
        switch (key) {
            case '1': setMode(LampMode.NORMAL); break;
            case '2': setMode(LampMode.UV); break;
            case '3': setMode(LampMode.RGB); break;
            case '4': setMode(LampMode.LASER); break;
            case '5': setMode(LampMode.STROBE); break;
            case 'c': case 'C': triggerCritical(); break;
        }
    };

    return { 
        group: lampGroup, toggle, setMode, setRolling,
        triggerCritical, update, handleKey,
        getMode: () => currentMode,
        LampMode
    };
}
