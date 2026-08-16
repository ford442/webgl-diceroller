/**
 * One-time renderer-adjacent bring-up: debug render stats, the fairness
 * monitor, the renderer-identity badge, GPU recovery wiring, the adaptive
 * quality probe, and the ambient-audio DOM listeners. Extracted verbatim
 * from main.js's init() purely to shrink it — every piece here is a
 * single call made once during startup.
 */

import { createRenderStats } from '../debug/RenderStats.js';
import { createFairnessMonitor } from '../debug/FairnessMonitor.js';
import { createPixelRatioMonitor } from '../core/RendererFactory.js';
import {
    bootstrapAdaptiveQuality,
    hasExplicitQualityOverride,
    setGodRaysVisible,
} from '../core/AdaptiveQuality.js';
import { createRuntimeQualityGovernor } from '../core/RuntimeQualityGovernor.js';
import { setDiceAppearanceQualityProfile, spawnedDice, areDiceSettled } from '../dice.js';
import {
    getWorkerPhysicsStats,
    getPhysicsStepStats,
    isWasmAvailable,
} from '../wasm/PhysicsBridge.js';
import {
    createRendererBadge,
    applyLivePixelRatio,
    setupRendererRecovery,
} from './RendererRecovery.js';

/**
 * @param {import('../types/app').AppContext} app
 * @param {object} deps
 */
export function bootstrapRendererExtras(app, deps) {
    const {
        scene,
        renderer,
        composer,
        rendererState,
        postConfig,
        spotLight,
        pointLight,
        scheduler,
        cullingSystem,
        container,
        debugEnabled,
        searchParams,
        rollStats,
        getShadowController,
        getCollisionAudio,
        getTierRenderStats,
        getCollisionTotal,
        setRendererBadge,
        rendererRecoveryDeps,
        postRuntime,
        getDiceGameFeel,
    } = deps;

    let renderStats = null;
    let fairnessMonitor = null;

    const pixelRatioMonitor = createPixelRatioMonitor(rendererState, {
        debugPerf: searchParams.has('debug-perf'),
        onPixelRatioChange: (nextRatio) =>
            applyLivePixelRatio(container, nextRatio, rendererRecoveryDeps),
    });

    const runtimeGovernor = createRuntimeQualityGovernor({
        postConfig,
        postRuntime,
        scene,
        spotLight,
        pointLight,
        renderer,
        pixelRatioMonitor,
        hasExplicitOverride: hasExplicitQualityOverride,
        setGodRaysVisible: (visible) => setGodRaysVisible(scene, visible),
    });

    if (debugEnabled) {
        renderStats = createRenderStats({
            renderer,
            scene,
            scheduler,
            cullingSystem,
            debugPerf: searchParams.has('debug-perf'),
            getRenderer: () => rendererRecoveryDeps.getRenderer(),
            getRendererState: () => rendererRecoveryDeps.getRendererState(),
            getPost: () => rendererRecoveryDeps.getPostConfig(),
            getGovernor: () => scheduler.stats.runtimeGovernor,
            getShadow: () => {
                const shadowMap = rendererRecoveryDeps.getRenderer()?.shadowMap;
                const shadowController = getShadowController();
                return {
                    autoUpdate:
                        shadowMap && 'autoUpdate' in shadowMap
                            ? /** @type {import('three').WebGLShadowMap} */ (shadowMap).autoUpdate
                            : false,
                    staticRefreshes: shadowController?.state.staticShadowRefreshes ?? 0,
                    throttled: shadowController?.state.throttleRefresh ?? false,
                };
            },
            getDice: () => ({ count: spawnedDice.length, settled: areDiceSettled() }),
            getWasm: () => ({
                available: isWasmAvailable(),
                active: isWasmAvailable(),
                worker: getWorkerPhysicsStats(),
                stepStats: getPhysicsStepStats(),
            }),
            getAudio: () => getCollisionAudio()?.getStats?.() ?? null,
            getCollisionTotal,
            getTierRenderStats,
        });
        // Backtick toggles the HUD during playtesting without reloading.
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote') renderStats?.toggle();
        });
        fairnessMonitor = createFairnessMonitor({ enabled: true, rollStats });
        fairnessMonitor.init();
        app.fairnessMonitor = fairnessMonitor;
    }

    // Surface the active renderer in-UI: persistently under ?debug/?renderer-info,
    // or as a brief auto-fading notice whenever WebGPU fell back to WebGL so the
    // user understands they're on the degraded baseline path. In the happy WebGPU
    // case (no debug) nothing is shown, keeping the UI clean.
    const rendererInfoRequested = searchParams.has('renderer-info');
    const badgePersistent = debugEnabled || rendererInfoRequested;
    if (badgePersistent || rendererState?.fallbackReason) {
        setRendererBadge(
            createRendererBadge(rendererState, { persistent: badgePersistent }, () =>
                setRendererBadge(null)
            )
        );
    }

    setupRendererRecovery(container, rendererRecoveryDeps);

    const adaptiveBootstrap = bootstrapAdaptiveQuality({
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
    });
    const adaptiveQualityState = {
        probe: adaptiveBootstrap.probe,
        initialProfile: adaptiveBootstrap.initialProfile,
        appliedProfile: adaptiveBootstrap.initialProfile,
        scene,
        renderer,
        postConfig,
        composer,
        spotLight,
        pointLight,
        rendererState,
        postRuntime,
        runtimeGovernor,
        getDiceGameFeel,
    };
    app.qualityProfile = postConfig.adaptiveProfile;
    setDiceAppearanceQualityProfile(postConfig.adaptiveProfile);

    window.addEventListener('pointerdown', () => getCollisionAudio()?.resume(), { passive: true });
    window.addEventListener('keydown', () => getCollisionAudio()?.resume(), { passive: true });
    // Lean into the tavern ambience while the player sits in FPS/pointer-lock mode.
    document.addEventListener('pointerlockchange', () => {
        const locked = document.pointerLockElement != null;
        getCollisionAudio()?.setAmbientIntensity(locked ? 1.0 : 0.5);
    });

    return {
        renderStats,
        fairnessMonitor,
        pixelRatioMonitor,
        adaptiveQualityState,
        runtimeGovernor,
    };
}
