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
} from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { DiceFocusState } from '../core/CameraController.js';
import { showResults, hideResults, showNotationResults } from '../results.js';
import { AppEvent } from '../core/AppEvents.js';
import { createRollSession, shouldDeferAutoResults } from '../roll/RollSession.js';
import {
    ROLL_SYSTEMS,
    DEFAULT_ROLL_SYSTEM,
    applyExpressionChip,
    defaultExpressionForSystem,
} from '../roll/Notation.js';
import {
    REPLAY_VERSION,
    SUPPORTED_REPLAY_VERSIONS,
    buildShareableRollUrl,
    generateRollSeed,
    parseShareableRollParams,
} from '../roll/ShareableRoll.js';
import { createCommit, generateNonce, verifyReveal } from '../net/CommitReveal.js';
import type { AppContext, AppEvents, PendingRollMeta } from '../types/app';
import type { DiceReadValue } from '../types/dice.js';
import type { EvaluatedRoll } from '../types/roll.js';
import type { RollHistory } from '../roll/RollHistory.js';
import type { RollStats } from '../roll/RollStats.js';
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
    dropDice: (idsOrAll: 'all' | number[], options?: { seed?: number | null }) => number[];
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
}

interface LastRollRef {
    seed: number | null;
    counts: Record<string, number>;
    source?: string;
    expression?: string | null;
    system?: string;
}

interface RollHandlerRef {
    roll: ((explicitSeed?: number | null) => Promise<number | undefined>) | null;
    lastRoll: LastRollRef | null;
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
    function beginTowerRoll(explicitSeed: number | null = null): number {
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
        if (useFairCommit) {
            // The caller needs the seed *now* to pose dice this frame, so the
            // commit/reveal pair goes out alongside the drop instead of
            // gating it. Guests still verify the hash before they replay —
            // they just start a beat behind the host, the way a physical
            // tower is a beat behind the hand that tipped it.
            void broadcastFairCommit(seed, null, diceSet, 'tower');
        } else {
            emitRollStarted({ source: 'tower', seed });
        }
        return seed;
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
            },
        });
    }

    function beginRoll(
        seed: number | null = null,
        expression: string | null = null,
        meta: Record<string, unknown> = {}
    ): void {
        pendingRollMeta = {
            seed: seed ?? null,
            expression: expression ?? null,
            diceSet: captureDiceSet(),
            ...meta,
        };
        const shadowController = getShadowController();
        shadowController?.pulse('roll');
        getDiceGameFeel()?.clearRollState();
        throwDice(getScene(), getPhysicsWorld(), seed);
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
            ...extra,
        });
    }

    function handleResultsReady(results: DiceReadValue[]): void {
        // RollHistory/RollStats model settled dice as `{ type, value: number }`;
        // `value` is only ever null mid-roll, never once results are ready.
        const settled = results as unknown as Array<{ type: string; value: number }>;
        rollHistory?.appendRoll(settled, pendingRollMeta);
        rollStats?.recordResults(settled);
        getFairnessMonitor()?.render();
        getRollHistoryPanel()?.refresh();
        getDiceGameFeel()?.onResultsReady(results);
        multiplayerRef.current?.recordSettledResults?.(results);
        pendingRollMeta = { seed: null, expression: null, diceSet: {} };
    }

    function bindRollSettledSubscribers(): void {
        appEvents.on(AppEvent.ROLL_SETTLED, (payload) => {
            const results = (payload as { results?: unknown } | undefined)?.results ?? payload;
            if (!shouldDeferAutoResults()) {
                showResults(results as DiceReadValue[]);
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
            readAllDiceValues,
            areDiceSettled,
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

        rollHandlerRef.roll = async (explicitSeed: number | null = null) => {
            if (multiplayerRef.current?.isGuest()) return;
            const seed = explicitSeed ?? generateRollSeed();
            const diceSet = captureDiceSet();
            rollHandlerRef.lastRoll = {
                seed: seed >>> 0,
                counts: getSpawnedDiceCounts(),
            };
            pendingRollMeta = {
                seed: seed >>> 0,
                expression: null,
                diceSet,
                source: 'ui',
            };
            const shadowController = getShadowController();
            shadowController?.pulse('roll');
            getDiceGameFeel()?.clearRollState();
            hideResults();
            const lampData = getLampData();
            if (lampData) lampData.setRolling(true);
            await broadcastFairCommit(seed, null, diceSet, 'ui');
            throwDice(getScene(), getPhysicsWorld(), seed);
            getCameraController()!.setState(DiceFocusState.WAITING_FOR_STOP);
            if (!useFairCommit) {
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
    function replayTowerDrop(seed: number, context: string): boolean {
        const tower = deps.getDiceTowerController?.();
        if (!tower) {
            console.warn(
                `[${context}] a tower drop cannot be replayed without the dice tower, which is not loaded; skipping.`
            );
            return false;
        }
        return tower.dropDice('all', { seed: seed >>> 0 }).length > 0;
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
        const ok = await verifyReveal(expectedHash, msg.seed >>> 0, msg.nonce);
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
    }: RemoteRollMessage): Promise<void> {
        if (diceCounts) {
            updateDiceSet(getScene(), getPhysicsWorld(), diceCounts);
            getUi()?.updateCounts?.(diceCounts);
        }

        if (source === 'tower') {
            // The drop drives the roll UI itself (see replayTowerDrop), so
            // this branch returns before the generic setup below rather than
            // duplicating it — and a refused drop leaves the table untouched.
            if (!replayTowerDrop(seed, 'RoomSession')) return;
            // beginTowerRoll stamped the meta as a local tower roll; this is
            // the host's drop being reproduced, and history should say so.
            pendingRollMeta = { ...pendingRollMeta, source: 'remote' };
            return;
        }

        pendingRollMeta = {
            seed: seed >>> 0,
            expression: notation,
            diceSet: diceCounts ?? captureDiceSet(),
            source: 'remote',
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
                diceCounts ? { source: 'remote', diceSet: diceCounts } : { source: 'remote' }
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
              }
            | null
            | undefined;
        if (last?.seed != null && isWasmAvailable()) {
            if (last.source === 'tower') {
                if (last.diceCounts) {
                    updateDiceSet(getScene(), getPhysicsWorld(), last.diceCounts);
                }
                replayTowerDrop(last.seed, 'RoomSession');
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
                beginRoll(last.seed, null, { source: 'remote-sync', diceSet: last.diceCounts });
            } else {
                beginRoll(last.seed ?? null, null, { source: 'remote-sync' });
            }
        }
    }

    function replayShareableRoll(
        searchParams: URLSearchParams,
        options: { skip?: boolean } = {}
    ): void {
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
                if ('diceCounts' in replayRequest && replayRequest.diceCounts) {
                    updateDiceSet(getScene(), getPhysicsWorld(), replayRequest.diceCounts);
                    getUi()?.updateCounts?.(replayRequest.diceCounts);
                }
                if (replayRequest.system && ROLL_SYSTEMS[replayRequest.system]) {
                    activeRollSystem = replayRequest.system;
                }
                if (replayRequest.source === 'tower') {
                    replayTowerDrop(replayRequest.seed, 'ShareableRoll');
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
                    rollHandlerRef.roll?.(replayRequest.seed);
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
        initRollSession,
        createNotationHooks,
        hasShareableRoll,
        getLastRollShareUrl,
        handleRemoteRoll,
        handleRemoteTableSync,
        handleRemoteCommit,
        handleRemoteReveal,
        replayShareableRoll,
        REPLAY_VERSION,
        getPendingRollMeta: () => ({ ...pendingRollMeta }),
    };
}
