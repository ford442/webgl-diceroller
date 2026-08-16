/**
 * Continuous runtime quality scaling when frame times exceed the budget.
 * Complements the one-shot adaptive profile probe and DPR-only pixel ratio monitor.
 */

import { applyShadowLightPolicy } from './AdaptiveQuality.js';

const FRAME_BUDGET_MS = 32;
const RECOVERY_FAST_MS = 20;
const STRESS_SLOW_STREAK = 90;
const RECOVERY_FAST_STREAK = 180;

const STRESS_STEP_NAMES = [
    'baseline',
    'chromaticOff',
    'bloomReduced',
    'bloomOff',
    'godRaysOff',
    'shadowKey',
    'shadowMaps256',
];

/**
 * @param {object} deps
 * @param {import('../types/app').PostConfig} deps.postConfig
 * @param {ReturnType<typeof import('./PostRuntimeControls.js').createPostRuntimeControls>} deps.postRuntime
 * @param {import('three').Scene} deps.scene
 * @param {import('three').SpotLight} deps.spotLight
 * @param {import('three').PointLight} deps.pointLight
 * @param {import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer} deps.renderer
 * @param {{ update?: (args: { deltaTime?: number }) => void } | null} [deps.pixelRatioMonitor]
 * @param {() => boolean} [deps.hasExplicitOverride]
 * @param {(visible: boolean) => void} [deps.setGodRaysVisible]
 */
export function createRuntimeQualityGovernor(deps) {
    const {
        postConfig,
        postRuntime,
        scene,
        spotLight,
        pointLight,
        renderer,
        pixelRatioMonitor = null,
        hasExplicitOverride = () => false,
        setGodRaysVisible = () => {},
    } = deps;

    let stressStep = 0;
    let frameMsSmoothed = 16.7;
    let slowFrameStreak = 0;
    let fastFrameStreak = 0;
    let disabled = false;

    const baseline = {
        godRaysVisible: postConfig.godRaysEnabled === true,
        shadowLights: postConfig.shadowLightsPolicy ?? 'all',
        spotMapSize: spotLight?.shadow?.mapSize?.x ?? 1024,
        pointMapSize: pointLight?.shadow?.mapSize?.x ?? 512,
    };

    function markShadowMapsDirty() {
        scene.traverse((child) => {
            if (child.isLight && child.castShadow && child.shadow) {
                child.shadow.needsUpdate = true;
            }
        });
        renderer.shadowMap.needsUpdate = true;
    }

    function applyStressStep(level) {
        const step = Math.max(0, Math.min(STRESS_STEP_NAMES.length - 1, level));

        if (step >= 1) {
            postRuntime.setChromaticIntensity(0);
        } else {
            postRuntime.setChromaticIntensity(postRuntime.getBaselineChromaticIntensity());
        }

        if (step >= 3) {
            postRuntime.setBloomBlend(0);
        } else if (step >= 2) {
            postRuntime.setBloomBlend(Math.min(0.35, postRuntime.getBaselineBloomBlend()));
        } else {
            postRuntime.setBloomBlend(postRuntime.getBaselineBloomBlend());
        }

        if (step >= 4) {
            setGodRaysVisible(false);
        } else {
            setGodRaysVisible(baseline.godRaysVisible);
        }

        if (step >= 5) {
            applyShadowLightPolicy(scene, 'key');
            postConfig.shadowLightsPolicy = 'key';
        } else {
            applyShadowLightPolicy(scene, baseline.shadowLights);
            postConfig.shadowLightsPolicy = baseline.shadowLights;
        }

        if (step >= 6) {
            if (spotLight?.shadow) {
                spotLight.shadow.mapSize.set(256, 256);
            }
            if (pointLight?.shadow) {
                pointLight.shadow.mapSize.set(256, 256);
            }
            markShadowMapsDirty();
        } else {
            if (spotLight?.shadow) {
                spotLight.shadow.mapSize.set(baseline.spotMapSize, baseline.spotMapSize);
            }
            if (pointLight?.shadow) {
                pointLight.shadow.mapSize.set(baseline.pointMapSize, baseline.pointMapSize);
            }
            markShadowMapsDirty();
        }

        postConfig.stressStep = step;
        postConfig.stressStepName = STRESS_STEP_NAMES[step];
    }

    function canEscalate() {
        if (disabled || hasExplicitOverride()) return false;
        return stressStep < STRESS_STEP_NAMES.length - 1;
    }

    function escalate() {
        if (!canEscalate()) return false;

        stressStep += 1;
        applyStressStep(stressStep);
        console.info(
            `[RuntimeQuality] Stress step ${stressStep} (${STRESS_STEP_NAMES[stressStep]})`
        );
        return true;
    }

    function recover() {
        if (disabled || stressStep <= 0) return false;
        stressStep -= 1;
        applyStressStep(stressStep);
        console.info(
            `[RuntimeQuality] Recovered to step ${stressStep} (${STRESS_STEP_NAMES[stressStep]})`
        );
        return true;
    }

    function update({ deltaTime = 0 } = {}) {
        if (disabled) {
            return getStats();
        }

        pixelRatioMonitor?.update({ deltaTime });

        const frameMs = deltaTime * 1000;
        if (frameMs <= 0) return getStats();

        frameMsSmoothed += (frameMs - frameMsSmoothed) * 0.08;

        if (frameMsSmoothed > FRAME_BUDGET_MS) {
            slowFrameStreak += 1;
            fastFrameStreak = 0;
        } else if (frameMsSmoothed < RECOVERY_FAST_MS) {
            fastFrameStreak += 1;
            slowFrameStreak = Math.max(0, slowFrameStreak - 2);
        } else {
            slowFrameStreak = Math.max(0, slowFrameStreak - 1);
            fastFrameStreak = Math.max(0, fastFrameStreak - 1);
        }

        if (slowFrameStreak >= STRESS_SLOW_STREAK) {
            slowFrameStreak = 0;
            escalate();
        } else if (fastFrameStreak >= RECOVERY_FAST_STREAK && stressStep > 0) {
            fastFrameStreak = 0;
            recover();
        }

        return getStats();
    }

    function getStats() {
        return {
            stressStep,
            stressStepName: STRESS_STEP_NAMES[stressStep],
            frameMsSmoothed,
            slowFrameStreak,
            fastFrameStreak,
            disabled,
        };
    }

    function setDisabled(value) {
        disabled = value;
        if (!value && stressStep > 0) {
            applyStressStep(stressStep);
        }
    }

    function refreshBaselineFromProfile(profile) {
        baseline.godRaysVisible = profile?.godRaysEnabled === true;
        baseline.shadowLights = profile?.shadowLights ?? 'all';
        baseline.spotMapSize = profile?.id === 'high' ? 1024 : 512;
        baseline.pointMapSize = 512;
        if (!postConfig.motionProfileActive) {
            applyStressStep(stressStep);
        }
    }

    applyStressStep(0);

    return {
        update,
        getStats,
        setDisabled,
        refreshBaselineFromProfile,
        escalate,
        recover,
    };
}
