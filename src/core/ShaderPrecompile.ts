/**
 * Shader precompile — link a tier's programs before the first frame draws them.
 *
 * three's `WebGLRenderer` checks a program's link status lazily, the first time
 * it is drawn with (`WebGLProgram.getUniforms()` → `getProgramInfoLog`). That
 * call is a synchronous round trip to the GPU process, so the first frame that
 * shows a prop blocks the main thread for every new program in it. Measured on
 * the tavern under SwiftShader: 82 programs, 46.7 s inside `getProgramInfoLog`,
 * 3.7 s for the slowest — one `FireAnimationFrame` task of 11–37 s (#365).
 *
 * `renderer.compileAsync` is the stock answer, but it only helps where
 * `KHR_parallel_shader_compile` exists: without it three reports every program
 * "ready" immediately and the stall stays at first use. So this does it by hand,
 * and one unit at a time:
 *
 *   1. `renderer.compile(unit, camera, scene)` for ONE scene child — the
 *      synchronous half: builds and queues the link of that child's programs,
 *      with the composer's render target bound (a program's key depends on the
 *      target it renders into: output colour space, tone mapping).
 *   2. `program.getUniforms()` on each program that child brought — forces the
 *      link wait now. The wait covers every link queued so far, which is why it
 *      must be one prop's worth, not the scene's: `compile(scene)` queues all of
 *      them first and the first `getUniforms()` then absorbs the lot (measured:
 *      one "program" of 24 s, the other fifteen instant).
 *   3. A budget checkpoint, so the frame scheduler gets a turn between units.
 *
 * Where the extension exists the units are queued first, polled with the
 * non-blocking `isReady()`, and only then read.
 *
 * `precompilePostChain` does the same for the EffectComposer's own passes, which
 * `compile(scene)` never sees and which otherwise link in the first real frame.
 * It runs each pass's real `render()`, one pass per turn, rather than compiling
 * the pass's materials: `OutputPass` (and others) set their `defines` inside
 * `render()`, so a program compiled beforehand has a different key and the real
 * one links again in the first frame (measured: `OutputShader`, 3.5 s).
 *
 * The caller holds the render phase while this runs (see `LoadingTiers`), so no
 * frame draws a program that is not linked yet. WebGPU compiles pipelines off the
 * main thread already; its node-material build is JS, so it compiles one scene
 * child at a time, yielding to the budget between them.
 */
import type * as THREE from 'three';
import type { BootTrace } from './BootTrace';
import type { SpawnBudget } from './SpawnBudget';

export type PrecompileMode = 'webgl-parallel' | 'webgl-serial' | 'webgpu' | 'skipped';

export interface PrecompileResult {
    mode: PrecompileMode;
    /** `renderer.info.programs.length` before / after (null on WebGPU). */
    programsBefore: number | null;
    programsAfter: number | null;
    /** Distinct programs this pass waited on. */
    programs: number;
    longestProgramMs: number;
    longestProgram: string | null;
    /** Wall time of the synchronous `compile()` call. */
    syncMs: number;
    ms: number;
}

interface ProgramLike {
    isReady?: () => boolean;
    getUniforms?: () => unknown;
}

interface CompileRendererLike {
    isWebGPURenderer?: boolean;
    compile?: (
        scene: THREE.Object3D,
        camera: THREE.Camera,
        targetScene?: THREE.Scene | null
    ) => Set<THREE.Material> | void;
    compileAsync?: (
        scene: THREE.Object3D,
        camera: THREE.Camera,
        targetScene?: THREE.Scene | null
    ) => Promise<unknown>;
    getRenderTarget?: () => THREE.WebGLRenderTarget | null;
    setRenderTarget?: (target: THREE.WebGLRenderTarget | null) => void;
    extensions?: { has?: (name: string) => boolean };
    properties?: { get?: (object: unknown) => { currentProgram?: ProgramLike } | undefined };
    info?: { programs?: unknown[] | null };
}

/** What the WebGL post chain exposes: the target `RenderPass` draws the scene into. */
interface ComposerTargetsLike {
    readBuffer?: THREE.WebGLRenderTarget | null;
}

export interface PrecompileOptions {
    renderer: unknown;
    scene: THREE.Scene;
    camera: THREE.Camera;
    composer?: unknown;
    /** Names the trace span (`compile:<label>`) and its tier. */
    label: string;
    budget?: SpawnBudget | null;
    trace?: BootTrace | null;
    onProgress?: (done: number, total: number) => void;
    now?: () => number;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function programCount(renderer: CompileRendererLike): number | null {
    const programs = renderer.info?.programs;
    return Array.isArray(programs) ? programs.length : null;
}

/** Live program count for the trace's first-frame check (`null` where not exposed). */
export function readProgramCount(renderer: unknown): number | null {
    return programCount(renderer as CompileRendererLike);
}

/**
 * Does this subtree hold a visible light? three's `compile(unit, camera, scene)`
 * gathers lights from the scene *and* from the unit, so a unit that is already in
 * the scene and has a light counts it twice: the light count (a program-key
 * input) is wrong and the programs it builds are never the ones a frame uses.
 * Such units are compiled together, once, against the whole scene instead.
 */
function containsLight(object: THREE.Object3D): boolean {
    let found = false;
    object.traverseVisible?.((child) => {
        if ((child as { isLight?: boolean }).isLight === true) found = true;
    });
    return found;
}

/** Programs whose first use has already been forced (shared across tier passes). */
const linked = new WeakSet<object>();

interface ForceStats {
    programs: number;
    longestMs: number;
    longestName: string | null;
}

/**
 * `renderer.compile(object, camera, scene)` with `target` bound only for the
 * synchronous call — never across an await: other systems draw between turns.
 */
function compileUnit(
    renderer: CompileRendererLike,
    object: THREE.Object3D,
    camera: THREE.Camera,
    scene: THREE.Scene | null,
    target: THREE.WebGLRenderTarget | null
): Set<THREE.Material> | void {
    const previous = renderer.getRenderTarget?.() ?? null;
    if (target) renderer.setRenderTarget?.(target);
    try {
        return renderer.compile?.(object, camera, scene);
    } finally {
        if (target) renderer.setRenderTarget?.(previous);
    }
}

function programsOf(
    renderer: CompileRendererLike,
    materials: Set<THREE.Material> | void
): Map<ProgramLike, string> {
    const programs = new Map<ProgramLike, string>();
    for (const material of materials ?? []) {
        const program = renderer.properties?.get?.(material)?.currentProgram;
        if (program && !linked.has(program) && !programs.has(program)) {
            programs.set(program, material.name || material.type);
        }
    }
    return programs;
}

/** First use of one program: the link wait, timed. */
function forceLink(program: ProgramLike, name: string, stats: ForceStats, now: () => number): void {
    if (linked.has(program)) return;
    linked.add(program);
    const started = now();
    program.getUniforms?.();
    const elapsed = now() - started;
    stats.programs += 1;
    if (elapsed > stats.longestMs) {
        stats.longestMs = elapsed;
        stats.longestName = name;
    }
}

export async function precompileScene(options: PrecompileOptions): Promise<PrecompileResult> {
    const { scene, camera, label, budget, trace, onProgress } = options;
    const renderer = options.renderer as CompileRendererLike;
    const now = options.now ?? (() => performance.now());
    const started = now();
    const programsBefore = programCount(renderer);
    const end = trace?.begin(`compile:${label}`, 'compile');

    const finish = (partial: Partial<PrecompileResult> & { mode: PrecompileMode }) => {
        const result: PrecompileResult = {
            programsBefore,
            programsAfter: programCount(renderer),
            programs: 0,
            longestProgramMs: 0,
            longestProgram: null,
            syncMs: 0,
            ...partial,
            ms: now() - started,
        };
        end?.({
            mode: result.mode,
            programs: result.programs,
            programsBefore: result.programsBefore,
            programsAfter: result.programsAfter,
            longestProgramMs: Math.round(result.longestProgramMs),
            longestProgram: result.longestProgram,
            syncMs: Math.round(result.syncMs),
        });
        trace?.note('compileMode', result.mode);
        return result;
    };

    try {
        if (renderer.isWebGPURenderer === true && typeof renderer.compileAsync === 'function') {
            const units = scene.children.filter((child) => child.visible);
            const pending: Array<Promise<unknown>> = [];
            let lightUnits = 0;
            for (const [index, unit] of units.entries()) {
                // A unit with a light is compiled with the whole scene below (see containsLight).
                if (containsLight(unit)) lightUnits += 1;
                else {
                    // The renderer restores its own state before it first awaits, so
                    // these overlap safely: pipeline creation runs in the GPU process
                    // while the next unit's node materials are built here.
                    pending.push(renderer.compileAsync(unit, camera, scene));
                }
                onProgress?.(index + 1, units.length);
                await budget?.checkpoint();
            }
            if (lightUnits > 0) pending.push(renderer.compileAsync(scene, camera));
            await Promise.all(pending);
            return finish({ mode: 'webgpu', programs: units.length });
        }

        if (
            typeof renderer.compile !== 'function' ||
            typeof renderer.properties?.get !== 'function'
        ) {
            return finish({ mode: 'skipped' });
        }

        const parallel = renderer.extensions?.has?.('KHR_parallel_shader_compile') === true;
        const target = (options.composer as ComposerTargetsLike | null | undefined)?.readBuffer;
        budget?.beginSlice();

        const forced = { programs: 0, longestMs: 0, longestName: null as string | null, syncMs: 0 };
        /** Programs queued but not yet read (parallel mode reads them after polling). */
        const queued = new Map<ProgramLike, string>();

        const takeNewPrograms = async (materials: Set<THREE.Material> | void) => {
            for (const [program, name] of programsOf(renderer, materials)) {
                if (parallel) queued.set(program, name);
                else {
                    forceLink(program, name, forced, now);
                    await budget?.checkpoint();
                }
            }
        };

        const units = scene.children;
        let lightUnits = 0;
        for (const [index, unit] of units.entries()) {
            if (containsLight(unit)) {
                lightUnits += 1;
            } else {
                const syncStart = now();
                const materials = compileUnit(renderer, unit, camera, scene, target ?? null);
                forced.syncMs += now() - syncStart;
                await takeNewPrograms(materials);
            }
            onProgress?.(index + 1, units.length);
            await budget?.checkpoint();
        }
        if (lightUnits > 0) {
            // Everything else is linked by now, so this call only queues what the
            // light-bearing units brought, and the links below wait on just those.
            const syncStart = now();
            const materials = compileUnit(renderer, scene, camera, null, target ?? null);
            forced.syncMs += now() - syncStart;
            await takeNewPrograms(materials);
        }

        if (parallel) {
            let pending = [...queued.keys()].filter((p) => p.isReady?.() !== true);
            while (pending.length > 0) {
                await delay(10);
                pending = pending.filter((p) => p.isReady?.() !== true);
            }
            for (const [program, name] of queued) {
                forceLink(program, name, forced, now);
                await budget?.checkpoint();
            }
        }

        return finish({
            mode: parallel ? 'webgl-parallel' : 'webgl-serial',
            programs: forced.programs,
            longestProgramMs: forced.longestMs,
            longestProgram: forced.longestName,
            syncMs: forced.syncMs,
        });
    } catch (error) {
        end?.({ error: true });
        throw error;
    }
}

/** The slice of an EffectComposer `precompilePostChain` drives. */
interface PostComposerLike {
    passes?: PostPassLike[];
    readBuffer?: unknown;
    writeBuffer?: unknown;
    renderToScreen?: boolean;
    isLastEnabledPass?: (index: number) => boolean;
    swapBuffers?: () => void;
}

interface PostPassLike {
    enabled?: boolean;
    needsSwap?: boolean;
    renderToScreen?: boolean;
    /** Only a `RenderPass` has one: it draws the scene, which the tier passes link. */
    scene?: { isScene?: boolean };
    render?: (
        renderer: unknown,
        writeBuffer: unknown,
        readBuffer: unknown,
        deltaTime: number,
        maskActive: boolean
    ) => void;
}

/** What `precompilePostChain` did. */
export interface PostChainResult {
    /** Passes whose `render()` ran. */
    passes: number;
    /** Programs the renderer gained while they did. */
    programs: number;
    ms: number;
}

/**
 * Link the EffectComposer's own programs (bloom blur kernels, vignette, output…)
 * by running each pass's `render()` once — one pass per turn, with a budget
 * checkpoint between — against the composer's real buffers, the way
 * `EffectComposer.render` would (the last enabled pass renders to the canvas, the
 * others to the buffers, and buffers swap where a pass asks). The scene's
 * `RenderPass` is skipped: it draws every prop, which `precompileScene` has
 * already linked tier by tier. Runs under the boot's render hold behind the
 * opaque loading overlay, so what these passes draw is never seen; the next real
 * frame overwrites it.
 */
export async function precompilePostChain(options: {
    renderer: unknown;
    composer: unknown;
    budget?: SpawnBudget | null;
    trace?: BootTrace | null;
    onProgress?: (done: number, total: number) => void;
    now?: () => number;
}): Promise<PostChainResult> {
    const { renderer, budget, trace, onProgress } = options;
    const composer = options.composer as PostComposerLike | null | undefined;
    const now = options.now ?? (() => performance.now());
    const none: PostChainResult = { passes: 0, programs: 0, ms: 0 };
    if (!Array.isArray(composer?.passes)) return none;

    const indices: number[] = [];
    composer.passes.forEach((pass, index) => {
        if (pass.enabled !== false && pass.scene?.isScene !== true && pass.render)
            indices.push(index);
    });
    if (indices.length === 0) return none;

    const started = now();
    const programsBefore = readProgramCount(renderer);
    const end = trace?.begin('compile:post', 'compile');
    budget?.beginSlice();
    let swaps = 0;
    try {
        for (const [done, index] of indices.entries()) {
            const pass = composer.passes[index] as PostPassLike;
            pass.renderToScreen =
                composer.renderToScreen !== false && composer.isLastEnabledPass?.(index) === true;
            pass.render?.(renderer, composer.writeBuffer, composer.readBuffer, 0, false);
            if (pass.needsSwap) {
                composer.swapBuffers?.();
                swaps += 1;
            }
            onProgress?.(done + 1, indices.length);
            await budget?.checkpoint();
        }
    } finally {
        // Leave the ping-pong where the next real frame expects it.
        if (swaps % 2 === 1) composer.swapBuffers?.();
    }
    const programsAfter = readProgramCount(renderer);
    const programs =
        programsBefore !== null && programsAfter !== null ? programsAfter - programsBefore : 0;
    const ms = now() - started;
    end?.({ mode: 'post-chain', passes: indices.length, programs, programsAfter });
    return { passes: indices.length, programs, ms };
}

/** What `warmFirstRender` did. */
export interface WarmRenderResult {
    /** False where there is nothing to warm (WebGPU, no renderer). */
    ran: boolean;
    /** Programs the renderer gained during the render (the shadow-depth variants). */
    programs: number;
    ms: number;
}

interface WarmRendererLike {
    isWebGPURenderer?: boolean;
    render?: (scene: unknown, camera: unknown) => void;
    shadowMap?: { enabled?: boolean; needsUpdate?: boolean };
}

/**
 * One real render of the scene, last, behind the opaque overlay and the render hold.
 *
 * Everything `precompileScene` and `precompilePostChain` link is what three can be
 * asked for ahead of time. What is left is built inside `render()` itself: the
 * shadow-depth and distance programs (`WebGLShadowMap` builds them from the
 * casters, and `setProgram` needs the render state that only exists during a
 * render), plus the first upload of every texture and buffer. Left to the first
 * real frame they are one task the player sees as a freeze right after the
 * overlay fades (measured: 4 programs, 8–18 s on SwiftShader). Here the programs
 * every other unit shares are linked already, so what this render links is only
 * those.
 *
 * It draws the scene pass the way `EffectComposer.render` would (the composer's
 * buffers bound), or straight to the canvas without a composer. The shadow map is
 * re-armed afterwards: this render consumed the pending update, and the boot's
 * finalizing step still changes which props cast.
 */
export async function warmFirstRender(options: {
    renderer: unknown;
    scene: THREE.Scene;
    camera: THREE.Camera;
    composer?: unknown;
    budget?: SpawnBudget | null;
    trace?: BootTrace | null;
    now?: () => number;
}): Promise<WarmRenderResult> {
    const renderer = options.renderer as WarmRendererLike | null | undefined;
    const now = options.now ?? (() => performance.now());
    if (!renderer || renderer.isWebGPURenderer === true || typeof renderer.render !== 'function') {
        return { ran: false, programs: 0, ms: 0 };
    }
    const composer = options.composer as PostComposerLike | null | undefined;
    const scenePass = composer?.passes?.find(
        (pass) => pass.enabled !== false && pass.scene?.isScene === true && pass.render
    );

    // A frame turn first, so the overlay has painted its "warming" text before the task.
    await options.budget?.checkpoint();
    const started = now();
    const before = readProgramCount(renderer);
    const end = options.trace?.begin('compile:first-render', 'compile');
    try {
        if (scenePass?.render) {
            scenePass.render(renderer, composer?.writeBuffer, composer?.readBuffer, 0, false);
        } else {
            renderer.render(options.scene, options.camera);
        }
    } finally {
        if (renderer.shadowMap && renderer.shadowMap.enabled !== false) {
            renderer.shadowMap.needsUpdate = true;
        }
    }
    const after = readProgramCount(renderer);
    const programs = before !== null && after !== null ? after - before : 0;
    end?.({ mode: 'first-render', programs, programsAfter: after });
    return { ran: true, programs, ms: now() - started };
}
