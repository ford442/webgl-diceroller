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
    getDiceAppearanceConfig,
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
    buildShareableRollUrl,
    generateRollSeed,
    parseShareableRollParams,
} from '../roll/ShareableRoll.js';

/**
 * @param {import('../types/app').AppContext} app
 * @param {object} deps
 */
export function createRollWiring(app, deps) {
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
    } = deps;

    /** @type {import('../types/app').PendingRollMeta} */
    let pendingRollMeta = { seed: null, expression: null, diceSet: {} };
    let activeRollSystem = DEFAULT_ROLL_SYSTEM;

    const rollSessionRef = { current: null };
    const rollHandlerRef = { roll: null, lastRoll: null };

    function captureDiceSet() {
        /** @type {Record<string, number>} */
        const diceSet = {};
        spawnedDice.forEach((die) => {
            diceSet[die.type] = (diceSet[die.type] ?? 0) + 1;
        });
        return diceSet;
    }

    function beginCupRoll() {
        pendingRollMeta = {
            seed: null,
            expression: null,
            diceSet: captureDiceSet(),
            source: 'cup',
        };
        rollHandlerRef.lastRoll = {
            seed: null,
            counts: getSpawnedDiceCounts(),
            source: 'cup',
        };
        const shadowController = getShadowController();
        shadowController?.pulse('roll');
        getDiceGameFeel()?.clearRollState();
        getCameraController()?.setState(DiceFocusState.WAITING_FOR_STOP);
        hideResults();
        const lampData = getLampData();
        if (lampData) lampData.setRolling(true);
        emitRollStarted({ source: 'cup' });
    }

    function beginRoll(seed = null, expression = null) {
        pendingRollMeta = {
            seed: seed ?? null,
            expression: expression ?? null,
            diceSet: captureDiceSet(),
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

    function emitRollStarted(extra = {}) {
        appEvents.emit(AppEvent.ROLL_STARTED, {
            seed: pendingRollMeta.seed,
            expression: pendingRollMeta.expression,
            diceSet: pendingRollMeta.diceSet,
            source: pendingRollMeta.source,
            ...extra,
        });
    }

    function handleResultsReady(results) {
        rollHistory?.appendRoll(results, pendingRollMeta);
        rollStats?.recordResults(results);
        getFairnessMonitor()?.render();
        getRollHistoryPanel()?.refresh();
        getDiceGameFeel()?.onResultsReady(results);
        multiplayerRef.current?.recordSettledResults?.(results);
        pendingRollMeta = { seed: null, expression: null, diceSet: {} };
    }

    function bindRollSettledSubscribers() {
        appEvents.on(AppEvent.ROLL_SETTLED, (payload) => {
            const results = /** @type {{ results?: unknown }} */ (payload)?.results ?? payload;
            if (!shouldDeferAutoResults()) {
                showResults(/** @type {import('../types/dice').DiceReadValue[]} */ (results));
            }
            handleResultsReady(/** @type {import('../types/dice').DiceReadValue[]} */ (results));
        });
    }

    function bindCollisionSubscribers() {
        appEvents.on(AppEvent.DICE_COLLISION, (ev) => {
            const collisionAudio = deps.getCollisionAudio();
            collisionAudio?.handleCollisionEvent(ev);
            collisionAudio?.checkCollisionPropReactions?.(ev);
            getDiceGameFeel()?.handleCollisionEvent(ev);
        });
    }

    function initRollSession({ replaceDiceSet, readAllDiceValues, areDiceSettled }) {
        rollSessionRef.current = createRollSession({
            scene: getScene(),
            world: getPhysicsWorld(),
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
                getCameraController().setState(DiceFocusState.WAITING_FOR_STOP);
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
            },
        });
        app.rollSession = rollSessionRef.current;

        rollHandlerRef.roll = (explicitSeed = null) => {
            if (multiplayerRef.current?.isGuest()) return;
            const seed = explicitSeed ?? generateRollSeed();
            rollHandlerRef.lastRoll = {
                seed: seed >>> 0,
                counts: getSpawnedDiceCounts(),
            };
            pendingRollMeta = {
                seed: seed >>> 0,
                expression: null,
                diceSet: captureDiceSet(),
                source: 'ui',
            };
            const shadowController = getShadowController();
            shadowController?.pulse('roll');
            getDiceGameFeel()?.clearRollState();
            throwDice(getScene(), getPhysicsWorld(), seed);
            getCameraController().setState(DiceFocusState.WAITING_FOR_STOP);
            hideResults();
            const lampData = getLampData();
            if (lampData) lampData.setRolling(true);
            emitRollStarted({ source: 'ui', seed: seed >>> 0 });
            return seed;
        };
    }

    function createNotationHooks() {
        return {
            systems: Object.values(ROLL_SYSTEMS).map((s) => ({ id: s.id, label: s.label })),
            getSystem: () => activeRollSystem,
            setSystem: (id) => {
                if (ROLL_SYSTEMS[id]) activeRollSystem = id;
            },
            applyChip: (expr, chip, system) => applyExpressionChip(expr, chip, system),
            defaultExpressionForSystem,
            onNotationRoll: async (expression, opts = {}) => {
                if (multiplayerRef.current?.isGuest()) {
                    throw new Error('Only the host can roll');
                }
                if (!rollSessionRef.current) throw new Error('Roll session not ready');
                const system = opts.system ?? activeRollSystem;
                activeRollSystem = system;
                const seed = generateRollSeed();
                pendingRollMeta = {
                    seed,
                    expression,
                    diceSet: captureDiceSet(),
                    source: 'notation',
                };
                const shadowController = getShadowController();
                shadowController?.pulse('roll');
                getDiceGameFeel()?.clearRollState();
                hideResults();
                getCameraController().setState(DiceFocusState.WAITING_FOR_STOP);
                const lampData = getLampData();
                if (lampData) lampData.setRolling(true);
                emitRollStarted({ source: 'notation', expression, seed });
                await rollSessionRef.current.roll(expression, seed, { system });
            },
        };
    }

    function hasShareableRoll() {
        return rollHandlerRef.lastRoll?.seed != null;
    }

    function getLastRollShareUrl() {
        const last = rollHandlerRef.lastRoll;
        if (!last?.seed) return null;
        return buildShareableRollUrl(last.seed, last.counts, undefined, getDiceAppearanceConfig(), {
            expression: last.expression ?? null,
            system: last.system ?? null,
        });
    }

    async function handleRemoteRoll({ seed, notation, diceCounts }) {
        if (diceCounts) {
            updateDiceSet(getScene(), getPhysicsWorld(), diceCounts);
            getUi()?.updateCounts?.(diceCounts);
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
            beginRoll(seed, notation);
        }
    }

    async function handleRemoteTableSync(msg) {
        if (msg.diceCounts) {
            updateDiceSet(getScene(), getPhysicsWorld(), msg.diceCounts);
            getUi()?.updateCounts?.(msg.diceCounts);
        }
        const last = msg.lastRoll;
        if (last?.seed != null && isWasmAvailable()) {
            if (last.notation && rollSessionRef.current) {
                pendingRollMeta = {
                    seed: last.seed >>> 0,
                    expression: last.notation,
                    diceSet: last.diceCounts ?? captureDiceSet(),
                    source: 'remote-sync',
                };
                await rollSessionRef.current.roll(last.notation, last.seed);
            } else if (last.diceCounts) {
                updateDiceSet(getScene(), getPhysicsWorld(), last.diceCounts);
                beginRoll(last.seed);
            } else {
                beginRoll(last.seed);
            }
        }
    }

    /**
     * @param {URLSearchParams} searchParams
     * @param {{ skip?: boolean }} [options]
     */
    function replayShareableRoll(searchParams, options = {}) {
        const replayRequest = options.skip ? null : parseShareableRollParams(searchParams);
        if (replayRequest) {
            if ('error' in replayRequest && replayRequest.error === 'unsupported_version') {
                console.warn(
                    `[ShareableRoll] Unsupported replay version v=${replayRequest.version} (need v=${REPLAY_VERSION}); skipping auto-replay.`
                );
            } else {
                if (!isWasmAvailable()) {
                    console.warn(
                        '[ShareableRoll] WASM physics is not available; replay uses ammo fallback and may not match the original roll. Run `npm run build:wasm` for bit-identical replay.'
                    );
                }
                if ('diceCounts' in replayRequest && replayRequest.diceCounts) {
                    updateDiceSet(getScene(), getPhysicsWorld(), replayRequest.diceCounts);
                    getUi()?.updateCounts?.(replayRequest.diceCounts);
                }
                if (replayRequest.system && ROLL_SYSTEMS[replayRequest.system]) {
                    activeRollSystem = replayRequest.system;
                }
                if (replayRequest.expression) {
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
                        ?.catch((err) => console.warn('[ShareableRoll] expression replay failed', err));
                } else {
                    rollHandlerRef.roll(replayRequest.seed);
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
        beginRoll,
        initRollSession,
        createNotationHooks,
        hasShareableRoll,
        getLastRollShareUrl,
        handleRemoteRoll,
        handleRemoteTableSync,
        replayShareableRoll,
        REPLAY_VERSION,
    };
}
