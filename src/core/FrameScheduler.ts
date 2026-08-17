import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { ComposerLike } from '../types/app';

export const FRAME_PHASES = [
    'preStep',
    'physicsStep',
    'postPhysicsSync',
    'updates',
    'preRender',
    'render',
    'postRender',
] as const;

export type FramePhase = (typeof FRAME_PHASES)[number];

export interface FrameBaseContext {
    deltaTime: number;
    time: number;
    renderer?: THREE.WebGLRenderer | WebGPURenderer | null;
    composer?: ComposerLike | null;
    scene?: THREE.Scene | null;
    camera?: THREE.Camera | null;
    [key: string]: unknown;
}

export interface FrameContext extends FrameBaseContext {
    fixedDeltaTime: number;
    physicsSteps: number;
    interpolationAlpha: number;
    frame: number;
    phase: FramePhase | null;
    isFixedStep?: boolean;
    physicsStepIndex?: number;
}

export type FrameSystemFn = (context: FrameContext) => void;

export interface FrameSchedulerOptions {
    fixedDeltaTime?: number;
    maxPhysicsSteps?: number;
    debugPerf?: boolean;
}

export interface FrameSystemRegistrationOptions {
    priority?: number;
    enabled?: boolean;
}

export interface FrameSystemHandle {
    enable: () => void;
    disable: () => void;
    dispose: () => void;
}

interface FrameSystem {
    phase: FramePhase;
    name: string;
    fn: FrameSystemFn;
    priority: number;
    enabled: boolean;
}

export interface FrameSchedulerStats {
    frame: number;
    lastDeltaTime: number;
    physicsSteps: number;
    interpolationAlpha: number;
    phaseTimes: Partial<Record<FramePhase, number>>;
    systemTimes: Record<string, number>;
    renderer: {
        render: Record<string, unknown>;
        memory: Record<string, unknown>;
    } | null;
}

type PhaseBucket = Record<FramePhase, FrameSystem[]>;

function createPhaseBucket(): PhaseBucket {
    return FRAME_PHASES.reduce((acc, phase) => {
        acc[phase] = [];
        return acc;
    }, {} as PhaseBucket);
}

export class FrameScheduler {
    fixedDeltaTime: number;
    maxPhysicsSteps: number;
    debugPerf: boolean;
    accumulator: number;
    systems: PhaseBucket;
    stats: FrameSchedulerStats;

    constructor({
        fixedDeltaTime = 1 / 60,
        maxPhysicsSteps = 5,
        debugPerf = false,
    }: FrameSchedulerOptions = {}) {
        this.fixedDeltaTime = fixedDeltaTime;
        this.maxPhysicsSteps = maxPhysicsSteps;
        this.debugPerf = debugPerf;
        this.accumulator = 0;
        this.systems = createPhaseBucket();
        this.stats = {
            frame: 0,
            lastDeltaTime: 0,
            physicsSteps: 0,
            interpolationAlpha: 0,
            phaseTimes: {},
            systemTimes: {},
            renderer: null,
        };
    }

    register(
        phase: FramePhase,
        name: string,
        fn: FrameSystemFn,
        { priority = 0, enabled = true }: FrameSystemRegistrationOptions = {}
    ): FrameSystemHandle {
        if (!this.systems[phase]) {
            throw new Error(`Unknown frame phase "${phase}"`);
        }

        const system: FrameSystem = { phase, name, fn, priority, enabled };
        this.systems[phase].push(system);
        this.systems[phase].sort((a, b) => a.priority - b.priority);

        return {
            enable: () => {
                system.enabled = true;
            },
            disable: () => {
                system.enabled = false;
            },
            dispose: () => {
                const bucket = this.systems[phase];
                const index = bucket.indexOf(system);
                if (index >= 0) bucket.splice(index, 1);
            },
        };
    }

    runFrame(baseContext: FrameBaseContext): FrameContext {
        this.stats.frame += 1;
        this.stats.lastDeltaTime = baseContext.deltaTime;
        this.accumulator = Math.min(
            this.accumulator + baseContext.deltaTime,
            this.fixedDeltaTime * this.maxPhysicsSteps
        );

        const frameContext: FrameContext = {
            ...baseContext,
            fixedDeltaTime: this.fixedDeltaTime,
            physicsSteps: 0,
            interpolationAlpha: 0,
            frame: this.stats.frame,
            phase: null,
        };

        this.#runPhase('preStep', frameContext);

        let physicsSteps = 0;
        while (this.accumulator >= this.fixedDeltaTime && physicsSteps < this.maxPhysicsSteps) {
            const stepContext: FrameContext = {
                ...frameContext,
                deltaTime: this.fixedDeltaTime,
                isFixedStep: true,
                physicsStepIndex: physicsSteps,
            };
            this.#runPhase('physicsStep', stepContext);
            this.accumulator -= this.fixedDeltaTime;
            physicsSteps += 1;
        }

        frameContext.physicsSteps = physicsSteps;
        frameContext.interpolationAlpha =
            this.fixedDeltaTime > 0 ? this.accumulator / this.fixedDeltaTime : 0;
        this.stats.physicsSteps = physicsSteps;
        this.stats.interpolationAlpha = frameContext.interpolationAlpha;

        this.#runPhase('postPhysicsSync', frameContext);
        this.#runPhase('updates', frameContext);
        this.#runPhase('preRender', frameContext);
        this.#runPhase('render', frameContext);
        this.#runPhase('postRender', frameContext);

        if (frameContext.renderer?.info) {
            this.stats.renderer = {
                render: { ...frameContext.renderer.info.render },
                memory: { ...frameContext.renderer.info.memory },
            };
        }

        return frameContext;
    }

    #runPhase(phase: FramePhase, context: FrameContext): void {
        const systems = this.systems[phase];
        if (!systems || systems.length === 0) return;

        context.phase = phase;
        const phaseStart = this.debugPerf ? performance.now() : 0;

        for (const system of systems) {
            if (!system.enabled) continue;

            const systemStart = this.debugPerf ? performance.now() : 0;
            system.fn(context);

            if (this.debugPerf) {
                const duration = performance.now() - systemStart;
                this.stats.systemTimes[system.name] = duration;
                if (duration > 4) {
                    console.warn(
                        `[FrameScheduler] Slow system "${system.name}" in ${phase}: ${duration.toFixed(2)}ms`
                    );
                }
            }
        }

        if (this.debugPerf) {
            this.stats.phaseTimes[phase] = performance.now() - phaseStart;
        }
    }
}

export function createFrameScheduler(options?: FrameSchedulerOptions): FrameScheduler {
    return new FrameScheduler(options);
}
