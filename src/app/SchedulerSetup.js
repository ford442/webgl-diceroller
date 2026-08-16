/**
 * Frame-scheduler registration for the main render/physics/UI loop.
 * Extracted verbatim from main.js — callbacks read live app state through the
 * getters in `deps` since several of those values (renderer, physics world,
 * camera controller, ...) are only assigned after registration happens.
 */

import { stepPhysics, pollAmmoCollisionEvents } from '../physics.js';
import { getWasmEngine, isWasmAvailable, flushWorkerCommandBatch } from '../wasm/PhysicsBridge.js';
import {
    updateDiceVisuals,
    pollPhysicsCollisionEvents,
    enrichCollisionEventForAudio,
    applyDiceMassBiases,
    spawnedDice,
    readAllDiceValues,
    areDiceSettled,
    setDiceAppearanceQualityProfile,
} from '../dice.js';
import { updateInteraction } from '../interaction.js';
import { updateAtmosphere } from '../environment/Atmosphere.js';
import { LampMode } from '../environment/Lamp.js';
import {
    createCandleFlickerSystem,
    createFireplaceFlickerSystem,
} from '../core/LightingSystems.js';
import { updateAdaptiveQualityProbe, updateMotionProfileState } from '../core/AdaptiveQuality.js';
import { hideResults, updateDiceHud } from '../results.js';
import { AppEvent } from '../core/AppEvents.js';

/**
 * @param {import('../core/FrameScheduler.js').FrameScheduler} scheduler
 * @param {object} deps
 */
export function registerFrameCallbacks(scheduler, deps) {
    const {
        app,
        isSimulationReady,
        getPhysicsWorld,
        getCamera,
        getRenderer,
        getComposer,
        scene,
        cullingSystem,
        appEvents,
        getCollisionAudio,
        getCameraController,
        getInputState,
        getLampData,
        getGongData,
        getCandleFlamePos,
        getFireplaceLight,
        getDiceCupController,
        shadowController,
        getDiceGameFeel,
        pointLight,
        postConfig,
        getRendererState,
        adaptiveQualityState,
        runtimeGovernor,
        postRuntime,
        renderStats,
        debugEnabled,
        isLockedRef,
        cursorPos,
        isXrPresentingRef,
        addCollisionTotal,
    } = deps;

    // Write-only, mirrors main.js's original unused gong flash bookkeeping.
    let _gongFlashIntensity = 0;

    scheduler.register('physicsStep', 'dicePhysics', ({ deltaTime }) => {
        if (!isSimulationReady()) return;

        const useWasm = isWasmAvailable();
        const physicsWorld = getPhysicsWorld();

        // Dice run on WASM whenever it is live; ammo steps only on the
        // `?no-wasm` fallback, where physicsWorld is the sole dice simulation.
        const shouldStepAmmo = Boolean(physicsWorld) && !useWasm;
        applyDiceMassBiases({
            deltaTime,
            applyAmmo: shouldStepAmmo,
            applyWasm: useWasm,
        });

        if (shouldStepAmmo) {
            stepPhysics(physicsWorld, deltaTime);
        }
        if (useWasm) {
            getWasmEngine().step(deltaTime);
        }
    });

    scheduler.register('postPhysicsSync', 'diceVisualSync', () => {
        if (!isSimulationReady()) return;
        updateDiceVisuals();
    });

    scheduler.register('postPhysicsSync', 'collisionAudio', () => {
        if (!isSimulationReady()) return;

        const physicsWorld = getPhysicsWorld();
        const events = [...pollPhysicsCollisionEvents()];
        if (physicsWorld) {
            events.push(...pollAmmoCollisionEvents(physicsWorld));
        }
        addCollisionTotal(events.length);
        for (const ev of events) {
            const audioEv = enrichCollisionEventForAudio(ev);
            appEvents.emit(AppEvent.DICE_COLLISION, audioEv);
        }
    });

    scheduler.register(
        'preStep',
        'diceCup',
        ({ deltaTime }) => {
            getDiceCupController()?.update(deltaTime);
        },
        { priority: -15 }
    );

    scheduler.register(
        'updates',
        'interaction',
        ({ deltaTime }) => {
            if (!isSimulationReady()) return;
            updateInteraction(deltaTime);
        },
        { priority: -20 }
    );

    scheduler.register(
        'updates',
        'atmosphere',
        ({ time }) => {
            updateAtmosphere(time);
        },
        { priority: 10 }
    );

    scheduler.register(
        'preRender',
        'audioListener',
        () => {
            getCollisionAudio()?.updateListener?.(getCamera());
        },
        { priority: 100 }
    );

    scheduler.register(
        'preRender',
        'cameraController',
        ({ deltaTime, time }) => {
            const cameraController = getCameraController();
            const inputState = getInputState();
            if (!cameraController || !inputState) return;
            cameraController.update(deltaTime, time, {
                keys: inputState.keys,
                cursorPos,
                isLocked: isLockedRef.value,
                hideResults,
                lampData: getLampData(),
                LampMode,
                onSettled: (results) => {
                    appEvents.emit(AppEvent.ROLL_SETTLED, { results });
                },
                touchPrimary: inputState?.touchPrimary === true,
                xrPresenting: isXrPresentingRef.value,
            });
        },
        { priority: -10 }
    );

    scheduler.register(
        'preRender',
        'diceHud',
        () => {
            if (!spawnedDice.length) {
                updateDiceHud([]);
                return;
            }
            const rolling = !areDiceSettled();
            updateDiceHud(readAllDiceValues(), { rolling });
        },
        { priority: -5 }
    );

    scheduler.register(
        'preRender',
        'diceGameFeel',
        ({ deltaTime }) => {
            const diceGameFeel = getDiceGameFeel();
            if (!diceGameFeel) return;
            scheduler.stats.gameFeel = diceGameFeel.update(deltaTime);
        },
        { priority: 95 }
    );

    scheduler.register('preRender', 'gongFlash', () => {
        const gongData = getGongData();
        if (gongData?.getFlashIntensity) {
            _gongFlashIntensity = gongData.getFlashIntensity();
        }
    });

    scheduler.register(
        'preRender',
        'candleFlicker',
        createCandleFlickerSystem(pointLight, getCandleFlamePos)
    );
    scheduler.register(
        'preRender',
        'fireplaceFlicker',
        createFireplaceFlickerSystem(getFireplaceLight)
    );
    scheduler.register('preRender', 'shadowController', ({ time }) => {
        if (!shadowController) return;
        shadowController.update(time * 1000, areDiceSettled());
    });
    scheduler.register('preRender', 'motionProfile', () => {
        if (!postRuntime || !adaptiveQualityState) return;
        updateMotionProfileState({
            diceSettled: areDiceSettled(),
            externalMotionCount: shadowController?.state.externalMotionCount ?? 0,
            postConfig,
            shadowController,
            scene,
            postRuntime,
            appliedProfile: adaptiveQualityState.appliedProfile,
            runtimeGovernor,
            diceGameFeel: getDiceGameFeel?.(),
        });
    });
    // Runs last in preRender (after the camera has moved this frame) so we cull
    // against the up-to-date frustum, right before sceneRender.
    scheduler.register(
        'preRender',
        'frustumCull',
        () => {
            cullingSystem.update(getCamera());
            scheduler.stats.culling = cullingSystem.stats;
        },
        { priority: 100 }
    );
    scheduler.register('preRender', 'debugStats', ({ deltaTime, time }) => {
        // Keep app.stats (and window.__renderStats under test hooks) populated.
        const renderer = getRenderer();
        const rendererState = getRendererState();
        scheduler.stats.shadow = {
            autoUpdate: /** @type {{ autoUpdate?: boolean; needsUpdate?: boolean }} */ (
                renderer.shadowMap
            ).autoUpdate,
            needsUpdate: /** @type {{ autoUpdate?: boolean; needsUpdate?: boolean }} */ (
                renderer.shadowMap
            ).needsUpdate,
            staticRefreshes: shadowController?.state.staticShadowRefreshes ?? 0,
            motionSources: shadowController?.state.externalMotionCount ?? 0,
        };
        scheduler.stats.post = postConfig;
        scheduler.stats.pixelRatio = rendererState?.pixelRatio;
        scheduler.stats.runtimeGovernor = runtimeGovernor?.update({ deltaTime });
        if (adaptiveQualityState?.probe) {
            updateAdaptiveQualityProbe(adaptiveQualityState.probe, { time }, adaptiveQualityState);
            if (/** @type {{ done?: boolean }} */ (adaptiveQualityState.probe).done) {
                app.qualityProfile = postConfig.adaptiveProfile;
                setDiceAppearanceQualityProfile(postConfig.adaptiveProfile);
                runtimeGovernor?.refreshBaselineFromProfile?.(adaptiveQualityState.appliedProfile);
                adaptiveQualityState.probe = null;
            }
        }
        renderStats?.update({ deltaTime });
    });

    scheduler.register('render', 'sceneRender', () => {
        const renderer = getRenderer();
        const composer = getComposer();
        const camera = getCamera();
        // EffectComposer is incompatible with the XR framebuffer — always use
        // the raw renderer while presenting (and ?xr already disables composer).
        if (isXrPresentingRef.value || renderer.xr?.isPresenting) {
            renderer.render(scene, camera);
        } else if (composer?.render) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    });
    scheduler.register(
        'postRender',
        'workerPhysicsFlush',
        () => {
            flushWorkerCommandBatch();
        },
        { priority: -100 }
    );
    scheduler.register('postRender', 'renderWarnings', () => {
        if (!debugEnabled) return;
        const drawCalls = getRenderer().info.render.calls;
        if (drawCalls > 300) {
            console.warn(`[RenderPerf] High draw call count: ${drawCalls}`);
        }
    });
}
