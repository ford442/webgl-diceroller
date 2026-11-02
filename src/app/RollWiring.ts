/**
 * Roll orchestration: local rolls, notation rolls, replay, and the remote-roll
 * side of multiplayer. Owns `pendingRollMeta` / `activeRollSystem`, which used
 * to be plain `let`s in main.js — every read/write of them lived in the
 * functions that moved here, so they're private state now.
 */

import {
    throwDice,
    updateDiceSet,
    getSpawnedDiceCounts,
    getActiveDiceSet,
    spawnedDice,
    whenDiceRegistered,
    diceSettleProbe,
    readDiceValueAllowingCocked,
} from '../dice.js';
import { createSettleWatch } from 'dice-core/roll/SettleWatch';
import type { ThrowDiceOptions } from '../dice/DiceThrow.js';
import { diceIdsForSlots, slotsForDiceIds } from '../dice/DiceThrowSelection.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { DiceFocusState } from '../core/CameraController.js';
import { showResults, hideResults, showNotationResults } from '../results.js';
import { AppEvent } from '../core/AppEvents.js';
import { createRollSession, shouldDeferAutoResults } from 'dice-core/roll/RollSession';
import {
    ROLL_SYSTEMS,
    DEFAULT_ROLL_SYSTEM,
    applyExpressionChip,
    defaultExpressionForSystem,
} from 'dice-core/roll/Notation';
import {
    REPLAY_VERSION,
    SUPPORTED_REPLAY_VERSIONS,
    buildShareableRollUrl,
    generateRollSeed,
    parseShareableRollParams,
} from 'dice-core/roll/ShareableRoll';
import { createCommit, generateNonce, verifyReveal } from 'dice-core/net/CommitReveal';
import { showTableMismatchBadge } from '../ui/TableMismatchBadge.js';
import type { AppContext, AppEvents, PendingRollMeta } from '../types/app';
import type { DiceReadValue } from '../types/dice.js';
import type { EvaluatedRoll } from 'dice-core/types/roll';
import type { RollHistory } from 'dice-core/roll/RollHistory';
import type { RollStats } from 'dice-core/roll/RollStats';
import type {
    RemoteCommitMessage,
    RemoteRevealMessage,
    RemoteRollMessage,
    RemoteTableSyncMessage,
    RoomSession,
} from '../net/RoomSession.js';

const FAIR_COMMIT_ACK_MS = 300;

interface ShadowControllerLike {
    pulse: (kind: string) => void;
}

interface DiceGameFeelLike {
    clearRollState: () => void;
    onResultsReady: (results: unknown) => void;
    handleCollisionEvent: (ev: unknown) => void;
    onNotationResult?: (result: EvaluatedRoll) => void;
}

interface CameraControllerLike {
    setState: (state: string) => void;
}

interface LampDataLike {
    setRolling: (rolling: boolean) => void;
}

interface UiLike {
    updateCounts?: (counts: Record<string, number>) => void;
}

interface FairnessMonitorLike {
    render: () => void;
}

interface RollHistoryPanelLike {
    refresh: () => void;
}

interface DiceTowerControllerLike {
    dropDice: (
        idsOrAll: 'all' | number[],
        options?: { seed?: number | null }
    ) => Promise<number[]> | number[];
}

/** What the roll wiring needs from the jail to keep the dice a throw leaves out still. */
interface DiceJailControllerLike {
    hold: (idsOrNearby: 'nearby' | number[]) => number;
}

interface CollisionAudioLike {
    handleCollisionEvent: (ev: unknown) => void;
    checkCollisionPropReactions?: (ev: unknown) => void;
}

export interface RollWiringDeps {
    appEvents: AppEvents;
    getScene: () => unknown;
    getPhysicsWorld: () => unknown;
    getShadowController: () => ShadowControllerLike | null | undefined;
    getDiceGameFeel: () => DiceGameFeelLike | null | undefined;
    getCameraController: () => CameraControllerLike | null | undefined;
    getLampData: () => LampDataLike | null | undefined;
    getUi: () => UiLike | null | undefined;
    rollHistory?: RollHistory | null;
    rollStats?: RollStats | null;
    getFairnessMonitor: () => FairnessMonitorLike | null | undefined;
    getRollHistoryPanel: () => RollHistoryPanelLike | null | undefined;
    getCollisionAudio: () => CollisionAudioLike | null | undefined;
    multiplayerRef: { current: RoomSession | null };
    useFairCommit?: boolean;
    /**
     * Replaying a `?src=tower` link needs the tower itself — it lives on a
     * tier that loads well after the wiring is built, so this is a getter and
     * may legitimately return null (tower not loaded → nothing to replay).
     */
    getDiceTowerController?: () => DiceTowerControllerLike | null | undefined;
    /**
     * A partial throw replayed from a link or a message must not be disturbed
     * by the dice it leaves out, so those are parked in the jail first. Like the
     * tower, it loads on a later tier: a getter that may return null.
     */
    getDiceJailController?: () => DiceJailControllerLike | null | undefined;
    /**
     * A game that owns the table claims every "throw everything" press (R, Roll
     * All, the results re-roll): returning true means it handled the press and
     * `roll` must not throw the free dice behind its back.
     */
    interceptRoll?: () => boolean;
    /**
     * The table layout the roll landed on. Its seed rides the share URL: the
     * clutter scattered around the dice zone is part of the collider world, so
     * a replay on a different layout is a different simulation.
     */
    getTableLayoutConfig?: () => { seed: number; density?: string; theme?: string } | null;
    /**
     * Hash of the collider world this page built (`hashWorld`), or null without
     * WASM. Written into share links as `w=` and compared with an incoming
     * link's, so a replay never runs on a table that differs from the sender's.
     */
    getWorldHash?: () => string | null;
}

interface LastRollRef {
    seed: number | null;
    counts: Record<string, number>;
    source?: string;
    expression?: string | null;
    system?: string;
    /** Table slots a partial throw moved; absent / null = every die. */
    ids?: number[] | null;
}

interface RollOptions {
    /** Table slots to throw (a replayed partial throw); absent = every free die. */
    slots?: readonly number[] | null;
}

interface RollHandlerRef {
    roll:
        | ((explicitSeed?: number | null, options?: RollOptions) => Promise<number | undefined>)
        | null;
    lastRoll: LastRollRef | null;
}

/** How a game's throw ended, read back for the dice it asked to throw. */
export interface SubsetThrowOutcome {
    /** Faces, index-aligned with the ids asked for; null when a die could not be read. */
    values: Array<number | null>;
    /** Asked-for ids whose die never lay flat (only a timed-out roll can leave one). */
    cocked: number[];
    timedOut: boolean;
    reason: string | null;
    /** Another roll started before this one settled; `values` are not this throw's. */
    superseded: boolean;
}

interface NotationRollOptions {
    system?: string;
}

export function createRollWiring(app: AppContext, deps: RollWiringDeps) {
    const {
        appEvents,
        getScene,
        getPhysicsWorld,
        getShadowController,
        getDiceGameFeel,
        getCameraController,
        getLampData,
        getUi,
        rollHistory,
        rollStats,
        getFairnessMonitor,
        getRollHistoryPanel,
        multiplayerRef,
        useFairCommit = false,
    } = deps;

    let pendingRollMeta: PendingRollMeta = { seed: null, expression: null, diceSet: {} };
    let activeRollSystem = DEFAULT_ROLL_SYSTEM;

    const rollSessionRef: { current: ReturnType<typeof createRollSession> | null } = {
        current: null,
    };
    const rollHandlerRef: RollHandlerRef = { roll: null, lastRoll: null };

    let pendingFairCommit: { hash: string; notation?: string | null } | null = null;

    function captureDiceSet(): Record<string, number> {
        const diceSet: Record<string, number> = {};
        spawnedDice.forEach((die: { type: string }) => {
            diceSet[die.type] = (diceSet[die.type] ?? 0) + 1;
        });
        return diceSet;
    }

    function beginPhysicalReroll(source: string): void {
        pendingRollMeta = {
            seed: null,
            expression: null,
            diceSet: captureDiceSet(),
            source,
        };
        rollHandlerRef.lastRoll = {
            seed: null,
            counts: getSpawnedDiceCounts(),
            source,
        };
        const shadowController = getShadowController();
        shadowController?.pulse('roll');
        getDiceGameFeel()?.clearRollState();
        getCameraController()?.setState(DiceFocusState.WAITING_FOR_STOP);
        hideResults();
        const lampData = getLampData();
        if (lampData) lampData.setRolling(true);
        emitRollStarted({ source });
    }

    /**
     * A cup pour is deliberately unseeded: it is driven by where the player
     * physically waves the cup, which no seed can reproduce. Pours stay local
     * (`seed == null`) and never reach a share URL.
     */
    function beginCupRoll(): void {
        beginPhysicalReroll('cup');
    }

    /**
     * A tower drop, unlike a cup pour, *is* a roll: every pose and kick comes
     * from the engine PRNG, so it seeds like a throw and rides the share URL
     * as `?src=tower`. Returns the seed the drop must draw from — minting one
     * when the caller has none (replays pass theirs in).
     */
    async function beginTowerRoll(explicitSeed: number | null = null): Promise<number> {
        const seed = (explicitSeed ?? generateRollSeed()) >>> 0;
        const diceSet = captureDiceSet();
        pendingRollMeta = {
            seed,
            expression: null,
            diceSet,
            source: 'tower',
        };
        rollHandlerRef.lastRoll = {
            seed,
            counts: getSpawnedDiceCounts(),
            source: 'tower',
            expression: null,
            system: activeRollSystem,
        };
        const shadowController = getShadowController();
        shadowController?.pulse('roll');
        getDiceGameFeel()?.clearRollState();
        getCameraController()?.setState(DiceFocusState.WAITING_FOR_STOP);
        hideResults();
        const lampData = getLampData();
        if (lampData) lampData.setRolling(true);
        // Awaited, exactly as the throw and notation paths do it. Firing the
        // commit off and dropping immediately would hand a host the outcome
        // during the ack window, leaving it free to withhold the reveal and
        // re-roll — which is the abort the commit-reveal scheme exists to
        // prevent. Costs nothing off the fair-commit path or on a guest,
        // where broadcastFairCommit returns straight away.
        await broadcastFairCommit(seed, null, diceSet, 'tower');
        if (!useFairCommit) {
            emitRollStarted({ source: 'tower', seed });
        }
        return seed;
    }

    /**
     * A game's throw: move exactly `ids` (physics ids) with `seed`, and resolve
     * with what *this* throw landed once its own `ROLL_SETTLED` arrives.
     *
     * It is a seeded roll like a tower drop — the seed reaches the share URL
     * with the slots it moved, so a link reproduces the partial throw — but it
     * is deliberately not a notation roll and not a fair-commit one: a game's
     * seed comes from the game's own RNG, and Farkle has nothing hidden to
     * commit to. The generic results overlay stays out of it (see the settled
     * subscriber); the game panel reports the faces.
     */
    function throwSubset(ids: readonly number[], seed: number): Promise<SubsetThrowOutcome> {
        const slots = slotsForDiceIds(spawnedDice, ids);
        if (!slots.length) {
            return Promise.resolve({
                values: ids.map(() => null),
                cocked: [],
                timedOut: false,
                reason: null,
                superseded: false,
            });
        }
        const seed32 = seed >>> 0;
        pendingRollMeta = {
            seed: seed32,
            expression: null,
            diceSet: captureDiceSet(),
            source: 'game',
            slots,
        };
        rollHandlerRef.lastRoll = {
            seed: seed32,
            counts: getSpawnedDiceCounts(),
            system: activeRollSystem,
            ids: slots,
        };
        getShadowController()?.pulse('roll');
        getDiceGameFeel()?.clearRollState();
        hideResults();
        const lampData = getLampData();
        if (lampData) lampData.setRolling(true);

        // Listen before the dice move: nothing between here and the settle can
        // be missed, and the settle that arrives is the one for this throw.
        let started = rollState.startedCount;
        const settled = new Promise<SubsetThrowOutcome>((resolve) => {
            const off = appEvents.on(AppEvent.ROLL_SETTLED, (payload) => {
                off();
                const done = payload as
                    | {
                          results?: Array<{ value: number | null; cocked?: boolean }>;
                          timedOut?: boolean;
                          reason?: string | null;
                      }
                    | undefined;
                const rows = done?.results ?? [];
                const values = ids.map((id) => {
                    const slot = slotsForDiceIds(spawnedDice, [id])[0];
                    return slot === undefined ? null : (rows[slot]?.value ?? null);
                });
                const cocked = ids.filter((id, i) => {
                    const slot = slotsForDiceIds(spawnedDice, [id])[0];
                    return slot === undefined || values[i] === null || rows[slot]?.cocked === true;
                });
                resolve({
                    values,
                    cocked,
                    timedOut: done?.timedOut === true,
                    reason: done?.reason ?? null,
                    // ROLL_STARTED bumped the count once for us; any more is another roll.
                    superseded: rollState.startedCount !== started,
                });
            });
        });

        throwDice(getScene(), getPhysicsWorld(), seed32, { ids });
        getCameraController()?.setState(DiceFocusState.WAITING_FOR_STOP);
        emitRollStarted({ source: 'game', seed: seed32 });
        started = rollState.startedCount;
        return settled;
    }

    async function broadcastFairCommit(
        seed: number,
        expression: string | null,
        diceSet: Record<string, number>,
        source: string
    ): Promise<void> {
        if (!useFairCommit || !multiplayerRef.current?.isHost?.()) return;
        const nonce = generateNonce();
        const dieCount = Object.values(diceSet).reduce((sum, n) => sum + (Number(n) || 0), 0);
        const commit = await createCommit(seed, nonce, {
            notation: expression,
            dieCount,
            diceCounts: diceSet,
            throwAt: performance.now(),
            // Bound into the hash: a seed alone does not pin the trajectory,
            // so without this a host could publish the commitment, collect
            // acks, and only then decide between a throw and a tower drop.
            source,
        });
        emitRollStarted({ source, seed, expression, diceSet, commit });
        await new Promise((resolve) => setTimeout(resolve, FAIR_COMMIT_ACK_MS));
        emitRollStarted({
            source,
            seed,
            expression,
            diceSet,
            reveal: {
                seed,
                nonce,
                notation: expression,
                throwAt: performance.now(),
                source,
            },
        });
    }

    function beginRoll(
        seed: number | null = null,
        expression: string | null = null,
        meta: Record<string, unknown> = {},
        throwOptions: ThrowDiceOptions = {}
    ): void {
        const slots = throwOptions.ids?.length
            ? slotsForDiceIds(spawnedDice, throwOptions.ids)
            : null;
        pendingRollMeta = {
            seed: seed ?? null,
            expression: expression ?? null,
            diceSet: captureDiceSet(),
            ...(slots ? { slots } : {}),
            ...meta,
        };
        const shadowController = getShadowController();
        shadowController?.pulse('roll');
        getDiceGameFeel()?.clearRollState();
        throwDice(getScene(), getPhysicsWorld(), seed, throwOptions);
        getCameraController()?.setState(DiceFocusState.WAITING_FOR_STOP);
        hideResults();
        const lampData = getLampData();
        if (lampData) lampData.setRolling(true);
        emitRollStarted();
    }

    function emitRollStarted(extra: Record<string, unknown> = {}): void {
        appEvents.emit(AppEvent.ROLL_STARTED, {
            seed: pendingRollMeta.seed,
            expression: pendingRollMeta.expression,
            diceSet: pendingRollMeta.diceSet,
            source: pendingRollMeta.source,
            ...(pendingRollMeta.slots ? { ids: pendingRollMeta.slots } : {}),
            ...extra,
        });
    }

    /**
     * A partial throw replayed from elsewhere (a share link, a room message) is
     * only reproducible if the dice it leaves out cannot interfere, and a freshly
     * spawned die sits wherever the spawn put it. Parking them in the jail makes
     * them kinematic and out of the dice zone, so the same seed over the same
     * slots lands the same faces every time. (A live game never needs this:
     * the dice it does not throw are already held there.)
     */
    function parkUnthrown(thrownIds: readonly number[]): void {
        const thrown = new Set(thrownIds);
        const rest = spawnedDice
            .filter((die: { wasmId?: number | null; kinematic?: boolean }) => {
                return die.wasmId != null && !thrown.has(die.wasmId) && !die.kinematic;
            })
            .map((die: { wasmId?: number | null }) => die.wasmId as number);
        if (!rest.length) return;
        const jail = deps.getDiceJailController?.();
        if (!jail) {
            console.warn(
                '[Roll] partial throw replayed without the dice jail loaded; the dice it ' +
                    'leaves out stay on the table and may disturb the throw.'
            );
            return;
        }
        jail.hold(rest);
    }

    function handleResultsReady(results: DiceReadValue[]): void {
        // A partial throw moved only some dice; history and fairness stats must
        // not count the ones it left alone (held in the jail) a second time.
        const moved = pendingRollMeta.slots;
        const thrown = moved ? results.filter((_, slot) => moved.includes(slot)) : results;
        // RollHistory/RollStats model settled dice as `{ type, value: number }`;
        // `value` is only ever null mid-roll, never once results are ready.
        const settled = thrown as unknown as Array<{ type: string; value: number }>;
        rollHistory?.appendRoll(settled, pendingRollMeta);
        rollStats?.recordResults(settled);
        getFairnessMonitor()?.render();
        getRollHistoryPanel()?.refresh();
        getDiceGameFeel()?.onResultsReady(thrown);
        multiplayerRef.current?.recordSettledResults?.(thrown);
        pendingRollMeta = { seed: null, expression: null, diceSet: {} };
    }

    /**
     * Observable roll lifecycle for automation (`__app.getRollState()`):
     * `phase` is `idle → rolling → settled | timedOut`, and `settledCount`
     * counts finished throws, so a harness can wait for *this* roll rather
     * than reading `areDiceSettled()` off a table that has not been thrown.
     */
    const rollState = {
        phase: 'idle' as 'idle' | 'rolling' | 'settled' | 'timedOut',
        startedCount: 0,
        settledCount: 0,
        lastTimeoutReason: null as string | null,
        lastResults: null as unknown,
    };

    function bindRollSettledSubscribers(): void {
        appEvents.on(AppEvent.ROLL_STARTED, () => {
            rollState.phase = 'rolling';
            rollState.startedCount += 1;
        });
        appEvents.on(AppEvent.ROLL_SETTLED, (payload) => {
            const settled = payload as
                { results?: unknown; timedOut?: boolean; reason?: string | null } | undefined;
            const results = settled?.results ?? payload;
            rollState.phase = settled?.timedOut ? 'timedOut' : 'settled';
            rollState.settledCount += 1;
            rollState.lastTimeoutReason = settled?.timedOut ? (settled.reason ?? null) : null;
            rollState.lastResults = results;
            // A game throw reports to the game panel: the generic overlay would
            // list the dice held in the jail too, and its "re-roll" would throw
            // outside the game.
            if (!shouldDeferAutoResults() && pendingRollMeta.source !== 'game') {
                showResults(results as DiceReadValue[], {
                    timedOut: settled?.timedOut === true,
                    onReroll: () => void rollHandlerRef.roll?.(null),
                });
            }
            handleResultsReady(results as DiceReadValue[]);
        });
    }

    function bindCollisionSubscribers(): void {
        appEvents.on(AppEvent.DICE_COLLISION, (ev) => {
            const collisionAudio = deps.getCollisionAudio();
            collisionAudio?.handleCollisionEvent(ev);
            collisionAudio?.checkCollisionPropReactions?.(ev);
            getDiceGameFeel()?.handleCollisionEvent(ev);
        });
    }

    function initRollSession({
        replaceDiceSet,
        readAllDiceValues,
        areDiceSettled,
    }: {
        replaceDiceSet: (scene: unknown, world: unknown, specs: unknown) => void;
        readAllDiceValues: () => Array<{
            type: string;
            value: number | null;
            role?: 'tens' | 'ones' | null;
            groupIndex?: number;
        }>;
        areDiceSettled: () => boolean;
    }): void {
        rollSessionRef.current = createRollSession({
            scene: getScene(),
            world: getPhysicsWorld() as null,
            replaceDiceSet,
            throwDice: (s, w, seed) => {
                if (seed != null) {
                    rollHandlerRef.lastRoll = {
                        seed: seed >>> 0,
                        counts: getSpawnedDiceCounts(),
                        expression: null,
                        system: activeRollSystem,
                    };
                }
                getDiceGameFeel()?.clearRollState();
                throwDice(s, w, seed);
                getCameraController()!.setState(DiceFocusState.WAITING_FOR_STOP);
                const lampData = getLampData();
                if (lampData) lampData.setRolling(true);
            },
            readAllDiceValues: (options) => {
                if (!options?.allowCocked) return readAllDiceValues();
                return spawnedDice.map(
                    (die: {
                        type: string;
                        role?: 'tens' | 'ones' | null;
                        groupIndex?: number;
                    }) => ({
                        type: die.type,
                        role: die.role ?? null,
                        groupIndex: die.groupIndex ?? 0,
                        ...readDiceValueAllowingCocked(die),
                    })
                );
            },
            areDiceSettled,
            createSettleWatch: () =>
                createSettleWatch(diceSettleProbe, {
                    isPaused: () => typeof document !== 'undefined' && document.hidden,
                }),
            whenDiceRegistered: async () => {
                await whenDiceRegistered();
            },
            getSystem: () => activeRollSystem,
            onComplete: (result) => {
                if (result?.seed != null) {
                    rollHandlerRef.lastRoll = {
                        seed: result.seed >>> 0,
                        counts: getSpawnedDiceCounts(),
                        expression: result.expression,
                        system: activeRollSystem,
                    };
                }
                showNotationResults(result);
                getDiceGameFeel()?.onNotationResult?.(result);
                appEvents.emit(AppEvent.ROLL_EVALUATED, { result });
            },
        });
        app.rollSession = rollSessionRef.current;

        rollHandlerRef.roll = async (
            explicitSeed: number | null = null,
            options: RollOptions = {}
        ) => {
            if (multiplayerRef.current?.isGuest()) return;
            if (deps.interceptRoll?.()) return;
            const seed = explicitSeed ?? generateRollSeed();
            const diceSet = captureDiceSet();
            const ids = options.slots?.length ? diceIdsForSlots(spawnedDice, options.slots) : null;
            const slots = ids ? slotsForDiceIds(spawnedDice, ids) : null;
            if (ids) parkUnthrown(ids);
            rollHandlerRef.lastRoll = {
                seed: seed >>> 0,
                counts: getSpawnedDiceCounts(),
                ...(slots ? { ids: slots } : {}),
            };
            pendingRollMeta = {
                seed: seed >>> 0,
                expression: null,
                diceSet,
                source: 'ui',
                ...(slots ? { slots } : {}),
            };
            const shadowController = getShadowController();
            shadowController?.pulse('roll');
            getDiceGameFeel()?.clearRollState();
            hideResults();
            const lampData = getLampData();
            if (lampData) lampData.setRolling(true);
            // The commitment does not bind a subset yet, so a partial throw
            // skips the commit-reveal broadcast (and so is not sent at all
            // under ?fair-commit) rather than let a host pick ids afterwards.
            if (!ids) {
                await broadcastFairCommit(seed, null, diceSet, 'ui');
            }
            throwDice(getScene(), getPhysicsWorld(), seed, ids ? { ids } : {});
            getCameraController()!.setState(DiceFocusState.WAITING_FOR_STOP);
            if (!useFairCommit || ids) {
                emitRollStarted({ source: 'ui', seed: seed >>> 0 });
            }
            return seed;
        };
    }

    function createNotationHooks() {
        return {
            systems: Object.values(ROLL_SYSTEMS).map((s) => ({ id: s.id, label: s.label })),
            getSystem: () => activeRollSystem,
            setSystem: (id: string) => {
                if (ROLL_SYSTEMS[id]) activeRollSystem = id;
            },
            applyChip: (expr: string, chip: unknown, system: string) =>
                applyExpressionChip(expr, chip as never, system),
            defaultExpressionForSystem,
            onNotationRoll: async (expression: string, opts: NotationRollOptions = {}) => {
                if (multiplayerRef.current?.isGuest()) {
                    throw new Error('Only the host can roll');
                }
                if (!rollSessionRef.current) throw new Error('Roll session not ready');
                const system = opts.system ?? activeRollSystem;
                activeRollSystem = system;
                const seed = generateRollSeed();
                const diceSet = captureDiceSet();
                pendingRollMeta = {
                    seed,
                    expression,
                    diceSet,
                    source: 'notation',
                };
                const shadowController = getShadowController();
                shadowController?.pulse('roll');
                getDiceGameFeel()?.clearRollState();
                hideResults();
                getCameraController()!.setState(DiceFocusState.WAITING_FOR_STOP);
                const lampData = getLampData();
                if (lampData) lampData.setRolling(true);
                await broadcastFairCommit(seed, expression, diceSet, 'notation');
                if (!useFairCommit) {
                    emitRollStarted({ source: 'notation', expression, seed });
                }
                await rollSessionRef.current.roll(expression, seed, { system });
            },
        };
    }

    /**
     * Replay a drop through the tower the local scene actually has, reporting
     * whether dice were in fact dropped.
     *
     * False means there was no tower (a low tier, or a scene that never loaded
     * tier 2) or nothing to drop. The caller must *not* fall back to a throw:
     * the same seed poses dice completely differently through the chute, so a
     * fallback would quietly show different faces from the ones the host — or
     * the link's author — saw.
     *
     * On success `dropDice` has already run `beginTowerRoll`, which owns the
     * roll UI (camera, lamp, results). Callers therefore do not set that state
     * themselves, and a refused drop leaves nothing waiting on a settle that
     * will never come.
     */
    async function replayTowerDrop(seed: number, context: string): Promise<boolean> {
        const tower = deps.getDiceTowerController?.();
        if (!tower) {
            console.warn(
                `[${context}] a tower drop cannot be replayed without the dice tower, which is not loaded; skipping.`
            );
            return false;
        }
        const dropped = await tower.dropDice('all', { seed: seed >>> 0 });
        return dropped.length > 0;
    }

    function hasShareableRoll(): boolean {
        return rollHandlerRef.lastRoll?.seed != null;
    }

    function getLastRollShareUrl(): string | null {
        const last = rollHandlerRef.lastRoll;
        if (last?.seed == null) return null;
        return buildShareableRollUrl(last.seed, last.counts, undefined, getActiveDiceSet(), {
            expression: last.expression ?? null,
            system: last.system ?? null,
            source: last.source === 'tower' ? 'tower' : null,
            ids: last.ids ?? null,
            layout: deps.getTableLayoutConfig?.() ?? null,
            worldHash: deps.getWorldHash?.() ?? null,
        });
    }

    async function handleRemoteCommit(msg: RemoteCommitMessage): Promise<void> {
        pendingFairCommit = {
            hash: msg.hash,
            notation: msg.notation ?? null,
        };
    }

    async function handleRemoteReveal(msg: RemoteRevealMessage): Promise<void> {
        if (!isWasmAvailable()) {
            throw new Error('wasm_required');
        }
        const expectedHash = pendingFairCommit?.hash ?? msg.hash;
        if (!expectedHash) {
            throw new Error('commit_missing');
        }
        // The source is part of the preimage, so a host that committed to a
        // throw and then revealed a tower drop (or the reverse) fails here
        // rather than getting every guest to replay its late choice.
        const ok = await verifyReveal(expectedHash, msg.seed >>> 0, msg.nonce, msg.source ?? null);
        if (!ok) {
            throw new Error('commit_mismatch');
        }
        pendingFairCommit = null;
        await handleRemoteRoll({
            seed: msg.seed >>> 0,
            notation: msg.notation ?? null,
            diceCounts: msg.diceCounts ?? null,
            source: msg.source ?? null,
        });
    }

    async function handleRemoteRoll({
        seed,
        notation,
        diceCounts,
        source,
        ids: slots,
    }: RemoteRollMessage): Promise<void> {
        if (diceCounts) {
            updateDiceSet(getScene(), getPhysicsWorld(), diceCounts);
            getUi()?.updateCounts?.(diceCounts);
        }

        if (source === 'tower') {
            // The drop drives the roll UI itself (see replayTowerDrop), so
            // this branch returns before the generic setup below rather than
            // duplicating it — and a refused drop leaves the table untouched.
            if (!(await replayTowerDrop(seed, 'RoomSession'))) return;
            // beginTowerRoll stamped the meta as a local tower roll; this is
            // the host's drop being reproduced, and history should say so.
            pendingRollMeta = { ...pendingRollMeta, source: 'remote' };
            return;
        }

        // A subset the host named; the dice it left out sit this one out.
        const subset = slots?.length ? diceIdsForSlots(spawnedDice, slots) : null;
        if (subset) parkUnthrown(subset);
        pendingRollMeta = {
            seed: seed >>> 0,
            expression: notation,
            diceSet: diceCounts ?? captureDiceSet(),
            source: 'remote',
            ...(subset ? { slots: slotsForDiceIds(spawnedDice, subset) } : {}),
        };
        hideResults();
        const shadowController = getShadowController();
        shadowController?.pulse('roll');
        getDiceGameFeel()?.clearRollState();
        const lampData = getLampData();
        if (lampData) lampData.setRolling(true);
        getCameraController()?.setState(DiceFocusState.WAITING_FOR_STOP);
        if (notation && rollSessionRef.current) {
            await rollSessionRef.current.roll(notation, seed);
        } else {
            beginRoll(
                seed,
                notation,
                diceCounts ? { source: 'remote', diceSet: diceCounts } : { source: 'remote' },
                subset ? { ids: subset } : {}
            );
        }
    }

    async function handleRemoteTableSync(msg: RemoteTableSyncMessage): Promise<void> {
        if (msg.diceCounts) {
            updateDiceSet(getScene(), getPhysicsWorld(), msg.diceCounts);
            getUi()?.updateCounts?.(msg.diceCounts);
        }
        const last = msg.lastRoll as
            | {
                  seed?: number | null;
                  notation?: string | null;
                  diceCounts?: Record<string, number> | null;
                  source?: string | null;
                  ids?: number[] | null;
              }
            | null
            | undefined;
        if (last?.seed != null && isWasmAvailable()) {
            if (last.source === 'tower') {
                if (last.diceCounts) {
                    updateDiceSet(getScene(), getPhysicsWorld(), last.diceCounts);
                    await whenDiceRegistered();
                }
                await replayTowerDrop(last.seed, 'RoomSession');
            } else if (last.notation && rollSessionRef.current) {
                pendingRollMeta = {
                    seed: last.seed >>> 0,
                    expression: last.notation,
                    diceSet: last.diceCounts ?? captureDiceSet(),
                    source: 'remote-sync',
                };
                await rollSessionRef.current.roll(last.notation, last.seed);
            } else if (last.diceCounts) {
                updateDiceSet(getScene(), getPhysicsWorld(), last.diceCounts);
                await whenDiceRegistered();
                const subset = last.ids?.length ? diceIdsForSlots(spawnedDice, last.ids) : null;
                if (subset) parkUnthrown(subset);
                beginRoll(
                    last.seed,
                    null,
                    { source: 'remote-sync', diceSet: last.diceCounts },
                    subset ? { ids: subset } : {}
                );
            } else {
                beginRoll(last.seed ?? null, null, { source: 'remote-sync' });
            }
        }
    }

    async function replayShareableRoll(
        searchParams: URLSearchParams,
        options: { skip?: boolean } = {}
    ): Promise<void> {
        const replayRequest = options.skip ? null : parseShareableRollParams(searchParams);
        if (replayRequest) {
            if ('error' in replayRequest) {
                console.warn(
                    `[ShareableRoll] Unsupported replay version v=${replayRequest.version} ` +
                        `(this build reads v=${SUPPORTED_REPLAY_VERSIONS.join('/')}, writes up to ` +
                        `v=${REPLAY_VERSION}); skipping auto-replay.`
                );
            } else {
                if (!isWasmAvailable()) {
                    console.warn(
                        '[ShareableRoll] WASM physics is not available; no dice to replay. Run `npm run build:wasm` first.'
                    );
                    return;
                }
                // The layout params rebuild the sender's table; `w=` says what the
                // sender actually built. Props or colliders that differ (another
                // app version, an edited position) make the same seed a different
                // roll, so refuse rather than show faces the sender never saw.
                const localWorldHash = deps.getWorldHash?.() ?? null;
                if (
                    replayRequest.worldHash &&
                    localWorldHash &&
                    replayRequest.worldHash !== localWorldHash
                ) {
                    console.warn(
                        `[ShareableRoll] Table mismatch: link w=${replayRequest.worldHash}, ` +
                            `this table ${localWorldHash}; skipping auto-replay.`
                    );
                    showTableMismatchBadge(
                        'This roll was made on a different table — not replayed.',
                        {
                            detail: `link table ${replayRequest.worldHash}\nthis table ${localWorldHash}`,
                        }
                    );
                    return;
                }
                if ('diceCounts' in replayRequest && replayRequest.diceCounts) {
                    updateDiceSet(getScene(), getPhysicsWorld(), replayRequest.diceCounts);
                    getUi()?.updateCounts?.(replayRequest.diceCounts);
                    // The replay throws these exact bodies: wait until the
                    // engine has them, or the throw lands on last frame's table.
                    await whenDiceRegistered();
                }
                if (replayRequest.system && ROLL_SYSTEMS[replayRequest.system]) {
                    activeRollSystem = replayRequest.system;
                }
                if (replayRequest.source === 'tower') {
                    void replayTowerDrop(replayRequest.seed, 'ShareableRoll');
                } else if (replayRequest.expression) {
                    rollHandlerRef.lastRoll = {
                        seed: replayRequest.seed >>> 0,
                        counts: {},
                        expression: replayRequest.expression,
                        system: activeRollSystem,
                    };
                    rollSessionRef.current
                        ?.roll(replayRequest.expression, replayRequest.seed, {
                            system: activeRollSystem,
                        })
                        ?.catch((err) =>
                            console.warn('[ShareableRoll] expression replay failed', err)
                        );
                } else {
                    rollHandlerRef.roll?.(replayRequest.seed, { slots: replayRequest.ids });
                }
            }
        }
    }

    bindCollisionSubscribers();
    bindRollSettledSubscribers();

    return {
        rollSessionRef,
        rollHandlerRef,
        captureDiceSet,
        beginCupRoll,
        beginTowerRoll,
        beginRoll,
        throwSubset,
        initRollSession,
        createNotationHooks,
        hasShareableRoll,
        getLastRollShareUrl,
        handleRemoteRoll,
        handleRemoteTableSync,
        handleRemoteCommit,
        handleRemoteReveal,
        replayShareableRoll,
        getRollState: () => ({ ...rollState }),
        REPLAY_VERSION,
        getPendingRollMeta: () => ({ ...pendingRollMeta }),
    };
}
