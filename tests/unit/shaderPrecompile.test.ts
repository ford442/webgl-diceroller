/**
 * precompileScene / precompilePostChain against a fake renderer.
 *
 * The WebGL path must (a) compile ONE scene child at a time, because the first
 * `getUniforms()` after a batch of queued links absorbs the whole batch, (b)
 * bind the composer's render target only around the synchronous `compile()` and
 * restore it before any await, (c) force each distinct program's first use
 * once, with a budget checkpoint between units, and (d) poll `isReady` only
 * where the parallel-compile extension exists.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    precompilePostChain,
    precompileScene,
    readProgramCount,
    warmFirstRender,
} from '../../src/core/ShaderPrecompile.js';

interface FakeProgram {
    id: string;
    getUniforms: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
}

/** A renderer whose `compile(unit)` returns the materials registered for that unit. */
function makeRenderer({ parallel }: { parallel: boolean }) {
    const log: string[] = [];
    let target: unknown = null;
    const makeProgram = (id: string, readyAfterPolls = 0): FakeProgram => {
        let polls = 0;
        return {
            id,
            getUniforms: vi.fn(() => log.push(`link:${id}`)),
            isReady: vi.fn(() => ++polls > readyAfterPolls),
        };
    };
    const shared = makeProgram('shared', parallel ? 2 : 0);
    const other = makeProgram('other');
    const materialProgram = new Map<unknown, FakeProgram>();
    const unitMaterials = new Map<unknown, Set<unknown>>();
    const material = (name: string, type: string, program: FakeProgram) => {
        const m = { name, type };
        materialProgram.set(m, program);
        return m;
    };
    const renderer = {
        extensions: { has: (name: string) => parallel && name === 'KHR_parallel_shader_compile' },
        properties: { get: (m: unknown) => ({ currentProgram: materialProgram.get(m) }) },
        info: { programs: [] as unknown[] },
        getRenderTarget: () => target,
        setRenderTarget: vi.fn((t: unknown) => {
            log.push(`target:${t === null ? 'null' : 'rt'}`);
            target = t;
        }),
        compile: vi.fn((unit: unknown) => {
            log.push(
                `compile(${(unit as { id: string }).id},target=${target === null ? 'null' : 'rt'})`
            );
            return unitMaterials.get(unit) ?? new Set();
        }),
    };
    return { renderer, log, shared, other, material, unitMaterials };
}

const camera = {} as never;

function sceneOf(...ids: string[]) {
    const children = ids.map((id) => ({ id, visible: true }));
    return { scene: { children } as never, children };
}

describe('precompileScene (WebGL)', () => {
    it('compiles one scene child at a time and forces each new program as it goes', async () => {
        const fake = makeRenderer({ parallel: false });
        const { scene, children } = sceneOf('a', 'b');
        const wood = fake.material('Wood', 'MeshStandardMaterial', fake.shared);
        const glass = fake.material('', 'MeshPhysicalMaterial', fake.other);
        fake.unitMaterials.set(children[0], new Set([wood]));
        fake.unitMaterials.set(children[1], new Set([glass]));

        const result = await precompileScene({
            renderer: fake.renderer,
            scene,
            camera,
            label: 'tier1',
        });

        // Link waits interleave with compiles: a's program is forced before b is queued.
        expect(fake.log).toEqual([
            'compile(a,target=null)',
            'link:shared',
            'compile(b,target=null)',
            'link:other',
        ]);
        expect(result).toMatchObject({ mode: 'webgl-serial', programs: 2 });
    });

    it('forces a program shared by several units once, and not again on a later pass', async () => {
        const fake = makeRenderer({ parallel: false });
        const { scene, children } = sceneOf('a', 'b');
        const shared = fake.material('Wood', 'MeshStandardMaterial', fake.shared);
        fake.unitMaterials.set(children[0], new Set([shared]));
        fake.unitMaterials.set(children[1], new Set([shared]));

        await precompileScene({ renderer: fake.renderer, scene, camera, label: 'tier0' });
        const second = await precompileScene({
            renderer: fake.renderer,
            scene,
            camera,
            label: 'tier1',
        });

        expect(fake.shared.getUniforms).toHaveBeenCalledTimes(1);
        expect(second.programs).toBe(0);
    });

    it("binds the composer's render target only around each compile, never across an await", async () => {
        const fake = makeRenderer({ parallel: false });
        const { scene, children } = sceneOf('a', 'b');
        const rt = { isRt: true };
        fake.unitMaterials.set(children[0], new Set([fake.material('A', 'T', fake.shared)]));
        fake.unitMaterials.set(children[1], new Set([fake.material('B', 'T', fake.other)]));

        await precompileScene({
            renderer: fake.renderer,
            scene,
            camera,
            composer: { readBuffer: rt },
            label: 'tier0',
        });

        expect(fake.log).toEqual([
            'target:rt',
            'compile(a,target=rt)',
            'target:null',
            'link:shared',
            'target:rt',
            'compile(b,target=rt)',
            'target:null',
            'link:other',
        ]);
        expect(fake.renderer.getRenderTarget()).toBeNull();
    });

    it('leaves the render target alone without a composer', async () => {
        const fake = makeRenderer({ parallel: false });
        const { scene } = sceneOf('a');
        await precompileScene({ renderer: fake.renderer, scene, camera, label: 'tier0' });
        expect(fake.renderer.setRenderTarget).not.toHaveBeenCalled();
    });

    it('yields to the budget after every unit, and reports progress by unit', async () => {
        const fake = makeRenderer({ parallel: false });
        const { scene } = sceneOf('a', 'b', 'c');
        const checkpoint = vi.fn();
        const beginSlice = vi.fn();
        const progress: Array<[number, number]> = [];
        await precompileScene({
            renderer: fake.renderer,
            scene,
            camera,
            label: 'tier1',
            budget: { checkpoint, beginSlice } as never,
            onProgress: (done, total) => progress.push([done, total]),
        });
        expect(beginSlice).toHaveBeenCalledTimes(1);
        expect(checkpoint).toHaveBeenCalledTimes(3);
        expect(progress).toEqual([
            [1, 3],
            [2, 3],
            [3, 3],
        ]);
    });

    it('compiles a unit that holds a light with the whole scene, after the others (it would count its light twice)', async () => {
        const fake = makeRenderer({ parallel: false });
        const lamp = {
            id: 'lamp',
            visible: true,
            traverseVisible: (cb: (o: unknown) => void) => cb({ isLight: true }),
        };
        const chair = {
            id: 'chair',
            visible: true,
            traverseVisible: (cb: (o: unknown) => void) => cb({}),
        };
        const scene = { id: 'scene', children: [lamp, chair] } as never;
        fake.unitMaterials.set(chair, new Set([fake.material('Chair', 'M', fake.shared)]));
        fake.unitMaterials.set(scene, new Set([fake.material('Lamp', 'M', fake.other)]));

        await precompileScene({ renderer: fake.renderer, scene, camera, label: 'tier1' });

        expect(fake.log).toEqual([
            'compile(chair,target=null)',
            'link:shared',
            'compile(scene,target=null)',
            'link:other',
        ]);
        // The lamp itself is never compiled as a unit.
        expect(fake.renderer.compile).not.toHaveBeenCalledWith(
            lamp,
            expect.anything(),
            expect.anything()
        );
    });

    it('serial mode never polls isReady (three marks every program ready up front)', async () => {
        const fake = makeRenderer({ parallel: false });
        const { scene, children } = sceneOf('a');
        fake.unitMaterials.set(children[0], new Set([fake.material('A', 'T', fake.shared)]));
        await precompileScene({ renderer: fake.renderer, scene, camera, label: 'x' });
        expect(fake.shared.isReady).not.toHaveBeenCalled();
    });

    it('parallel mode queues every unit, polls isReady until all have linked, then reads them', async () => {
        const fake = makeRenderer({ parallel: true });
        const { scene, children } = sceneOf('a', 'b');
        fake.unitMaterials.set(children[0], new Set([fake.material('A', 'T', fake.shared)]));
        fake.unitMaterials.set(children[1], new Set([fake.material('B', 'T', fake.other)]));

        const result = await precompileScene({
            renderer: fake.renderer,
            scene,
            camera,
            label: 'tier0',
        });

        expect(result.mode).toBe('webgl-parallel');
        expect(fake.log.slice(0, 2)).toEqual(['compile(a,target=null)', 'compile(b,target=null)']);
        expect(fake.shared.isReady).toHaveBeenCalledTimes(3);
        expect(fake.log.filter((l) => l.startsWith('link:'))).toEqual([
            'link:shared',
            'link:other',
        ]);
    });

    it('reports the slowest program and ends its trace span with the numbers', async () => {
        const fake = makeRenderer({ parallel: false });
        const { scene, children } = sceneOf('a', 'b');
        fake.unitMaterials.set(children[0], new Set([fake.material('Wood', 'M', fake.shared)]));
        fake.unitMaterials.set(children[1], new Set([fake.material('Glass', 'M', fake.other)]));
        let t = 0;
        fake.shared.getUniforms.mockImplementation(() => (t += 400));
        fake.other.getUniforms.mockImplementation(() => (t += 50));
        const end = vi.fn();
        const trace = { begin: vi.fn(() => end), note: vi.fn() };

        const result = await precompileScene({
            renderer: fake.renderer,
            scene,
            camera,
            label: 'decor',
            trace: trace as never,
            now: () => t,
        });

        expect(result.longestProgramMs).toBe(400);
        expect(result.longestProgram).toBe('Wood');
        expect(trace.begin).toHaveBeenCalledWith('compile:decor', 'compile');
        expect(end).toHaveBeenCalledWith(
            expect.objectContaining({ mode: 'webgl-serial', programs: 2, longestProgramMs: 400 })
        );
    });

    it('skips (and says so) for a renderer with nothing to compile', async () => {
        const result = await precompileScene({
            renderer: {},
            scene: sceneOf().scene,
            camera,
            label: 'x',
        });
        expect(result.mode).toBe('skipped');
    });
});

describe('precompileScene (WebGPU)', () => {
    it('compiles each visible child with the scene as target and awaits all pipelines', async () => {
        const kids = [{ visible: true }, { visible: false }, { visible: true }];
        const compileAsync = vi.fn(() => Promise.resolve());
        const checkpoint = vi.fn();
        const result = await precompileScene({
            renderer: { isWebGPURenderer: true, compileAsync },
            scene: { children: kids } as never,
            camera,
            label: 'tier0',
            budget: { checkpoint } as never,
        });
        expect(result.mode).toBe('webgpu');
        expect(compileAsync).toHaveBeenCalledTimes(2);
        expect(compileAsync.mock.calls.map((c: unknown[]) => c[0])).toEqual([kids[0], kids[2]]);
        expect(checkpoint).toHaveBeenCalledTimes(2);
    });
});

describe('precompileScene (WebGPU, lights)', () => {
    it('compiles light-bearing children with the whole scene instead', async () => {
        const lit = {
            visible: true,
            traverseVisible: (cb: (o: unknown) => void) => cb({ isLight: true }),
        };
        const plain = { visible: true, traverseVisible: (cb: (o: unknown) => void) => cb({}) };
        const scene = { children: [lit, plain] } as never;
        const compileAsync = vi.fn(() => Promise.resolve());
        await precompileScene({
            renderer: { isWebGPURenderer: true, compileAsync },
            scene,
            camera,
            label: 'tier0',
        });
        expect(compileAsync.mock.calls).toEqual([
            [plain, camera, scene],
            [scene, camera],
        ]);
    });
});

describe('precompilePostChain', () => {
    /** A composer of fake passes that logs every render and swap. */
    function setup(
        spec: Array<{
            name: string;
            enabled?: boolean;
            needsSwap?: boolean;
            scene?: boolean;
            programs?: number;
        }>
    ) {
        const log: string[] = [];
        const programs: unknown[] = [];
        const read = { id: 'read' };
        const write = { id: 'write' };
        const composer = {
            readBuffer: read as unknown,
            writeBuffer: write as unknown,
            renderToScreen: true,
            swapBuffers: vi.fn(() => {
                [composer.readBuffer, composer.writeBuffer] = [
                    composer.writeBuffer,
                    composer.readBuffer,
                ];
                log.push('swap');
            }),
            isLastEnabledPass(index: number) {
                return composer.passes.findLastIndex((p) => p.enabled !== false) === index;
            },
            passes: spec.map((entry) => ({
                enabled: entry.enabled,
                needsSwap: entry.needsSwap ?? false,
                renderToScreen: false,
                scene: entry.scene ? { isScene: true } : undefined,
                render: vi.fn(function (this: { renderToScreen: boolean }, _r, w, rd) {
                    const bufs = `${(rd as { id: string }).id}->${(w as { id: string }).id}`;
                    log.push(`${entry.name}(${bufs},screen=${this.renderToScreen})`);
                    for (let i = 0; i < (entry.programs ?? 0); i++) programs.push({});
                }),
            })),
        };
        return { composer, log, renderer: { info: { programs } } };
    }

    it("runs each pass's own render in order, skipping the scene pass and disabled passes", async () => {
        const { composer, log, renderer } = setup([
            { name: 'scene', scene: true },
            { name: 'bloom' },
            { name: 'off', enabled: false },
            { name: 'vignette', needsSwap: true },
            { name: 'output' },
        ]);
        const result = await precompilePostChain({ renderer, composer });
        expect(log).toEqual([
            'bloom(read->write,screen=false)',
            'vignette(read->write,screen=false)',
            'swap',
            'output(write->read,screen=true)',
            // one swap happened (odd): parity is restored for the next real frame
            'swap',
        ]);
        expect(composer.passes[0]?.render).not.toHaveBeenCalled();
        expect(composer.passes[2]?.render).not.toHaveBeenCalled();
        expect(composer.readBuffer).toEqual({ id: 'read' });
        expect(result.passes).toBe(3);
    });

    it('leaves buffer parity alone when passes swapped an even number of times', async () => {
        const { composer, log, renderer } = setup([
            { name: 'a', needsSwap: true },
            { name: 'b', needsSwap: true },
            { name: 'c' },
        ]);
        await precompilePostChain({ renderer, composer });
        expect(log.filter((l) => l === 'swap')).toHaveLength(2);
        expect(composer.readBuffer).toEqual({ id: 'read' });
    });

    it('renders nothing to the canvas when the composer does not render to screen', async () => {
        const { composer, log, renderer } = setup([{ name: 'a' }, { name: 'b' }]);
        composer.renderToScreen = false;
        await precompilePostChain({ renderer, composer });
        expect(log.every((l) => l.endsWith('screen=false)'))).toBe(true);
    });

    it('yields to the budget after every pass and reports progress', async () => {
        const { composer, renderer } = setup([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
        const checkpoint = vi.fn();
        const beginSlice = vi.fn();
        const progress: Array<[number, number]> = [];
        await precompilePostChain({
            renderer,
            composer,
            budget: { checkpoint, beginSlice } as never,
            onProgress: (done, total) => progress.push([done, total]),
        });
        expect(beginSlice).toHaveBeenCalledTimes(1);
        expect(checkpoint).toHaveBeenCalledTimes(3);
        expect(progress).toEqual([
            [1, 3],
            [2, 3],
            [3, 3],
        ]);
    });

    it('counts the programs the passes brought and ends its trace span with them', async () => {
        const { composer, renderer } = setup([
            { name: 'bloom', programs: 7 },
            { name: 'output', programs: 1 },
        ]);
        const end = vi.fn();
        const trace = { begin: vi.fn(() => end) };
        const result = await precompilePostChain({ renderer, composer, trace: trace as never });
        expect(result.programs).toBe(8);
        expect(trace.begin).toHaveBeenCalledWith('compile:post', 'compile');
        expect(end).toHaveBeenCalledWith(
            expect.objectContaining({ mode: 'post-chain', passes: 2, programs: 8 })
        );
    });

    it('restores buffer parity and rethrows when a pass fails mid-chain', async () => {
        const { composer, renderer } = setup([{ name: 'a', needsSwap: true }, { name: 'b' }]);
        (composer.passes[1] as { render: () => void }).render = () => {
            throw new Error('link failed');
        };
        await expect(precompilePostChain({ renderer, composer })).rejects.toThrow('link failed');
        expect(composer.readBuffer).toEqual({ id: 'read' });
    });

    it('does nothing for a composer without passes (the WebGPU post stack)', async () => {
        const result = await precompilePostChain({ renderer: {}, composer: { render() {} } });
        expect(result).toMatchObject({ passes: 0, programs: 0 });
        expect(await precompilePostChain({ renderer: {}, composer: null })).toMatchObject({
            passes: 0,
        });
    });
});

describe('warmFirstRender', () => {
    const scene = { isScene: true } as never;

    function makeRenderer(programsPerRender = 4) {
        const programs: unknown[] = [];
        const log: string[] = [];
        return {
            log,
            renderer: {
                info: { programs },
                shadowMap: { enabled: true, needsUpdate: false },
                render: vi.fn(() => {
                    log.push('renderer.render');
                    for (let i = 0; i < programsPerRender; i++) programs.push({});
                }),
            },
        };
    }

    it("runs the composer's scene pass with the composer's buffers, not renderer.render", async () => {
        const { renderer, log } = makeRenderer();
        const read = { id: 'read' };
        const write = { id: 'write' };
        const render = vi.fn(function (_r: unknown, w: unknown, rd: unknown) {
            log.push(`scenePass(${(rd as { id: string }).id}->${(w as { id: string }).id})`);
        });
        const composer = {
            readBuffer: read,
            writeBuffer: write,
            passes: [{ scene: { isScene: true }, render }, { render: vi.fn() }],
        };
        const result = await warmFirstRender({ renderer, scene, camera, composer });
        expect(log).toEqual(['scenePass(read->write)']);
        expect(renderer.render).not.toHaveBeenCalled();
        expect(result.ran).toBe(true);
    });

    it('renders the scene straight to the canvas without a composer', async () => {
        const { renderer } = makeRenderer();
        await warmFirstRender({ renderer, scene, camera, composer: null });
        expect(renderer.render).toHaveBeenCalledWith(scene, camera);
    });

    it('re-arms the shadow update: the render consumed it and finalizing still changes the casters', async () => {
        const { renderer } = makeRenderer();
        await warmFirstRender({ renderer, scene, camera });
        expect(renderer.shadowMap.needsUpdate).toBe(true);
    });

    it('re-arms the shadow update even when the render throws, and rethrows', async () => {
        const { renderer } = makeRenderer();
        renderer.render.mockImplementation(() => {
            throw new Error('context lost');
        });
        await expect(warmFirstRender({ renderer, scene, camera })).rejects.toThrow('context lost');
        expect(renderer.shadowMap.needsUpdate).toBe(true);
    });

    it('leaves the shadow map alone where shadows are off', async () => {
        const { renderer } = makeRenderer();
        renderer.shadowMap.enabled = false;
        await warmFirstRender({ renderer, scene, camera });
        expect(renderer.shadowMap.needsUpdate).toBe(false);
    });

    it('gives the scheduler a frame first, and reports the programs the render linked', async () => {
        const { renderer } = makeRenderer(4);
        const order: string[] = [];
        const budget = { checkpoint: vi.fn(() => order.push('checkpoint')) };
        renderer.render.mockImplementation(() => order.push('render'));
        const end = vi.fn();
        const trace = { begin: vi.fn(() => end) };
        await warmFirstRender({
            renderer,
            scene,
            camera,
            budget: budget as never,
            trace: trace as never,
        });
        expect(order).toEqual(['checkpoint', 'render']);
        expect(trace.begin).toHaveBeenCalledWith('compile:first-render', 'compile');

        const second = makeRenderer(4);
        const result = await warmFirstRender({ renderer: second.renderer, scene, camera });
        expect(result.programs).toBe(4);
    });

    it('does nothing on WebGPU, which compiles its pipelines ahead of time', async () => {
        const render = vi.fn();
        const result = await warmFirstRender({
            renderer: { isWebGPURenderer: true, render },
            scene,
            camera,
        });
        expect(result).toMatchObject({ ran: false, programs: 0 });
        expect(render).not.toHaveBeenCalled();
    });
});

describe('readProgramCount', () => {
    it('reads renderer.info.programs and is null where there is none', () => {
        expect(readProgramCount({ info: { programs: [1, 2, 3] } })).toBe(3);
        expect(readProgramCount({ info: {} })).toBeNull();
        expect(readProgramCount({})).toBeNull();
    });
});
