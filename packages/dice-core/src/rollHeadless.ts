/**
 * Headless WASM roll: parse notation, instantiate the in-process engine, step
 * to settle, return solver face values. No Three.js, no canvas, no DOM, and no
 * static `node:` import — in Node the assets default to `fsAssetSource`
 * (loaded lazily); a page passes `fetchAssetSource()`.
 */

import type { AssetSource } from './assets/AssetSource.js';
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
import type { EvaluatedRoll } from './types/roll.js';
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
import { readSolverBuildId } from './wasm/SolverBuildId.js';
import { createInProcessPhysicsSession } from './wasm/WasmPhysicsBridge.js';
import type { PhysicsEngine } from './wasm/physicsTypes.js';
import { applyWorld, type WorldFixture } from './wasm/WorldRecorder.js';
import { createSimDriver, FIXED_DT, type SimDriver } from './wasm/SimDriver.js';
import { fnv1a64Hex } from './wasm/stateHash.js';
import { WASM_SIMD_DIR, type WasmArtifactDir } from './wasm/wasmArtifact.js';

const DEFAULT_MAX_STEPS = 120 * 20; // 20s of sim
const IDLE_STEPS_REQUIRED = 8;

export interface HeadlessDieResult {
    type: string;
    /** The face the solver read (1..sides), before the dice set's face map. */
    naturalValue: number;
    /** `naturalValue` mapped through the dice set (custom faces, d10 0-9, …). */
    value: number;
    /** Engine body id the die settled as (ids keep growing across rounds). */
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
    /** Fixed 1/120 s engine ticks the whole roll took (both sides, every round). */
    fixedTicks: number;
    /** FNV-1a 64 of the engine's serialized state once the last die settled. */
    stateHash: string;
    solverBuildId: string | null;
    /** Solver faces of `results`, in the same order. */
    faceValues: number[];
    /** Solver faces of the opposed side, when the expression has one. */
    opposedFaceValues?: number[];
    /** Physics rounds thrown: initial throw plus reroll / explosion passes, both sides. */
    rounds: number;
}

export interface HeadlessRollResult {
    results: HeadlessDieResult[];
    total: number;
    evaluated: EvaluatedRoll;
    trace: HeadlessRollTrace;
}

export interface RollHeadlessOptions {
    /** Where the engine, hulls and build-info come from (default: `fsAssetSource(publicDir)`). */
    assets?: AssetSource;
    /** Node only, ignored when `assets` is given: the `public/` directory to read. */
    publicDir?: string;
    maxSteps?: number;
    dt?: number;
    system?: string;
    tableSurfaceY?: number;
    preferredDir?: WasmArtifactDir;
    /**
     * Disable the pipping centre-of-mass bias (the app's `?fair-dice`). Off by
     * default, so a headless roll matches the app's default table.
     */
    fairDice?: boolean;
    /** Pipping bias ratio (the app's `?bias-ratio=`); defaults to 0.0075. */
    massBiasRatio?: number;
    /**
     * A recorded collider world (packages/dice-core/fixtures/tavern-world.json, see
     * WorldRecorder) to roll into instead of the bare analytic table — its
     * own `init` replaces the default one.
     */
    world?: WorldFixture;
}

/** The URL flags an app page would carry for these options. */
function physicsSearchParams(options: RollHeadlessOptions): URLSearchParams {
    const params = new URLSearchParams();
    if (options.fairDice) params.set('fair-dice', '');
    if (options.massBiasRatio !== undefined) {
        params.set('bias-ratio', String(options.massBiasRatio));
    }
    return params;
}

interface SolvedDie {
    wasmId: number;
    natural: number;
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
    driver: SimDriver,
    engine: PhysicsEngine,
    dt: number,
    maxSteps: number
): { steps: number; settled: boolean } {
    let idle = 0;
    let steps = 0;
    while (steps < maxSteps) {
        // One exact fixed tick per step; `dt` other than FIXED_DT is a test
        // knob that hands the engine that much wall time instead.
        if (dt === FIXED_DT) driver.stepN(1);
        else driver.advance(dt);
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
    driver: SimDriver,
    engine: PhysicsEngine,
    session: { loadHullForDie: (id: number, sides: number) => void },
    side: ParsedSide,
    seed: number,
    diceSet: DiceSet,
    tableSurfaceY: number,
    dt: number,
    maxSteps: number
): Promise<{ dice: DieOutcome[]; solved: SolvedDie[]; steps: number; rounds: number }> {
    let specs: SpawnDieSpec[] = buildSpawnSpecsForGroups(side.groups);
    let subSeed = seed;
    let accumulatedDice: DieOutcome[] = [];
    let explosionRound = 0;
    const maxExplosionRounds = 20;
    let didRerollPass = false;
    // Not `explosionRound === 0 && !didRerollPass`: the reroll round matches
    // that too (see RollSession), which replaced the pool with the rerolls.
    let firstRound = true;
    let steps = 0;
    let rounds = 0;
    // Parallel to accumulatedDice: which body each outcome came from and the
    // face the solver read, before the dice set's face map.
    let solved: SolvedDie[] = [];

    while (true) {
        const spawned = spawnSpecs(engine, session, specs, tableSurfaceY);
        const throwDice = spawned.map((s, index) => ({ id: s.wasmId, index }));
        const params = computeSeededThrowParams(createSeededRng(subSeed), throwDice, tableSurfaceY);
        applyThrowParams(engine, params);
        subSeed = (subSeed + 1) >>> 0;

        const stepped = stepUntilSettled(driver, engine, dt, maxSteps);
        steps += stepped.steps;
        rounds += 1;
        if (!stepped.settled) {
            throw new NotationError(`Physics did not settle within ${maxSteps} steps (dt=${dt}).`);
        }

        const roundSolved: SolvedDie[] = spawned.map(({ wasmId }) => ({
            wasmId,
            natural: readNatural(engine, wasmId),
        }));
        const roundDice: DieOutcome[] = spawned.map(({ spec }, i) => {
            const natural = roundSolved[i]!.natural;
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

        if (firstRound) {
            accumulatedDice = roundDice;
            solved = roundSolved;
            firstRound = false;
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
                solved.push(roundSolved[i]!);
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
                solved.push(roundSolved[i]!);
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

    return { dice: accumulatedDice, solved, steps, rounds };
}

export async function rollHeadless(
    expression: string,
    seed: number,
    diceSet: DiceSet | null = null,
    options: RollHeadlessOptions = {}
): Promise<HeadlessRollResult> {
    const assets =
        options.assets ??
        (await import('./assets/fsAssetSource.js')).fsAssetSource(options.publicDir);
    let session: Awaited<ReturnType<typeof createInProcessPhysicsSession>>;
    try {
        session = await createInProcessPhysicsSession({
            assets,
            preferredDir: options.preferredDir,
            searchParams: physicsSearchParams(options),
            // A missing engine or hull table is an error here, never the JS
            // stub or a bounding sphere: a sphere is not an acceptable d20.
            strict: true,
            quiet: true,
        });
    } catch (err) {
        throw new NotationError(
            `WASM dice physics unavailable from ${assets.label} (run npm run build:wasm): ${
                (err as Error).message
            }`
        );
    }

    const engine = session.engine;
    const worldInit = options.world?.init;
    if (worldInit) {
        engine.init(
            worldInit.gravity,
            worldInit.tableY,
            worldInit.tableHalfW,
            worldInit.tableHalfD
        );
    } else {
        engine.init(PHYSICS_GRAVITY, PHYSICS_TABLE_Y, PHYSICS_TABLE_HALF, PHYSICS_TABLE_HALF);
    }
    if (options.world) applyWorld(engine, options.world);

    const parsed = parseNotation(expression);
    const set = diceSet ?? createDefaultDiceSet();
    const tableSurfaceY = options.tableSurfaceY ?? THROW_TABLE_SURFACE_Y;
    const dt = options.dt ?? FIXED_DT;
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const system = options.system ?? DEFAULT_ROLL_SYSTEM;

    const driver = createSimDriver(engine);
    const left = await resolveSide(
        driver,
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
    let opposedSolved: SolvedDie[] | undefined;
    let opposedSteps = 0;
    let opposedRounds = 0;
    if (parsed.opposed) {
        const rightSeed = (seed + 0x9e3779b9) >>> 0;
        const right = await resolveSide(
            driver,
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
        opposedSolved = right.solved;
        opposedSteps = right.steps;
        opposedRounds = right.rounds;
    }

    const stateHash = fnv1a64Hex(engine.serializeState());

    // build-info.json of the artifact this session actually loaded.
    const solverBuildId = await readSolverBuildId(assets, session.dir ?? WASM_SIMD_DIR);

    const evaluated = evaluateRoll(parsed, left.dice, {
        opposedDice,
        seed: seed >>> 0,
        system,
    });

    const results: HeadlessDieResult[] = left.dice.map((d, i) => ({
        type: d.type,
        naturalValue: left.solved[i]?.natural ?? 0,
        value: d.value ?? 0,
        wasmId: left.solved[i]?.wasmId ?? -1,
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
            fixedTicks: driver.stepIndex,
            stateHash,
            solverBuildId,
            faceValues: left.solved.map((d) => d.natural),
            ...(opposedSolved ? { opposedFaceValues: opposedSolved.map((d) => d.natural) } : {}),
            rounds: left.rounds + opposedRounds,
        },
    };
}
