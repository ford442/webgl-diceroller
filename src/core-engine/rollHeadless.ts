/**
 * Headless WASM roll: parse notation, instantiate the in-process engine in
 * Node (or any environment with `fetch` + WASM), step to settle, return
 * solver face values. No Three.js, no canvas, no DOM.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    DIE_TYPE_CATALOG,
    createDefaultDiceSet,
    createDefaultEntry,
    resolveFaceValue,
    type DiceSet,
    type DieShapeId,
} from './dice/DiceSetFormat.js';
import {
    DEFAULT_ROLL_SYSTEM,
    NotationError,
    buildSpawnSpecsForGroups,
    evaluateRoll,
    getExplodingRespawnSpecs,
    getRerollRespawnSpecs,
    parseNotation,
    type DieOutcome,
    type ParsedSide,
    type SpawnDieSpec,
} from './roll/Notation.js';
import type { EvaluatedRoll } from '../types/roll.js';
import {
    PHYSICS_GRAVITY,
    PHYSICS_TABLE_HALF,
    PHYSICS_TABLE_Y,
    THROW_TABLE_SURFACE_Y,
    getDieSides,
    presetForShape,
} from './wasm/physicsPresets.js';
import {
    applyThrowParams,
    computeSeededThrowParams,
    createSeededRng,
} from './wasm/seededThrowParams.js';
import { getSolverBuildId, loadSolverBuildId } from './wasm/SolverBuildId.js';
import { createInProcessPhysicsSession } from './wasm/WasmPhysicsBridge.js';
import type { PhysicsEngine } from './wasm/physicsTypes.js';
import { WASM_SCALAR_DIR, WASM_SIMD_DIR, type WasmArtifactDir } from './wasm/wasmArtifact.js';

const FIXED_DT = 1 / 120;
const DEFAULT_MAX_STEPS = 120 * 20; // 20s of sim
const IDLE_STEPS_REQUIRED = 8;

export interface HeadlessDieResult {
    type: string;
    naturalValue: number;
    value: number;
    wasmId: number;
    role: 'tens' | 'ones' | null;
    groupIndex: number;
    dieIndex: number;
}

export interface HeadlessRollTrace {
    seed: number;
    expression: string;
    steps: number;
    dt: number;
    solverBuildId: string | null;
    faceValues: number[];
    rounds: number;
}

export interface HeadlessRollResult {
    results: HeadlessDieResult[];
    total: number;
    evaluated: EvaluatedRoll;
    trace: HeadlessRollTrace;
}

export interface RollHeadlessOptions {
    /** Absolute path to the repo `public/` directory. */
    publicDir?: string;
    maxSteps?: number;
    dt?: number;
    system?: string;
    tableSurfaceY?: number;
    preferredDir?: WasmArtifactDir;
}

export function defaultPublicDir(fromUrl: string = import.meta.url): string {
    return path.resolve(path.dirname(fileURLToPath(fromUrl)), '../..', 'public');
}

export function wasmArtifactsPresent(
    publicDir: string = defaultPublicDir(),
    preferred: WasmArtifactDir = WASM_SIMD_DIR
): boolean {
    const dirs: WasmArtifactDir[] =
        preferred === WASM_SCALAR_DIR
            ? [WASM_SCALAR_DIR, WASM_SIMD_DIR]
            : [WASM_SIMD_DIR, WASM_SCALAR_DIR];
    return dirs.some((dir) => existsSync(path.join(publicDir, dir, 'dice_physics.wasm')));
}

export function createNodeAssetUrl(publicDir: string): (relativePath: string) => string {
    return (relativePath: string) => pathToFileURL(path.join(publicDir, relativePath)).href;
}

function catalogShape(type: string): DieShapeId {
    return DIE_TYPE_CATALOG[type]?.shape ?? 'd6';
}

function mapNatural(type: string, natural: number, diceSet: DiceSet): number {
    const entry = diceSet.dice[type] ?? createDefaultEntry(type);
    return resolveFaceValue(entry, natural);
}

function spawnSpecs(
    engine: PhysicsEngine,
    session: { loadHullForDie: (id: number, sides: number) => void },
    specs: SpawnDieSpec[],
    tableSurfaceY: number
): { wasmId: number; spec: SpawnDieSpec }[] {
    engine.clearAllDice();
    const spawned: { wasmId: number; spec: SpawnDieSpec }[] = [];
    specs.forEach((spec, index) => {
        const shape = catalogShape(spec.type);
        const sides = getDieSides(shape);
        const preset = presetForShape(shape);
        const y = tableSurfaceY + 5.75 + index * 0.5;
        const wasmId = engine.addDie(sides, 0, y, 0);
        engine.setDieMaterial(wasmId, preset.friction, preset.rollingFriction);
        engine.setDieDrag(wasmId, preset.dragFactor ?? 0);
        session.loadHullForDie(wasmId, sides);
        spawned.push({ wasmId, spec });
    });
    return spawned;
}

function readNatural(engine: PhysicsEngine, wasmId: number): number {
    if (typeof engine.getDieFaceValue === 'function') {
        return engine.getDieFaceValue(wasmId) | 0;
    }
    if (typeof engine.getFaceValues === 'function' && typeof engine.getDieIds === 'function') {
        const values = engine.getFaceValues();
        const ids = engine.getDieIds();
        for (let i = 0; i < ids.length; i++) {
            if (Math.round(ids[i] ?? 0) === wasmId) return (values[i] ?? 0) | 0;
        }
    }
    return 0;
}

function stepUntilSettled(
    engine: PhysicsEngine,
    dt: number,
    maxSteps: number
): { steps: number; settled: boolean } {
    let idle = 0;
    let steps = 0;
    while (steps < maxSteps) {
        engine.step(dt);
        steps += 1;
        if (engine.areAllSettled()) {
            idle += 1;
            if (idle >= IDLE_STEPS_REQUIRED) return { steps, settled: true };
        } else {
            idle = 0;
        }
    }
    return { steps, settled: false };
}

async function resolveSide(
    engine: PhysicsEngine,
    session: { loadHullForDie: (id: number, sides: number) => void },
    side: ParsedSide,
    seed: number,
    diceSet: DiceSet,
    tableSurfaceY: number,
    dt: number,
    maxSteps: number
): Promise<{ dice: DieOutcome[]; steps: number; faceValues: number[] }> {
    let specs: SpawnDieSpec[] = buildSpawnSpecsForGroups(side.groups);
    let subSeed = seed;
    let accumulatedDice: DieOutcome[] = [];
    let explosionRound = 0;
    const maxExplosionRounds = 20;
    let didRerollPass = false;
    let steps = 0;
    let lastFaceValues: number[] = [];

    while (true) {
        const spawned = spawnSpecs(engine, session, specs, tableSurfaceY);
        const throwDice = spawned.map((s, index) => ({ id: s.wasmId, index }));
        const params = computeSeededThrowParams(createSeededRng(subSeed), throwDice, tableSurfaceY);
        applyThrowParams(engine, params);
        subSeed = (subSeed + 1) >>> 0;

        const stepped = stepUntilSettled(engine, dt, maxSteps);
        steps += stepped.steps;
        if (!stepped.settled) {
            throw new NotationError(`Physics did not settle within ${maxSteps} steps (dt=${dt}).`);
        }

        const roundDice: DieOutcome[] = spawned.map(({ wasmId, spec }, i) => {
            const natural = readNatural(engine, wasmId);
            lastFaceValues = Array.from(engine.getFaceValues?.() ?? []);
            return {
                groupIndex: spec.groupIndex ?? 0,
                dieIndex: spec.dieIndex ?? i,
                type: spec.type,
                value: mapNatural(spec.type, natural, diceSet),
                role: spec.role ?? null,
                exploded: Boolean(spec.replacesDieIndex != null && !spec.isReroll),
                rerolled: Boolean(spec.isReroll),
            };
        });

        if (explosionRound === 0 && !didRerollPass) {
            accumulatedDice = roundDice;
        } else if (specs.some((s) => s.isReroll)) {
            roundDice.forEach((d, i) => {
                const slot = specs[i]?.dieIndex ?? d.dieIndex;
                accumulatedDice.forEach((prev) => {
                    if (
                        prev.groupIndex === d.groupIndex &&
                        prev.dieIndex === slot &&
                        !prev.exploded
                    ) {
                        prev.replacedByReroll = true;
                        prev.kept = false;
                        prev.dropped = true;
                        prev.originalValue = prev.value;
                    }
                });
                accumulatedDice.push({
                    ...d,
                    dieIndex: slot,
                    rerolled: true,
                    originalValue:
                        accumulatedDice.find(
                            (p) =>
                                p.groupIndex === d.groupIndex &&
                                p.dieIndex === slot &&
                                p.replacedByReroll
                        )?.originalValue ?? null,
                });
            });
            didRerollPass = true;
        } else {
            roundDice.forEach((d, i) => {
                const slot = specs[i]?.dieIndex ?? d.dieIndex;
                accumulatedDice.push({ ...d, dieIndex: slot, exploded: true });
            });
        }

        if (!didRerollPass && explosionRound === 0) {
            const rerollSpecs = getRerollRespawnSpecs(side, accumulatedDice);
            if (rerollSpecs.length) {
                specs = rerollSpecs;
                continue;
            }
            didRerollPass = true;
        }

        const explodeSpecs = getExplodingRespawnSpecs(side, roundDice);
        if (!explodeSpecs.length || explosionRound >= maxExplosionRounds) break;
        specs = explodeSpecs;
        explosionRound += 1;
    }

    return { dice: accumulatedDice, steps, faceValues: lastFaceValues };
}

export async function rollHeadless(
    expression: string,
    seed: number,
    diceSet: DiceSet | null = null,
    options: RollHeadlessOptions = {}
): Promise<HeadlessRollResult> {
    const publicDir = options.publicDir ?? defaultPublicDir();
    if (!wasmArtifactsPresent(publicDir, options.preferredDir ?? WASM_SIMD_DIR)) {
        throw new NotationError(
            `WASM artifacts missing under ${publicDir}. Run npm run build:wasm.`
        );
    }

    const assetUrl = createNodeAssetUrl(publicDir);
    const session = await createInProcessPhysicsSession({
        assetUrl,
        preferredDir: options.preferredDir,
        searchParams: new URLSearchParams(),
    });
    if (!session.available) {
        throw new NotationError('Failed to instantiate the WASM dice physics engine.');
    }

    const engine = session.engine;
    engine.init(PHYSICS_GRAVITY, PHYSICS_TABLE_Y, PHYSICS_TABLE_HALF, PHYSICS_TABLE_HALF);

    const parsed = parseNotation(expression);
    const set = diceSet ?? createDefaultDiceSet();
    const tableSurfaceY = options.tableSurfaceY ?? THROW_TABLE_SURFACE_Y;
    const dt = options.dt ?? FIXED_DT;
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const system = options.system ?? DEFAULT_ROLL_SYSTEM;

    const left = await resolveSide(
        engine,
        session,
        { groups: parsed.groups, modifier: parsed.modifier, raw: parsed.raw },
        seed >>> 0,
        set,
        tableSurfaceY,
        dt,
        maxSteps
    );

    let opposedDice: DieOutcome[] | undefined;
    let opposedSteps = 0;
    if (parsed.opposed) {
        const rightSeed = (seed + 0x9e3779b9) >>> 0;
        const right = await resolveSide(
            engine,
            session,
            parsed.opposed,
            rightSeed,
            set,
            tableSurfaceY,
            dt,
            maxSteps
        );
        opposedDice = right.dice;
        opposedSteps = right.steps;
    }

    let solverBuildId: string | null = getSolverBuildId();
    try {
        solverBuildId = await loadSolverBuildId();
    } catch {
        solverBuildId = solverBuildId ?? 'unknown';
    }

    const evaluated = evaluateRoll(parsed, left.dice, {
        opposedDice,
        seed: seed >>> 0,
        system,
    });

    const results: HeadlessDieResult[] = left.dice.map((d, i) => ({
        type: d.type,
        naturalValue: d.value ?? 0,
        value: d.value ?? 0,
        wasmId: i,
        role: d.role ?? null,
        groupIndex: d.groupIndex,
        dieIndex: d.dieIndex,
    }));

    return {
        results,
        total: evaluated.total,
        evaluated,
        trace: {
            seed: seed >>> 0,
            expression: parsed.raw,
            steps: left.steps + opposedSteps,
            dt,
            solverBuildId,
            faceValues: left.faceValues,
            rounds: 1,
        },
    };
}
