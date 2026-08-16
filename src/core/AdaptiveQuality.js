import { collectDeviceQualityHints } from './DeviceCapabilities.js';

export const QUALITY_PROFILES = {
    high: {
        id: 'high',
        postQuality: 'high',
        bloomEnabled: true,
        godRaysEnabled: true,
        shadowLights: 'all',
        pixelRatioCap: 2,
    },
    medium: {
        id: 'medium',
        postQuality: 'low',
        bloomEnabled: true,
        godRaysEnabled: false,
        shadowLights: 'key',
        pixelRatioCap: 1.5,
    },
    mobile: {
        id: 'mobile',
        postQuality: 'low',
        bloomEnabled: true,
        godRaysEnabled: false,
        shadowLights: 'key',
        pixelRatioCap: 1.25,
    },
};

export function hasExplicitQualityOverride() {
    const params = new URLSearchParams(window.location.search);
    return (
        params.has('no-post') ||
        params.has('low-post') ||
        params.has('no-godrays') ||
        params.has('no-bloom') ||
        params.has('pr') ||
        params.has('xr') ||
        params.has('xr-emulator')
    );
}

export function guessInitialQualityProfile(rendererState) {
    const hints = collectDeviceQualityHints(rendererState);
    if (hints.reducedMotion) {
        return QUALITY_PROFILES.medium;
    }
    if (hints.isSoftwareRenderer || hints.maxTextureSize < 4096) {
        return QUALITY_PROFILES.mobile;
    }
    if (hints.touchPrimary || (hints.lowDpr && hints.lowCores)) {
        return QUALITY_PROFILES.mobile;
    }
    if (hints.lowCores || hints.deviceDpr > 2) {
        return QUALITY_PROFILES.medium;
    }
    return QUALITY_PROFILES.high;
}

export function refineQualityProfileFromProbe(initialProfile, probe) {
    if (!probe || probe.sampleCount < 10) return initialProfile;

    const avgMs = probe.avgFrameMs;
    if (avgMs > 42) return QUALITY_PROFILES.mobile;
    if (avgMs > 28 && initialProfile.id === 'high') return QUALITY_PROFILES.medium;
    if (avgMs > 34 && initialProfile.id === 'medium') return QUALITY_PROFILES.mobile;
    return initialProfile;
}

export function createFrameProbe(scheduler, { durationMs = 1000 } = {}) {
    let startedAt = null;
    let totalMs = 0;
    let sampleCount = 0;
    let done = false;
    let result = null;

    return {
        /** @param {{ time?: number }} [frameState] */
        update(frameState = {}) {
            const { time = 0 } = frameState;
            if (done) return result;
            const now = typeof performance !== 'undefined' ? performance.now() : time * 1000;
            if (startedAt === null) startedAt = now;

            const deltaMs = (scheduler?.stats?.lastDeltaTime ?? 0) * 1000;
            if (deltaMs > 0) {
                totalMs += deltaMs;
                sampleCount += 1;
            }

            if (now - startedAt >= durationMs) {
                done = true;
                result = {
                    avgFrameMs: sampleCount > 0 ? totalMs / sampleCount : 16.7,
                    sampleCount,
                    durationMs: now - startedAt,
                };
            }
            return result;
        },
        get done() {
            return done;
        },
        get result() {
            return result;
        },
    };
}

export function setGodRaysVisible(scene, visible) {
    scene.traverse((child) => {
        if (child.userData?.isGodRay) {
            child.visible = visible;
        }
    });
}

export function applyShadowLightPolicy(scene, policy) {
    scene.traverse((child) => {
        if (!child.isLight || !child.castShadow) return;
        if (policy === 'all') return;
        if (policy === 'key') {
            child.castShadow = child.type === 'PointLight';
            if (child.shadow) child.shadow.needsUpdate = true;
            return;
        }
        child.castShadow = false;
        if (child.shadow) child.shadow.needsUpdate = true;
    });
}

export function applyQualityProfile({
    scene,
    renderer,
    postConfig,
    composer,
    spotLight,
    pointLight,
    profile,
    rendererState,
    postRuntime,
    runtimeGovernor,
}) {
    if (!profile || !postConfig) return profile;

    postConfig.quality = profile.postQuality;
    postConfig.bloomEnabled = profile.bloomEnabled;
    postConfig.godRaysEnabled = profile.godRaysEnabled;
    postConfig.shadowLightsPolicy = profile.shadowLights;
    postConfig.adaptiveProfile = profile.id;
    scene.userData.postConfig = postConfig;

    if (!postConfig.motionProfileActive) {
        setGodRaysVisible(scene, profile.godRaysEnabled);
        applyShadowLightPolicy(scene, profile.shadowLights);
    }

    if (spotLight?.shadow) {
        const mapSize = profile.id === 'high' ? 1024 : 512;
        spotLight.shadow.mapSize.set(mapSize, mapSize);
        spotLight.shadow.needsUpdate = true;
    }

    if (pointLight?.shadow) {
        pointLight.shadow.mapSize.set(512, 512);
        pointLight.shadow.needsUpdate = true;
    }

    if (rendererState && !rendererState.pixelRatioForced && profile.pixelRatioCap) {
        const nextRatio = Math.min(rendererState.pixelRatio, profile.pixelRatioCap);
        if (nextRatio < rendererState.pixelRatio) {
            rendererState.pixelRatio = nextRatio;
            rendererState.usePostAA = !rendererState.antialias && nextRatio > 1;
            postConfig.fxaaEnabled = rendererState.usePostAA && postConfig.quality !== 'off';
            const container = renderer?.domElement?.parentElement;
            if (container) {
                const width = container.clientWidth;
                const height = container.clientHeight;
                renderer.setPixelRatio(nextRatio);
                renderer.setSize(width, height, false);
                if (composer?.setPixelRatio) composer.setPixelRatio(nextRatio);
                else composer?.setSize?.(width, height);
            }
        }
    }

    if (postRuntime && !postConfig.motionProfileActive) {
        postRuntime.restoreBaseline();
    }

    runtimeGovernor?.refreshBaselineFromProfile?.(profile);

    renderer.shadowMap.needsUpdate = true;
    return profile;
}

/**
 * Cheaper render path while dice move or external motion is active.
 */
export function applyMotionProfile(active, deps) {
    const { scene, postConfig, postRuntime, appliedProfile, runtimeGovernor, diceGameFeel } = deps;

    if (!postConfig || !postRuntime) return;

    postConfig.motionProfileActive = active;

    if (active) {
        postRuntime.setBloomBlend(0);
        postRuntime.setChromaticIntensity(0);
        setGodRaysVisible(scene, false);
        diceGameFeel?.setMotionBlurAllowed?.(false);
        runtimeGovernor?.setDisabled?.(true);
        return;
    }

    diceGameFeel?.setMotionBlurAllowed?.(true);

    runtimeGovernor?.setDisabled?.(false);
    if (appliedProfile) {
        setGodRaysVisible(scene, appliedProfile.godRaysEnabled);
        applyShadowLightPolicy(scene, appliedProfile.shadowLights);
        runtimeGovernor?.refreshBaselineFromProfile?.(appliedProfile);
    } else {
        postRuntime.restoreBaseline();
    }
}

export function bootstrapAdaptiveQuality({
    scene,
    renderer,
    postConfig,
    composer,
    spotLight,
    pointLight,
    rendererState,
    scheduler,
    postRuntime,
    runtimeGovernor,
}) {
    if (hasExplicitQualityOverride()) {
        postConfig.adaptiveProfile = 'manual';
        return { probe: null, initialProfile: null };
    }

    const initialProfile = guessInitialQualityProfile(rendererState);
    applyQualityProfile({
        scene,
        renderer,
        postConfig,
        composer,
        spotLight,
        pointLight,
        profile: initialProfile,
        rendererState,
        postRuntime,
        runtimeGovernor,
    });

    const probe = createFrameProbe(scheduler, { durationMs: 1000 });
    return { probe, initialProfile };
}

export function startPostLoadAdaptiveProbe(state, scheduler) {
    if (!state || hasExplicitQualityOverride()) return null;
    const probe = createFrameProbe(scheduler, { durationMs: 1000 });
    state.probe = probe;
    state.probeLabel = 'post-load';
    return probe;
}

export function updateAdaptiveQualityProbe(probe, context, state) {
    if (!probe || probe.done || !state) return;

    const result = probe.update(context);
    if (!result) return;

    const baseProfile = state.appliedProfile ?? state.initialProfile;
    const refined = refineQualityProfileFromProbe(baseProfile, result);
    if (refined.id !== state.appliedProfile?.id) {
        applyQualityProfile({
            scene: state.scene,
            renderer: state.renderer,
            postConfig: state.postConfig,
            composer: state.composer,
            spotLight: state.spotLight,
            pointLight: state.pointLight,
            profile: refined,
            rendererState: state.rendererState,
            postRuntime: state.postRuntime,
            runtimeGovernor: state.runtimeGovernor,
        });
        state.appliedProfile = refined;
        const label = state.probeLabel ?? 'startup';
        console.info(
            `[AdaptiveQuality] Profile ${refined.id} after ${label} probe ` +
                `(avg ${result.avgFrameMs.toFixed(1)} ms / ${result.sampleCount} frames)`
        );
        state.probeLabel = null;
    }
}

/**
 * @param {object} deps
 * @param {boolean} deps.diceSettled
 * @param {number} deps.externalMotionCount
 * @param {import('../types/app').PostConfig} deps.postConfig
 * @param {{ setThrottleRefresh?: (enabled: boolean) => void } | null} [deps.shadowController]
 */
export function updateMotionProfileState(deps) {
    const { diceSettled, externalMotionCount, postConfig, shadowController, ...rest } = deps;
    const motionActive = externalMotionCount > 0 || !diceSettled;
    if (motionActive === postConfig.motionProfileWasActive) return;
    postConfig.motionProfileWasActive = motionActive;
    shadowController?.setThrottleRefresh?.(motionActive);
    applyMotionProfile(motionActive, rest);
}
