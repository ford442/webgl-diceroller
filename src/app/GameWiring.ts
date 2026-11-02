/**
 * Table games on the tavern: the real `GameTable` (the scene, the jail, the
 * roll wiring), the Farkle panel, and the one place a game is started.
 *
 * Rules live in `dice-core` and know nothing of this file; the session logic
 * lives in GameSession.ts and knows nothing of the scene. This is the join.
 * Solo against a bot for now — a room needs the host to broadcast `{ action,
 * seed, ids }` (the roll message already carries `ids`), which is the next slice.
 */

import {
    createFarkleRules,
    FARKLE_DICE,
    FARKLE_DIE_TYPE,
    type FarkleAction,
    type FarkleConfig,
    type FarkleState,
} from 'dice-core/game/Farkle';
import { createFarkleBot } from 'dice-core/game/FarkleBot';
import type { ThrowDie } from 'dice-core/game/GameRules';
import { generateRollSeed } from 'dice-core/roll/ShareableRoll';
import { createSeededRng } from 'dice-core/wasm/seededThrowParams';
import { getSpawnedDiceCounts, spawnedDice, updateDiceSet, whenDiceRegistered } from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { isTouchPrimaryDevice } from '../core/DeviceCapabilities.js';
import { createFarklePanel, type FarklePanel } from '../ui/FarklePanel.js';
import type { DiceJailController } from '../interaction/DiceJailController.js';
import type { RoomSession } from '../net/RoomSession.js';
import type { AppContext } from '../types/app';
import {
    createGameSession,
    type GameSession,
    type GameSnapshot,
    type GameTable,
    type SubmitResult,
    type TableThrow,
} from './GameSession.js';
import type { createRollWiring } from './RollWiring.js';

export type FarkleSession = GameSession<FarkleState, FarkleAction, FarkleState>;
export type FarkleSnapshot = GameSnapshot<FarkleState, FarkleAction>;

export interface FarkleStartOptions {
    /** Seeds the game (init + every throw). Random when omitted. */
    seed?: number;
    config?: Partial<FarkleConfig>;
    /** Milliseconds a bot "thinks", and the beat after a throw lands. */
    pace?: { think?: number; afterThrow?: number };
}

export interface GameWiringDeps {
    rollWiring: ReturnType<typeof createRollWiring>;
    getScene: () => unknown;
    getPhysicsWorld: () => unknown;
    getUi: () => { updateCounts?: (counts: Record<string, number>) => void } | null | undefined;
    getDiceJailController: () => DiceJailController | null | undefined;
    multiplayerRef: { current: RoomSession | null };
}

/** The six d6 Farkle plays with; rules die id `i` is `FARKLE_TABLE_DICE[i]`. */
export const FARKLE_TABLE_DICE: ThrowDie[] = Array.from({ length: FARKLE_DICE }, (_, id) => ({
    id,
    type: FARKLE_DIE_TYPE,
}));

// Long enough that a bot's next throw lands after the camera's focus-hold-return
// (about 2.5 s from a settle), so back-to-back throws do not cut it short.
const BOT_PACE = { think: 1000, afterThrow: 700 };

/** The scene, as a game sees it. */
export function createTavernGameTable(deps: GameWiringDeps): GameTable {
    let saved: Record<string, number> | null = null;

    const jail = () => deps.getDiceJailController() ?? null;
    const setCounts = async (counts: Record<string, number>) => {
        updateDiceSet(deps.getScene(), deps.getPhysicsWorld(), counts);
        deps.getUi()?.updateCounts?.(counts);
        // The throw that follows poses these exact bodies: wait until the engine has them.
        if (!(await whenDiceRegistered())) {
            throw new Error('The physics engine did not register the dice.');
        }
    };

    return {
        async seat(dice) {
            const current = getSpawnedDiceCounts();
            saved = { ...current };
            jail()?.release();
            const wanted: Record<string, number> = Object.fromEntries(
                Object.keys(current).map((type) => [type, 0])
            );
            for (const die of dice) wanted[die.type] = (wanted[die.type] ?? 0) + 1;
            await setCounts(wanted);

            const taken = new Set<number>();
            return dice.map((want) => {
                const found = spawnedDice.find(
                    (die) => die.type === want.type && die.wasmId != null && !taken.has(die.wasmId)
                );
                if (!found || found.wasmId == null) {
                    throw new Error(`The table has no ${want.type} for the game.`);
                }
                taken.add(found.wasmId);
                return found.wasmId;
            });
        },

        async restore() {
            if (!saved) return;
            const back = saved;
            saved = null;
            await setCounts(back);
        },

        present: (ids) => ids.every((id) => spawnedDice.some((die) => die.wasmId === id)),
        heldIds: () => jail()?.getState().heldIds ?? [],
        hold: (ids) => jail()?.hold([...ids]) ?? 0,
        release: (ids) => jail()?.release(ids) ?? 0,
        throw: (ids, seed): Promise<TableThrow> => deps.rollWiring.throwSubset(ids, seed),
        setLocked: (reason) => jail()?.setLocked(reason),
    };
}

export function setupGameWiring(app: AppContext, deps: GameWiringDeps) {
    const touchUi = isTouchPrimaryDevice();
    let session: FarkleSession | null = null;
    let unsubscribe: (() => void) | null = null;

    const panel: FarklePanel = createFarklePanel({
        touchUi,
        actions: {
            onStart: () => void start(),
            onClose: () => void close(),
            onThrow: () => session?.submit({ type: 'roll' }),
            onKeep: (dice) => session?.submit({ type: 'keep', dice }),
            onBank: () => session?.submit({ type: 'bank' }),
            onRethrow: () => session?.rethrow(),
        },
    });

    function unavailable(): string | null {
        if (!isWasmAvailable()) return 'Farkle needs the physics engine, which did not load.';
        if (deps.multiplayerRef.current?.isHost?.() || deps.multiplayerRef.current?.isGuest?.()) {
            return 'Farkle is solo for now — leave the room to play.';
        }
        if (!deps.getDiceJailController()) {
            return 'Farkle sets dice aside in the dice jail, which is not on the table yet.';
        }
        if (deps.rollWiring.getRollState().phase === 'rolling') {
            return 'Wait for the dice to settle first.';
        }
        return null;
    }

    async function close(): Promise<void> {
        const ending = session;
        session = null;
        unsubscribe?.();
        unsubscribe = null;
        await ending?.stop();
        panel.render(null);
    }

    async function start(options: FarkleStartOptions = {}): Promise<FarkleSession | null> {
        // A finished or abandoned game is cleared first, which also puts the
        // table back the way the player had it.
        if (session) await close();
        const blocked = unavailable();
        if (blocked) {
            panel.showMessage(blocked);
            return null;
        }

        const bot = createFarkleBot();
        const next = createGameSession<FarkleState, FarkleAction, FarkleState>({
            rules: createFarkleRules(options.config),
            table: createTavernGameTable(deps),
            dice: FARKLE_TABLE_DICE,
            heldDice: (state) => state.dice.filter((d) => d.kept).map((d) => d.id),
            seats: [
                { id: 'you', name: 'You' },
                { id: 'bot', name: 'Tavern bot', policy: bot },
            ],
            createRng: createSeededRng,
            seed: (options.seed ?? generateRollSeed()) >>> 0,
            pace: { ...BOT_PACE, ...options.pace },
        });
        session = next;
        unsubscribe = next.subscribe((snapshot) => {
            if (session === next) panel.render(snapshot, next.preview);
        });
        panel.render(next.getSnapshot(), next.preview);
        void next.start().catch((err) => console.error('[Game] session failed', err));
        return next;
    }

    /**
     * R / "Roll All" / the results re-roll while a game owns the table: they
     * would throw the free dice outside the rules, so during a game they mean
     * "my throw" — if a throw is what the rules are waiting for.
     */
    function interceptRoll(): boolean {
        // Only a game in progress: once it is over (or stopped) R means R again.
        if (!session?.isActive()) return false;
        const snapshot = session.getSnapshot();
        if (snapshot.legal.some((a) => a.type === 'roll')) session.submit({ type: 'roll' });
        return true;
    }

    const api = {
        start,
        stop: close,
        interceptRoll,
        isActive: () => session?.isActive() ?? false,
        getSession: () => session,
        getSnapshot: (): FarkleSnapshot | null => session?.getSnapshot() ?? null,
        submit: (action: FarkleAction): SubmitResult =>
            session?.submit(action) ?? { ok: false, error: 'No game is running.' },
        rethrow: (): SubmitResult =>
            session?.rethrow() ?? { ok: false, error: 'No game is running.' },
        panel,
    };
    app.game = api;
    return api;
}

export type GameWiring = ReturnType<typeof setupGameWiring>;
