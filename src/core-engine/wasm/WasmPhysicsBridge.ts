/**
 * In-process (main-thread / Node) WASM physics bridge.
 *
 * Async loader for the Emscripten-compiled dice physics WASM module.
 * When artifacts are missing the bridge substitutes a no-op stub.
 */

import { publicAssetUrl } from '../publicAssetUrl.js';
import { parseCollisionEventBuffer } from './collisionEvents.js';
import { applyFaceTableForDie } from './faceTableLoader.js';
import type { HullTable } from './hullTypes.js';
import { parsePhysicsFlags } from './physicsFlags.js';
import { toRngSeedBigInt } from './seedUtil.js';
import type {
    CollisionEvent,
    DicePhysicsModule,
    EmbindPhysicsEngine,
    PhysicsEngine,
} from './physicsTypes.js';
import type { SeededDieRef } from './seededThrowParams.js';
import type { SeededHopperFrame } from './seededHopperDrop.js';
import {
    instantiateDicePhysicsModule,
    WASM_SCALAR_DIR,
    getPhysicsSearchParams,
    type InstantiateDicePhysicsOptions,
} from './wasmArtifact.js';

const STUB_ENGINE = {
    setFlags: () => {},
    init: () => {},
    reset: () => {},
    step: () => {},
    addDie: () => -1,
    removeDie: () => {},
    clearAllDice: () => {},
    setDieMaterial: () => {},
    setDieDrag: () => {},
    setDieHull: () => {},
    setDieFaceTable: () => {},
    getDieFaceValue: () => 0,
    getFaceValues: () => new Int32Array(0),
    applyImpulse: () => {},
    applyTorqueImpulse: () => {},
    setDieTransform: () => {},
    setDieVelocity: () => {},
    setDieKinematic: () => {},
    setContainerActive: () => {},
    setContainerPlanes: () => {},
    clearStatics: () => {},
    removeStatic: () => false,
    addStaticBox: () => -1,
    addStaticPlane: () => -1,
    addStaticConvexHull: () => -1,
    addStaticOpenCylinder: () => -1,
    clearDynamics: () => {},
    removeDynamic: () => false,
    setDynamicKinematic: () => {},
    setDynamicTransform: () => {},
    setDynamicVelocity: () => {},
    applyDynamicImpulse: () => {},
    applyDynamicTorqueImpulse: () => {},
    addDynamicBox: () => -1,
    addDynamicHull: () => -1,
    getDynamicCount: () => 0,
    getDynamicCapacityDroppedCount: () => 0,
    getDynamicTransforms: () => new Float32Array(0),
    getDynamicIds: () => new Float32Array(0),
    getTransforms: () => new Float32Array(0),
    getDieIds: () => new Float32Array(0),
    getDieCount: () => 0,
    areAllSettled: () => true,
    getLastStepStats: () => ({
        pairCandidates: 0,
        sphereTests: 0,
        satTests: 0,
        contacts: 0,
    }),
    seedRNG: () => {},
    randomFloat: () => 0.5,
    getCollisionEvents: () => new Float32Array(0),
    serializeState: () => new Uint8Array(0),
    deserializeState: () => {},
} satisfies PhysicsEngine;

/**
 * Embind binds `const std::vector<float>&` as a `VectorFloat` handle, which does
 * *not* accept a plain JS array. Wrap hull entry points so callers can pass
 * plain arrays (same contract as the worker).
 */
function adaptFlatVertexMethods(engine: EmbindPhysicsEngine, Module: DicePhysicsModule): void {
    const mutable = engine as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of ['addStaticConvexHull', 'addDynamicHull'] as const) {
        const candidate = mutable[method];
        if (typeof candidate !== 'function') continue;
        const original = candidate.bind(engine);

        mutable[method] = (...args: unknown[]) => {
            const index = args.findIndex((arg) => Array.isArray(arg));
            if (index < 0) return original(...args);

            const vec = new Module.VectorFloat();
            try {
                for (const value of args[index] as number[]) vec.push_back(value);
                args[index] = vec;
                return original(...args);
            } finally {
                vec.delete?.();
            }
        };
    }
}

function wrapEngine(raw: EmbindPhysicsEngine, Module: DicePhysicsModule): PhysicsEngine {
    adaptFlatVertexMethods(raw, Module);
    const engine = raw as unknown as PhysicsEngine;
    const originalPlanes = raw.setContainerPlanes.bind(raw);
    engine.setContainerPlanes = (planes: Float32Array | number[]) => {
        const flat = planes instanceof Float32Array ? planes : Float32Array.from(planes);
        const vec = new Module.VectorFloat();
        for (let i = 0; i < flat.length; i++) vec.push_back(flat[i] ?? 0);
        originalPlanes(vec);
        vec.delete?.();
    };
    const originalSerialize = raw.serializeState.bind(raw);
    engine.serializeState = () => {
        const vec = originalSerialize();
        const arr = new Uint8Array(vec.size());
        for (let i = 0; i < vec.size(); i++) arr[i] = vec.get(i) ?? 0;
        vec.delete?.();
        return arr;
    };
    const originalDeserialize = raw.deserializeState.bind(raw);
    engine.deserializeState = (data: unknown) => {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(0);
        const vec = new Module.VectorU8();
        for (let i = 0; i < bytes.length; i++) vec.push_back(bytes[i] ?? 0);
        originalDeserialize(vec);
        vec.delete?.();
    };
    const originalSeedRNG = raw.seedRNG.bind(raw);
    engine.seedRNG = (seed: number) => {
        originalSeedRNG(toRngSeedBigInt(seed));
    };
    return engine;
}

export interface LoadHullsOptions {
    assetUrl?: (relativePath: string) => string;
}

export async function loadHullTable(options: LoadHullsOptions = {}): Promise<HullTable | null> {
    const assetUrl = options.assetUrl ?? publicAssetUrl;
    try {
        const res = await fetch(assetUrl('wasm/hulls.json'));
        if (res.ok) return (await res.json()) as HullTable;
    } catch (e) {
        console.warn('[WasmPhysics] Could not load hulls.json:', e);
    }
    return null;
}

export function applyHullToDie(
    engine: PhysicsEngine,
    moduleClass: DicePhysicsModule,
    hulls: HullTable | null,
    wasmId: number,
    sides: number
): void {
    if (!hulls || !moduleClass) return;
    const type = 'd' + sides;
    const data = hulls[type];
    if (!data?.vertices) return;
    const flat = new moduleClass.VectorFloat();
    for (let i = 0; i < data.vertices.length; i++) {
        const v = data.vertices[i];
        if (!v) continue;
        flat.push_back(v[0] ?? 0);
        flat.push_back(v[1] ?? 0);
        flat.push_back(v[2] ?? 0);
    }
    engine.setDieHull(wasmId, flat);
    applyFaceTableForDie(engine, moduleClass, wasmId, data);
}

export interface InProcessPhysicsSession {
    engine: PhysicsEngine;
    moduleClass: DicePhysicsModule | null;
    hulls: HullTable | null;
    available: boolean;
    loadHullForDie(wasmId: number, sides: number): void;
    dispose(): void;
}

export interface CreateInProcessPhysicsSessionOptions extends InstantiateDicePhysicsOptions {
    /** Force the no-op stub (same as `?no-wasm`). */
    noWasm?: boolean;
    loadHulls?: () => Promise<HullTable | null>;
}

export async function createInProcessPhysicsSession(
    options: CreateInProcessPhysicsSessionOptions = {}
): Promise<InProcessPhysicsSession> {
    const searchParams = getPhysicsSearchParams(options.searchParams);
    const noWasm = options.noWasm === true || searchParams.has('no-wasm');

    const dispose = (): void => {};

    if (noWasm) {
        return {
            engine: STUB_ENGINE,
            moduleClass: null,
            hulls: null,
            available: false,
            loadHullForDie: () => {},
            dispose,
        };
    }

    try {
        const { Module, dir } = await instantiateDicePhysicsModule(options);
        const raw = new Module.DicePhysicsEngine();
        const engine = wrapEngine(raw, Module);
        engine.setFlags(parsePhysicsFlags(searchParams));
        const hulls = options.loadHulls
            ? await options.loadHulls()
            : await loadHullTable({ assetUrl: options.assetUrl });
        const simdLabel = dir === WASM_SCALAR_DIR ? 'scalar' : 'SIMD';
        console.log(`[WasmPhysics] WASM dice physics engine loaded (${simdLabel} artifact).`);
        return {
            engine,
            moduleClass: Module,
            hulls,
            available: true,
            loadHullForDie: (wasmId, sides) => applyHullToDie(engine, Module, hulls, wasmId, sides),
            dispose,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const hint = message.includes('fetch')
            ? 'WASM binary not found. Run `npm run build:wasm` to compile the C++ module.'
            : message;
        console.warn(`[WasmPhysics] WASM module unavailable — using JS stub. (${hint})`);
        return {
            engine: STUB_ENGINE,
            moduleClass: null,
            hulls: null,
            available: false,
            loadHullForDie: () => {},
            dispose,
        };
    }
}

let _session: InProcessPhysicsSession | null = null;
let _initialized = false;

export const loadWasmEngine = async (
    options: CreateInProcessPhysicsSessionOptions = {}
): Promise<boolean> => {
    if (_initialized) return _session?.available === true;
    _session = await createInProcessPhysicsSession(options);
    _initialized = true;
    return _session.available;
};

export const isWasmAvailable = (): boolean => _initialized && _session?.available === true;
export const isWasmInitialized = (): boolean => _initialized;

export const getWasmEngine = (): PhysicsEngine => {
    if (!_initialized || !_session) {
        throw new Error('[WasmPhysics] Engine not initialized. Await loadWasmEngine() first.');
    }
    return _session.engine;
};

export const loadHullForDie = (wasmId: number, sides: number): void => {
    _session?.loadHullForDie(wasmId, sides);
};

export const pollCollisionEvents = (): CollisionEvent[] => {
    if (!_session?.available) return [];
    return parseCollisionEventBuffer(_session.engine.getCollisionEvents());
};

export const seedPhysicsRNG = (seed: number): void => {
    if (!_session?.available) return;
    _session.engine.seedRNG(seed);
};

export const randomPhysicsFloat = (): number => {
    if (!_session?.available) return Math.random();
    return _session.engine.randomFloat();
};

export const serializePhysicsState = async (): Promise<Uint8Array> => {
    if (!_session?.available) return new Uint8Array(0);
    return _session.engine.serializeState();
};

/** No-op in the in-process bridge — throws are applied directly via the engine. */
export const seededPhysicsThrow = (
    _seed?: number,
    _dice?: SeededDieRef[],
    _tableSurfaceY?: number
): void => {};

/** No-op in the in-process bridge — drops are applied directly via the engine. */
export const seededPhysicsHopperDrop = (
    _seed?: number,
    _dice?: SeededDieRef[],
    _frame?: SeededHopperFrame
): void => {};

export const deserializePhysicsState = (data: Uint8Array): void => {
    if (!_session?.available) return;
    _session.engine.deserializeState(data);
};

export const setContainerActive = (active: boolean): void => {
    if (!_session?.available) return;
    _session.engine.setContainerActive(!!active);
};

export const setContainerPlanes = (planes: Float32Array | number[]): void => {
    if (!_session?.available) return;
    _session.engine.setContainerPlanes(planes);
};

export const getPhysicsStepStats = () => {
    if (!_session?.available || typeof _session.engine.getLastStepStats !== 'function') return null;
    return _session.engine.getLastStepStats();
};
