import type { EvaluatedRoll } from './roll';
import type { DiceReadValue } from './dice';

export interface ComposerLike {
    render?: () => void;
    dispose?: () => void;
    type?: string;
    setPixelRatio?: (ratio: number) => void;
    setSize?: (width: number, height: number) => void;
}

export interface PostConfig {
    bloomEnabled?: boolean;
    quality?: 'low' | 'high' | string;
    fxaaEnabled?: boolean;
    chromaticAberrationEnabled?: boolean;
    godRaysEnabled?: boolean;
    adaptiveProfile?: string;
    lowEndDetected?: boolean;
    softwareRenderer?: boolean;
    rendererType?: string;
    requestedRenderer?: string;
    [key: string]: unknown;
}

export interface RendererState {
    renderer?: import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer;
    composer?: ComposerLike | import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer | null;
    postConfig?: PostConfig;
    postProcessing?: unknown;
    postPipeline?: unknown;
    qualityProfile?: unknown;
    usingWebGPU?: boolean;
    usingWebGL?: boolean;
    rendererType?: 'webgl' | 'webgpu' | string;
    requestedRenderer?: string;
    fallbackReason?: string | null;
    pixelRatio?: number;
    pixelRatioForced?: boolean;
    antialias?: boolean;
    isSoftwareRenderer?: boolean;
    usePostAA?: boolean;
    _recoveryCleanup?: (() => void) | null;
    [key: string]: unknown;
}

export interface PendingRollMeta {
    seed: number | null;
    expression: string | null;
    diceSet: Record<string, number>;
    source?: string;
}

export interface TierLoadCallbacks {
    /** App context — used to mark ready / share quality without window globals. */
    app?: import('./app').AppContext;
    audio?: unknown;
    qualityProfile?: string | unknown | null;
    onRollAll?: () => void;
    rollShareHooks?: {
        hasShareableRoll?: () => boolean;
        buildShareUrl?: () => string | null;
    };
    notationHooks?: {
        onNotationRoll?: (expression: string) => Promise<void>;
    };
    setLampData?: (data: unknown) => void;
    setGongData?: (data: unknown) => void;
    setCandleFlamePos?: (pos: import('three').Vector3) => void;
    setInteraction?: (interaction: ReturnType<typeof import('../interaction.js').initInteraction>) => void;
    onDiceCupInteract?: () => void;
    getDiceCupState?: () => { available: boolean; state: string };
    interactionHooks?: import('./interaction.d.ts').InteractionHooks;
}

export interface AppOrchestrator {
    scheduler: ReturnType<typeof import('../core/FrameScheduler.js').createFrameScheduler>;
    cullingSystem: ReturnType<typeof import('../core/CullingSystem.js').createCullingSystem>;
}

export interface AdaptiveQualityState {
    probe: unknown;
    initialProfile: unknown;
    appliedProfile: unknown;
    scene: import('three').Scene;
    renderer: import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer;
    postConfig: PostConfig;
    composer?: ComposerLike | import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer | null;
    spotLight?: import('three').SpotLight;
    rendererState?: RendererState;
}

export interface PostRuntimeControls {
    setBloomBlend: (value: number) => void;
    setChromaticIntensity: (value: number) => void;
    getBloomBlend: () => number;
    getChromaticIntensity: () => number;
    restoreBaseline: () => void;
    getBaselineBloomBlend: () => number;
    getBaselineChromaticIntensity: () => number;
}

export interface RenderStatsConfig {
    renderer: import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer;
    scene: import('three').Scene;
    scheduler: import('../core/FrameScheduler.js').FrameScheduler;
    cullingSystem?: import('../core/CullingSystem.js').CullingSystem | null;
    getRenderer?: () => import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer | null;
    getRendererState?: () => RendererState | null;
    getPost?: () => PostConfig | null;
    getGovernor?: () => Record<string, unknown> | null;
    getShadow?: () => Record<string, unknown> | null;
    getDice?: () => Record<string, unknown> | null;
    getWasm?: () => Record<string, unknown> | null;
    getAudio?: () => Record<string, unknown> | null;
    getCollisionTotal?: () => number;
    getTierRenderStats?: () => unknown;
    debugPerf?: boolean;
    visible?: boolean;
}

export interface MotionProfileDeps {
    scene: import('three').Scene;
    postConfig: PostConfig;
    postRuntime: PostRuntimeControls;
    appliedProfile?: { godRaysEnabled?: boolean; shadowLights?: string } | null;
    runtimeGovernor?: { setDisabled?: (disabled: boolean) => void; refreshBaselineFromProfile?: (profile: unknown) => void } | null;
    diceGameFeel?: { setMotionBlurAllowed?: (allowed: boolean) => void } | null;
}

export interface SceneSetupResult {
    scene: import('three').Scene;
    camera: import('three').PerspectiveCamera;
    renderer: import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer;
    composer: ComposerLike | import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer | null;
    pointLight: import('three').PointLight;
    spotLight: import('three').SpotLight;
    postConfig: PostConfig;
    postPasses?: unknown;
    postRuntime: PostRuntimeControls;
    rendererState: RendererState;
    initialQuality: unknown;
}

export interface MainDebugHooks {
    replayRoll?: (seed?: number | null) => void;
    readAllDiceValues?: () => DiceReadValue[];
    areDiceSettled?: () => boolean;
    isWasmAvailable?: () => boolean;
    touchInputEnabled?: boolean;
    isTouchPrimaryDevice?: boolean;
}

/** Event names emitted by AppEvents (see src/core/AppEvents.js). */
export type AppEventName =
    | 'roll:started'
    | 'roll:settled'
    | 'dice:collision'
    | 'renderer:lost'
    | 'layout:rerolled'
    | 'app:ready';

export interface AppEvents {
    on(type: string, handler: (payload: unknown) => void): () => void;
    once(type: string, handler: (payload: unknown) => void): () => void;
    off(type: string, handler: (payload: unknown) => void): void;
    emit(type: string, payload?: unknown): void;
    clear(): void;
    AppEvent: {
        ROLL_STARTED: 'roll:started';
        ROLL_SETTLED: 'roll:settled';
        DICE_COLLISION: 'dice:collision';
        RENDERER_LOST: 'renderer:lost';
        LAYOUT_REROLLED: 'layout:rerolled';
        APP_READY: 'app:ready';
    };
}

export interface AppContextPhysics {
    world: import('./ammo').AmmoWorld | null;
    getWasmEngine: (() => import('./physics').PhysicsEngine) | null;
    isWasmAvailable: (() => boolean) | null;
}

export interface AppContextDice {
    replayRoll: ((seed?: number | null) => void) | null;
    readAllDiceValues: (() => DiceReadValue[]) | null;
    areDiceSettled: (() => boolean) | null;
    getDiceValueDebugSnapshot: (() => unknown[]) | null;
    rollNotation: ((expression: string, seed?: number | null) => Promise<unknown>) | null;
}

export interface AppContextInteractable {
    trigger: (opts?: unknown) => void;
    getState?: () => Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * Mutable bag created in main.js and filled as systems come online.
 * Exposed as `window.__app` only under `?test` / `?debug` / `?debug-perf`.
 */
export interface AppContext {
    events: AppEvents;
    ready: boolean;
    scene: import('three').Scene | null;
    camera: import('three').PerspectiveCamera | null;
    renderer: import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer | null;
    THREE: typeof import('three') | null;
    scheduler: ReturnType<typeof import('../core/FrameScheduler.js').createFrameScheduler> | null;
    physicsWorld: import('./ammo').AmmoWorld | null;
    physics: AppContextPhysics;
    dice: AppContextDice;
    interaction: ReturnType<typeof import('../interaction.js').initInteraction> | null;
    audio: unknown;
    rollSession: unknown;
    ui: ReturnType<typeof import('../ui.js').initUI> | null;
    interactables: Record<string, AppContextInteractable>;
    PropRegistry: Record<string, unknown> | null;
    qualityProfile: unknown;
    postConfig: PostConfig | null;
    rendererType: 'webgl' | 'webgpu' | string | null;
    usingWebGPU: boolean;
    usingWebGL: boolean;
    rendererFallbackReason: string | null;
    touchInputEnabled: boolean;
    isTouchPrimaryDevice: boolean;
    stats: unknown;
    tierRenderStats: unknown;
    fairnessMonitor: unknown;
    rollHistory: unknown;
    rollStats: unknown;
    forceShadowRefresh: ((...args: unknown[]) => void) | null;
    resetFairnessMonitor: ((...args: unknown[]) => void) | null;
    rerollTableLayout: ((overrides?: unknown) => Promise<unknown>) | null;
    getTableLayoutConfig: (() => unknown) | null;
    getLastRollShareUrl: (() => string | null) | null;
    getDiceAppearanceConfig: (() => unknown) | null;
    getDicePresencePayload: (() => unknown) | null;
    applyDicePresencePayload: ((payload: unknown) => void) | null;
    refreshDiceAppearance: (() => void) | null;
    REPLAY_VERSION: number | null;
    multiplayer?: unknown;
    /** WebXR seated-table spike API when `?xr` is set. */
    xr?: unknown;
    /** Top-level aliases for Playwright (`window.__app.replayRoll`). */
    replayRoll?: ((seed?: number | null) => void) | null;
    readAllDiceValues?: (() => DiceReadValue[]) | null;
    areDiceSettled?: (() => boolean) | null;
    isWasmAvailable?: (() => boolean) | null;
    getWasmEngine?: (() => import('./physics').PhysicsEngine) | null;
}

export type { EvaluatedRoll, DiceReadValue };
