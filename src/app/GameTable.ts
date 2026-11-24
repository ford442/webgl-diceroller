/**
 * Table games on the tavern: the real `GameTable` (the scene, the jail, the
 * roll wiring) and the function that builds a Farkle session on it.
 *
 * Rules live in `dice-core` and know nothing of this file; the session logic
 * lives in GameSession.ts and knows nothing of the scene. This is the join.
 * Solo against a bot for now — a room needs the host to broadcast `{ action,
 * seed, ids }` (the roll message already carries `ids`), which is the next slice.
 *
 * Loaded on demand: `GameWiring.ts` (the Farkle panel and the `app.game` facade)
 * imports this dynamically on the first "Play Farkle", so the rules, the bot, the
 * session and the table adapter stay out of the entry chunk until a game starts.
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
import { reorderToTypeSequence } from './diceOrder.js';
import type { DiceJailController } from '../interaction/DiceJailController.js';
import type { RoomSession } from '../net/RoomSession.js';
import {
    createGameSession,
    type GameSession,
    type GameSnapshot,
    type GameTable,
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
    /** The type of each die, in table order, before the game took the table. */
    let savedOrder: string[] = [];

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
            savedOrder = spawnedDice.map((die) => die.type);
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
            // updateDiceSet re-adds removed dice at the end; put each back in its slot.
            reorderToTypeSequence(spawnedDice, savedOrder);
        },

        present: (ids) => ids.every((id) => spawnedDice.some((die) => die.wasmId === id)),
        heldIds: () => jail()?.getState().heldIds ?? [],
        hold: (ids) => jail()?.hold([...ids]) ?? 0,
        release: (ids) => jail()?.release(ids) ?? 0,
        throw: (ids, seed): Promise<TableThrow> => deps.rollWiring.throwSubset(ids, seed),
        setLocked: (reason) => jail()?.setLocked(reason),
    };
}

/** What `GameWiring` hands the session builder besides the table. */
export interface FarkleSessionRequest {
    deps: GameWiringDeps;
    options: FarkleStartOptions;
}

/** A Farkle session on the real table (not yet started). */
export function createFarkleTableSession({ deps, options }: FarkleSessionRequest): FarkleSession {
    const bot = createFarkleBot();
    return createGameSession<FarkleState, FarkleAction, FarkleState>({
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
}
