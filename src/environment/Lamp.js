import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

// Light Effect Modes
export const LampMode = {
    NORMAL: 'normal',
    UV: 'uv',
    STROBE: 'strobe',
    RGB: 'rgb',
    LASER: 'laser',
    CRITICAL: 'critical' // Rolled a 20!
};

// Colors for different modes
const MODE_COLORS = {
    [LampMode.NORMAL]: 0xffffee,
    [LampMode.UV]: 0x8b00ff,      // Deep violet
    [LampMode.STROBE]: 0xffffff,
    [LampMode.RGB]: null,          // Dynamic
    [LampMode.LASER]: 0xff0000,    // Red lasers
    [LampMode.CRITICAL]: 0xffd700  // Gold
};

export async function createLamp(scene) {
    const loader = new OBJLoader();
    const textureLoader = new THREE.TextureLoader();

    // 1. Load Textures
    const texCopper = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_cooper.jpg');
    const texGlass = textureLoader.load('./images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass.jpg');
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
        return { group: lampGroup, toggle: () => {}, setMode: () => {}, update: () => {} };
    }

    // 3. Clean and Sanitize Geometry
    const initialBox = new THREE.Box3().setFromObject(object);
    const center = initialBox.getCenter(new THREE.Vector3());
    const size = initialBox.getSize(new THREE.Vector3());

    // Target Dimensions - Scale to fit nicely above table
    const targetWidth = 22.0;
    const maxHeight = 8.0; // Prevent lamp from hanging too low
    
    const rawWidth = size.x > 0.001 ? size.x : 1.0;
    const scaleFactor = targetWidth / rawWidth;
    
    // Calculate scaled height and squash if necessary
    const scaledHeight = size.y * scaleFactor;
    const heightScale = scaledHeight > maxHeight ? maxHeight / scaledHeight : 1.0;

    // We want the 'Top' of the lamp (hanging point) to be at Y=0.
    const translation = new THREE.Vector3(-center.x, -initialBox.max.y, -center.z);

    // Apply Transformation to GEOMETRY directly
    object.traverse((child) => {
        if (child.isMesh) {
            // 1. Translate to center top
            child.geometry.translate(translation.x, translation.y, translation.z);

            // 2. Scale - squash Y if too tall
            child.geometry.scale(scaleFactor, scaleFactor * heightScale, scaleFactor);

            // 3. Recompute Normals
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
    const finalHeight = Math.min(scaledHeight, maxHeight);
    const spacing = targetWidth * 0.30;
    const lightY = -finalHeight * 0.2; // Inside the shade

    const lights = [];
    const positions = [-spacing, 0, spacing];

    positions.forEach(x => {
        const light = new THREE.PointLight(MODE_COLORS[LampMode.NORMAL], 100, 30);
        light.position.set(x, lightY, 0);
        light.castShadow = true;
        light.shadow.bias = -0.0001;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;

        // Emissive Bulb Mesh
        const bulbGeo = new THREE.SphereGeometry(targetWidth * 0.02, 16, 16);
        const bulbMat = new THREE.MeshBasicMaterial({ color: MODE_COLORS[LampMode.NORMAL] });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, lightY, 0);

        lampGroup.add(light);
        lampGroup.add(bulb);

        lights.push({ light, bulb, originalIntensity: 100 });
    });

    // 5. Laser Beams (hidden by default)
    const lasers = [];
    const laserGeo = new THREE.CylinderGeometry(0.02, 0.02, 20, 8);
    laserGeo.translate(0, -10, 0); // Extend downward
    
    positions.forEach((x, i) => {
        const laserMat = new THREE.MeshBasicMaterial({ 
            color: 0xff0000, 
            transparent: true, 
            opacity: 0,
            blending: THREE.AdditiveBlending
        });
        const laser = new THREE.Mesh(laserGeo, laserMat);
        laser.position.set(x, lightY, 0);
        laser.rotation.z = (i - 1) * 0.1; // Slight angle spread
        lampGroup.add(laser);
        lasers.push(laser);
    });

    // 6. Light Effects State
    let currentMode = LampMode.NORMAL;
    let isOn = true;
    let strobeState = false;
    let strobeTimer = 0;
    let rgbHue = 0;
    let criticalTime = 0;
    let isRolling = false;

    // Toggle Logic
    const toggle = () => {
        isOn = !isOn;
        updateLights();
    };

    // Update light visuals based on current mode
    function updateLights() {
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
    }

    // Set Mode Function
    const setMode = (mode) => {
        if (!Object.values(LampMode).includes(mode)) {
            console.warn(`Unknown lamp mode: ${mode}`);
            return;
        }
        currentMode = mode;
        
        // Reset special states
        strobeState = false;
        strobeTimer = 0;
        criticalTime = 0;
        
        // Hide lasers by default
        lasers.forEach(laser => {
            laser.material.opacity = 0;
        });
        
        updateLights();
    };

    // Set Rolling State (triggers strobe or other effects)
    const setRolling = (rolling) => {
        isRolling = rolling;
        if (rolling && currentMode === LampMode.NORMAL) {
            // Auto-switch to strobe during rolling in normal mode
            // Or we can keep current mode and just add strobe overlay
        }
    };

    // Trigger Critical Hit Effect (Rolled a 20!)
    const triggerCritical = () => {
        const prevMode = currentMode;
        setMode(LampMode.CRITICAL);
        criticalTime = 0;
        
        // Return to previous mode after 3 seconds
        setTimeout(() => {
            if (currentMode === LampMode.CRITICAL) {
                setMode(prevMode);
            }
        }, 3000);
    };

    // Update Function (called every frame)
    const update = (deltaTime, elapsedTime) => {
        if (!isOn) return;

        switch (currentMode) {
            case LampMode.STROBE:
            case LampMode.NORMAL: // Strobe during rolling even in normal mode
                if (isRolling || currentMode === LampMode.STROBE) {
                    strobeTimer += deltaTime;
                    if (strobeTimer > 0.05) { // 20Hz strobe
                        strobeTimer = 0;
                        strobeState = !strobeState;
                        lights.forEach(l => {
                            l.light.intensity = strobeState ? l.originalIntensity * 2 : 0;
                        });
                    }
                } else if (currentMode === LampMode.NORMAL && !isRolling) {
                    // Restore normal intensity
                    lights.forEach(l => {
                        l.light.intensity = l.originalIntensity;
                    });
                }
                break;

            case LampMode.RGB:
                rgbHue += deltaTime * 60; // Cycle through hues
                if (rgbHue > 360) rgbHue -= 360;
                const rgbColor = new THREE.Color().setHSL(rgbHue / 360, 1, 0.5);
                lights.forEach(l => {
                    l.light.color.copy(rgbColor);
                    l.bulb.material.color.copy(rgbColor);
                });
                break;

            case LampMode.UV:
                // Pulsing UV effect
                const uvPulse = 0.8 + Math.sin(elapsedTime * 3) * 0.2;
                lights.forEach(l => {
                    l.light.intensity = l.originalIntensity * uvPulse;
                });
                break;

            case LampMode.LASER:
                // Show and animate lasers
                lasers.forEach((laser, i) => {
                    laser.material.opacity = 0.6 + Math.sin(elapsedTime * 5 + i) * 0.2;
                    laser.rotation.y = elapsedTime * 2 + i * (Math.PI * 2 / 3);
                });
                // Dim the regular lights
                lights.forEach(l => {
                    l.light.intensity = l.originalIntensity * 0.3;
                    l.light.color.setHex(0xff0000);
                });
                break;

            case LampMode.CRITICAL:
                criticalTime += deltaTime;
                // Rapid flashing gold/white
                const flashSpeed = 10; // Hz
                const flash = Math.sin(criticalTime * flashSpeed * Math.PI * 2) > 0;
                const critColor = flash ? 0xffd700 : 0xffffff;
                const critIntensity = flash ? 200 : 150;
                
                lights.forEach(l => {
                    l.light.color.setHex(critColor);
                    l.light.intensity = critIntensity;
                    l.bulb.material.color.setHex(critColor);
                });
                
                // Spinning lasers
                lasers.forEach((laser, i) => {
                    laser.material.color.setHex(0xffd700);
                    laser.material.opacity = 0.8;
                    laser.rotation.y = criticalTime * 5 + i * (Math.PI * 2 / 3);
                });
                break;
        }
    };

    // Keyboard controls helper
    const handleKey = (key) => {
        switch (key) {
            case '1': setMode(LampMode.NORMAL); break;
            case '2': setMode(LampMode.UV); break;
            case '3': setMode(LampMode.RGB); break;
            case '4': setMode(LampMode.LASER); break;
            case '5': setMode(LampMode.STROBE); break;
            case 'c': 
            case 'C': 
                triggerCritical(); 
                break;
        }
    };

    return { 
        group: lampGroup, 
        toggle, 
        setMode, 
        setRolling,
        triggerCritical,
        update,
        handleKey,
        getMode: () => currentMode,
        LampMode
    };
}
