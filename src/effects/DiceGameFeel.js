/**
 * Game-feel layer for dice: impact sparks, settle highlights, crit/fumble
 * celebration, and WebGPU-only motion stretch on fast throws.
 *
 * Driven from FrameScheduler phases — no per-frame heap allocations.
 */
import * as THREE from 'three';
import { spawnedDice, findSpawnedDieByPhysicsId } from '../dice.js';

const MAX_PARTICLES = 200;
const IMPACT_SPEED_THRESHOLD = 2.8;
const SETTLE_SPEED_THRESHOLD = 0.4;
const MOTION_BLUR_SPEED = 7.5;
const CRIT_DURATION = 1.35;
const SETTLE_PULSE_DURATION = 0.55;

const _worldPos = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _localVel = new THREE.Vector3();
const _emissiveColor = new THREE.Color();
const _rimColor = new THREE.Color(0xb8d0ff);

function createSparkTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.25, 'rgba(255, 240, 200, 0.9)');
    grad.addColorStop(0.55, 'rgba(255, 200, 120, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
}

function ensureFeelMaterialState(material) {
    if (!material?.isMaterial) return null;
    if (!material.userData.feelBase) {
        material.userData.feelBase = {
            emissive: material.emissive?.clone?.() ?? new THREE.Color(0x000000),
            emissiveIntensity: material.emissiveIntensity ?? 0
        };
        if (!material.emissive) material.emissive = new THREE.Color(0x000000);
    }
    return material.userData.feelBase;
}

function forEachDieMaterial(mesh, fn) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
        if (mat) fn(mat);
    }
}

function resetDieMaterials(mesh) {
    forEachDieMaterial(mesh, (mat) => {
        const base = mat.userData.feelBase;
        if (!base) return;
        mat.emissive.copy(base.emissive);
        mat.emissiveIntensity = base.emissiveIntensity;
    });
}

function applyEmissivePulse(mesh, color, intensity, blend = 1) {
    forEachDieMaterial(mesh, (mat) => {
        const base = ensureFeelMaterialState(mat);
        if (!base) return;
        _emissiveColor.copy(base.emissive).lerp(color, blend);
        mat.emissive.copy(_emissiveColor);
        mat.emissiveIntensity = base.emissiveIntensity + intensity;
    });
}

function createParticlePool(scene) {
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const velocities = new Float32Array(MAX_PARTICLES * 3);
    const lives = new Float32Array(MAX_PARTICLES);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffcc88,
        size: 0.14,
        map: createSparkTexture(),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 10;
    scene.add(points);

    let writeIndex = 0;

    function spawnBurst(origin, count, {
        speed = 2.5,
        upward = 1.2,
        color = 0xffcc88,
        size = 0.14
    } = {}) {
        material.color.setHex(color);
        material.size = size;
        const spawned = Math.min(count, MAX_PARTICLES);
        for (let i = 0; i < spawned; i++) {
            const slot = writeIndex % MAX_PARTICLES;
            writeIndex += 1;
            const i3 = slot * 3;
            positions[i3] = origin.x + (Math.random() - 0.5) * 0.12;
            positions[i3 + 1] = origin.y + (Math.random() - 0.5) * 0.12;
            positions[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.12;

            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.65;
            const mag = speed * (0.55 + Math.random() * 0.75);
            velocities[i3] = Math.cos(theta) * Math.sin(phi) * mag;
            velocities[i3 + 1] = Math.cos(phi) * mag + upward * Math.random();
            velocities[i3 + 2] = Math.sin(theta) * Math.sin(phi) * mag;

            lives[slot] = 0.35 + Math.random() * 0.25;
        }
        geometry.attributes.position.needsUpdate = true;
    }

    function update(deltaTime) {
        let alive = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const life = lives[i];
            if (life <= 0) {
                const i3 = i * 3;
                positions[i3 + 1] = -1000;
                continue;
            }
            alive += 1;
            const i3 = i * 3;
            lives[i] = life - deltaTime;
            velocities[i3 + 1] -= deltaTime * 5.5;
            positions[i3] += velocities[i3] * deltaTime;
            positions[i3 + 1] += velocities[i3 + 1] * deltaTime;
            positions[i3 + 2] += velocities[i3 + 2] * deltaTime;
        }
        if (alive > 0) {
            geometry.attributes.position.needsUpdate = true;
        }
        return alive;
    }

    function dispose() {
        scene.remove(points);
        geometry.dispose();
        material.dispose();
        material.map?.dispose?.();
    }

    return { spawnBurst, update, dispose, points };
}

export function createDiceGameFeelSystem(scene, {
    postConfig = null,
    rendererState = null
} = {}) {
    const searchParams = new URLSearchParams(window.location.search);
    const disabled = searchParams.has('no-gamefeel');
    const motionBlurEnabled = !disabled
        && !searchParams.has('no-post')
        && postConfig?.quality === 'high'
        && rendererState?.usingWebGPU === true;

    const particles = createParticlePool(scene);

    const flareLight = new THREE.PointLight(0xffcc66, 0, 14, 2);
    flareLight.castShadow = false;
    scene.add(flareLight);

    const critEffects = [];
    const settlePulses = [];
    const dieMotion = new Map();

    const stats = {
        activeParticles: 0,
        critCount: 0,
        settlePulses: 0,
        motionBlurDice: 0
    };

    function resolveDieFromEvent(event) {
        const die = findSpawnedDieByPhysicsId(event.idA);
        if (die) return die;
        if (event.idB >= 0) return findSpawnedDieByPhysicsId(event.idB);
        return null;
    }

    function handleCollisionEvent(event) {
        if (disabled) return;
        if ((event.impactSpeed ?? 0) < IMPACT_SPEED_THRESHOLD) return;

        const die = resolveDieFromEvent(event);
        if (!die?.mesh) return;

        die.mesh.getWorldPosition(_worldPos);
        const sparkCount = event.impactSpeed > 6 ? 6 : 4;
        particles.spawnBurst(_worldPos, sparkCount, {
            speed: Math.min(4.5, event.impactSpeed * 0.35),
            upward: 0.8,
            color: event.idB === -1 ? 0xd4c4a8 : 0xffaa66,
            size: 0.1 + Math.min(0.08, event.impactSpeed * 0.01)
        });
    }

    function startCritEffect(die, kind) {
        const isCrit = kind === 'crit';
        critEffects.push({
            die,
            kind,
            elapsed: 0,
            duration: CRIT_DURATION,
            color: isCrit ? new THREE.Color(0xffcc44) : new THREE.Color(0x887766),
            lightColor: isCrit ? 0xffdd88 : 0x998877
        });
        stats.critCount += 1;

        die.mesh.getWorldPosition(_worldPos);
        particles.spawnBurst(_worldPos, 18, {
            speed: isCrit ? 3.8 : 2.6,
            upward: isCrit ? 2.0 : 1.0,
            color: isCrit ? 0xffdd66 : 0xaaa099,
            size: isCrit ? 0.18 : 0.14
        });
    }

    function onResultsReady(results) {
        if (disabled || !Array.isArray(results)) return;

        // Results are built in spawnedDice order by CameraController.
        results.forEach((result, index) => {
            if (result.type !== 'd20') return;
            if (result.value !== 20 && result.value !== 1) return;
            const die = spawnedDice[index];
            if (!die || die.type !== 'd20') return;
            startCritEffect(die, result.value === 20 ? 'crit' : 'fumble');
        });
    }

    /**
     * Notation rolls carry explicit crit/fumble flags (and optional system bands).
     * @param {import('../roll/Notation.js').EvaluatedRoll} evaluated
     */
    function onNotationResult(evaluated) {
        if (disabled || !evaluated?.flags) return;
        const wantCrit = evaluated.flags.crit === true;
        const wantFumble = evaluated.flags.fumble === true;
        if (!wantCrit && !wantFumble) return;

        // Prefer kept d20s that match the flag; fall back to any visible die.
        const candidates = spawnedDice.filter((d) => d?.mesh);
        const d20s = candidates.filter((d) => d.type === 'd20');
        const targets = d20s.length ? d20s : candidates.slice(0, 1);
        for (const die of targets) {
            if (wantCrit) startCritEffect(die, 'crit');
            else if (wantFumble) startCritEffect(die, 'fumble');
        }
    }

    function onDieSettled(die) {
        settlePulses.push({ die, elapsed: 0, duration: SETTLE_PULSE_DURATION });
        stats.settlePulses += 1;

        die.mesh.getWorldPosition(_worldPos);
        particles.spawnBurst(_worldPos, 3, {
            speed: 1.2,
            upward: 0.4,
            color: 0xc8d8ff,
            size: 0.08
        });
    }

    function trackDieMotion(die, deltaTime) {
        die.mesh.getWorldPosition(_worldPos);
        let state = dieMotion.get(die);
        if (!state) {
            state = {
                prev: new THREE.Vector3().copy(_worldPos),
                velocity: new THREE.Vector3(),
                wasMoving: false,
                speed: 0
            };
            dieMotion.set(die, state);
            return;
        }

        _velocity.subVectors(_worldPos, state.prev);
        if (deltaTime > 0) _velocity.multiplyScalar(1 / deltaTime);
        const speed = _velocity.length();
        state.prev.copy(_worldPos);

        const moving = speed > SETTLE_SPEED_THRESHOLD;
        if (state.wasMoving && !moving) {
            onDieSettled(die);
        }
        state.wasMoving = moving;
        state.speed = speed;
        state.velocity.copy(_velocity);
    }

    function applyMotionBlur(die, state) {
        die.mesh.scale.set(1, 1, 1);
        if (!motionBlurEnabled || !state?.velocity) return;

        const speed = state.speed ?? 0;
        if (speed < MOTION_BLUR_SPEED) return;

        const amount = Math.min(0.28, (speed - MOTION_BLUR_SPEED) * 0.018);
        _invQ.copy(die.mesh.quaternion).invert();
        _localVel.copy(state.velocity).applyQuaternion(_invQ);
        const ax = Math.abs(_localVel.x);
        const ay = Math.abs(_localVel.y);
        const az = Math.abs(_localVel.z);
        const sx = 1 + (ax >= ay && ax >= az ? amount : 0);
        const sy = 1 + (ay > ax && ay >= az ? amount : 0);
        const sz = 1 + (az > ax && az > ay ? amount : 0);
        die.mesh.scale.set(sx, sy, sz);
        stats.motionBlurDice += 1;
    }

    function updateCritEffects(deltaTime) {
        flareLight.intensity = 0;

        for (let i = critEffects.length - 1; i >= 0; i--) {
            const fx = critEffects[i];
            fx.elapsed += deltaTime;
            const t = fx.elapsed / fx.duration;
            if (t >= 1 || !fx.die?.mesh?.parent) {
                resetDieMaterials(fx.die.mesh);
                critEffects.splice(i, 1);
                continue;
            }

            const pulse = Math.sin(t * Math.PI);
            const ramp = pulse * (1 - t * 0.35);
            applyEmissivePulse(fx.die.mesh, fx.color, ramp * (fx.kind === 'crit' ? 2.2 : 1.4), ramp);

            fx.die.mesh.getWorldPosition(_worldPos);
            flareLight.position.copy(_worldPos);
            flareLight.color.setHex(fx.lightColor);
            flareLight.intensity = Math.max(flareLight.intensity, ramp * (fx.kind === 'crit' ? 3.5 : 2.0));
        }
    }

    function updateSettlePulses(deltaTime) {
        for (let i = settlePulses.length - 1; i >= 0; i--) {
            const pulse = settlePulses[i];
            pulse.elapsed += deltaTime;
            const t = pulse.elapsed / pulse.duration;
            if (t >= 1 || !pulse.die?.mesh?.parent) {
                resetDieMaterials(pulse.die.mesh);
                settlePulses.splice(i, 1);
                continue;
            }

            const rim = Math.sin(t * Math.PI) * (1 - t);
            applyEmissivePulse(pulse.die.mesh, _rimColor, rim * 0.85, rim * 0.65);
        }
    }

    function update(deltaTime) {
        if (disabled) return stats;

        stats.motionBlurDice = 0;
        for (const die of spawnedDice) {
            die.mesh.scale.set(1, 1, 1);
            trackDieMotion(die, deltaTime);
            const state = dieMotion.get(die);
            applyMotionBlur(die, state);
        }

        updateCritEffects(deltaTime);
        updateSettlePulses(deltaTime);
        stats.activeParticles = particles.update(deltaTime);
        return stats;
    }

    function clearRollState() {
        critEffects.length = 0;
        settlePulses.length = 0;
        flareLight.intensity = 0;
        for (const die of spawnedDice) {
            resetDieMaterials(die.mesh);
            die.mesh.scale.set(1, 1, 1);
        }
        dieMotion.clear();
    }

    function dispose() {
        particles.dispose();
        scene.remove(flareLight);
        clearRollState();
    }

    return {
        handleCollisionEvent,
        onResultsReady,
        onNotationResult,
        update,
        clearRollState,
        dispose,
        getStats: () => stats
    };
}
