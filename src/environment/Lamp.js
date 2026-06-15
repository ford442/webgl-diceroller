import * as THREE from 'three';
import { loadPropMesh } from '../core/PropAssetLoader.js';
import { getLampTextures } from '../core/TexturePipeline.js';

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

/**
 * Creates the hanging billiard lamp (triple shade OBJ model).
 *
 * IMPORTANT GROUP WRAPPER PATTERN (use this for ALL future imported models):
 * ---------------------------------------------------------------
 * We NEVER call .scale.set(), .translate(), or any vertex/geometry mutation
 * directly on the loaded OBJ result or its child meshes/geometries.
 *
 * Imported models (OBJ, GLTF, etc.) frequently contain:
 *   - Nested Groups with pre-applied transforms
 *   - Awkward pivots / rotations / offsets on individual meshes
 *   - Non-uniform or huge internal scales
 *
 * Directly mutating their geometry vertices or mesh.scale produces
 * unpredictable "exploding" or distorted results (giant wooden structures,
 * floating lights, broken pivots). The safe, robust approach is always:
 *
 *   1. Load the raw object.
 *   2. Apply materials (traverse only).
 *   3. Compute bounding box on the raw object.
 *   4. Create a visualWrapper Group.
 *   5. Position the raw object *inside* the wrapper so the desired
 *      anchor point (here: top-center) sits at (0,0,0) of the wrapper.
 *   6. Apply uniform scale ONLY to the visualWrapper.
 *   7. Add lights/bulbs as siblings or children of the top-level group
 *      (or inside the wrapper if you want them to inherit model scale).
 *
 * This guarantees the visual transform is isolated and predictable.
 */
export async function createLamp() {
    const {
        copper: texCopper,
        glass: texGlass,
        glassBump: texGlassBump,
        steel: texSteel,
        wood: texWood,
    } = getLampTextures();

    // Materials - assigned by mesh name
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
        bumpMap: texGlassBump,
        bumpScale: 0.6,
        metalness: 0.0,
        roughness: 0.08,
        transmission: 0.92,
        transparent: true,
        opacity: 0.25,
        thickness: 0.08,
        side: THREE.DoubleSide,
        envMapIntensity: 1.2
    });

    const lampGroup = new THREE.Group();
    lampGroup.name = 'BilliardLamp';

    let object;
    try {
        object = await loadPropMesh(
            './images/props/billiard_lamp.glb',
            { fallbackObjUrl: './images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp.obj' }
        );
    } catch (e) {
        console.error("Failed to load lamp model:", e);
        // Return a safe stub so the rest of the app doesn't crash
        return {
            group: lampGroup,
            toggle: () => {},
            setMode: () => {},
            setRolling: () => {},
            triggerCritical: () => {},
            update: () => {},
            handleKey: () => {},
            getMode: () => LampMode.NORMAL,
            LampMode
        };
    }

    // 2. Apply Materials based on mesh names (never mutate geometry here)
    object.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const name = (child.name || '').toLowerCase();
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

    // 3. SAFE SCALING + POSITIONING USING GROUP WRAPPERS ONLY
    //    (see big comment at top of file for why this is mandatory)
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Use largest horizontal dimension so a rotated model doesn't cause
    // wildly wrong scale factors that explode the geometry.
    const rawWidth = Math.max(size.x, size.z) || 1.0;
    const targetWidth = 22.0;
    const scaleFactor = targetWidth / rawWidth;

    const visualWrapper = new THREE.Group();
    visualWrapper.name = 'LampVisualWrapper';

    // Shift the raw loaded object so its TOP-CENTER lies exactly at (0,0,0)
    // of the visualWrapper. After we scale the wrapper, the top stays
    // pinned at the wrapper origin and everything (chains + shades) hangs
    // downward in negative local Y. This is what allows clean "hang from ceiling".
    object.position.set(-center.x, -box.max.y, -center.z);
    visualWrapper.add(object);

    // Apply scale ONLY to the wrapper Group. Never touch the raw meshes.
    visualWrapper.scale.setScalar(scaleFactor);

    lampGroup.add(visualWrapper);

    // 4. Place three PointLights + emissive bulbs INSIDE the actual glass shades
    //    We locate the real shade meshes after the wrapper transform and use
    //    their bounding boxes for accurate placement. No more floating bulbs.
    lampGroup.updateMatrixWorld(true);

    const glassShades = [];
    object.traverse((child) => {
        if (child.isMesh) {
            const n = (child.name || '').toLowerCase();
            if (n.includes('glass') || n.includes('shade')) {
                glassShades.push(child);
            }
        }
    });

    let lightPositions = [];
    if (glassShades.length > 0) {
        // Sort left-to-right for consistent left/center/right ordering
        const shadeData = glassShades.map(shade => {
            const b = new THREE.Box3().setFromObject(shade);
            const c = b.getCenter(new THREE.Vector3());
            const h = b.getSize(new THREE.Vector3()).y;
            // Position light at ~75% depth inside the shade (down from top rim)
            c.y -= h * 0.25;
            return { center: c, box: b };
        });
        shadeData.sort((a, b) => a.center.x - b.center.x);

        // Take up to 3 shades (the model is a triple lamp)
        const selected = shadeData.slice(0, 3);
        lightPositions = selected.map(d => d.center);
    }

    // Fallback (should rarely happen): approximate positions using overall bounds
    if (lightPositions.length === 0) {
        const scaledW = rawWidth * scaleFactor;
        const spacing = scaledW * 0.30;
        const approxY = -size.y * scaleFactor * 0.82; // deep in the lower half
        lightPositions = [
            new THREE.Vector3(-spacing, approxY, 0),
            new THREE.Vector3(0, approxY, 0),
            new THREE.Vector3(spacing, approxY, 0)
        ];
    }

    const lights = [];
    const lasers = [];

    lightPositions.forEach((pos, i) => {
        const light = new THREE.PointLight(MODE_COLORS[LampMode.NORMAL], 95, 26);
        light.position.copy(pos);
        light.castShadow = (i === 1); // only center light casts shadows
        light.shadow.bias = -0.0004;
        light.shadow.mapSize.width = 512;
        light.shadow.mapSize.height = 512;
        light.shadow.autoUpdate = false;
        light.shadow.needsUpdate = true;

        // Small emissive bulb mesh sitting inside the shade
        const bulbGeo = new THREE.SphereGeometry(0.32, 12, 12);
        const bulbMat = new THREE.MeshBasicMaterial({ color: MODE_COLORS[LampMode.NORMAL] });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.copy(pos);
        bulb.castShadow = false;
        bulb.receiveShadow = false;

        lampGroup.add(light);
        lampGroup.add(bulb);

        lights.push({ light, bulb, originalIntensity: 95 });
    });

    // Decorative laser beams (only visible in LASER/CRITICAL modes)
    const laserLength = 15;
    lightPositions.forEach((pos, i) => {
        const laserMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending
        });
        const laser = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.018, laserLength, 6),
            laserMat
        );
        // Position so the "beam" originates near the bulb and points downward
        laser.position.set(pos.x, pos.y - (laserLength * 0.5) - 0.3, pos.z);
        laser.rotation.z = (i - 1) * 0.12;
        lampGroup.add(laser);
        lasers.push(laser);
    });

    // --- Runtime State & Controls (on/off + fancy modes via keys) ---
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
                    l.light.intensity = flash ? 155 : 95;
                    l.bulb.material.color.setHex(critColor);
                });
                lasers.forEach((laser, i) => {
                    laser.material.color.setHex(0xffd700);
                    laser.material.opacity = 0.85;
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
