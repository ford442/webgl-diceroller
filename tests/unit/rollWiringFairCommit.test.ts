/**
 * Commit-reveal is the only multiplayer protocol (v2 by default), so every
 * roll path has to work with it on:
 *
 * - outside a room a roll starts exactly once, with nothing to commit (the
 *   `?fair-commit` path used to emit no ROLL_STARTED at all when solo);
 * - a host publishes the commitment on ROLL_COMMITTED *before* the dice move
 *   and starts the roll once, carrying the reveal;
 * - a partial throw (a die held in the jail) commits to its slots, and a
 *   guest refuses a reveal that names different ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppEvents } from '../../src/core/AppEvents.js';

interface FakeDie {
    type: string;
    wasmId: number;
    kinematic?: boolean;
}

const hoisted = vi.hoisted(() => ({
    dice: [] as FakeDie[],
    throwDice: vi.fn(),
    showResults: vi.fn(),
}));

vi.mock('../../src/dice.js', () => ({
    get spawnedDice() {
        return hoisted.dice;
    },
    throwDice: hoisted.throwDice,
    updateDiceSet: vi.fn(),
    getSpawnedDiceCounts: () => ({ d6: hoisted.dice.length }),
    getActiveDiceSet: () => null,
    whenDiceRegistered: async () => true,
    diceSettleProbe: {},
    readDiceValueAllowingCocked: () => ({ value: 1, cocked: false }),
}));
vi.mock('../../src/wasm/PhysicsBridge.js', () => ({ isWasmAvailable: () => true }));
vi.mock('../../src/results.js', () => ({
    showResults: hoisted.showResults,
    hideResults: vi.fn(),
    showNotationResults: vi.fn(),
}));

const { createRollWiring } = await import('../../src/app/RollWiring.js');
const { commitHash, createCommit, generateNonce } = await import('dice-core/net/CommitReveal');

function setup(room: unknown = null, overrides: Record<string, unknown> = {}) {
    const appEvents = createAppEvents();
    const jail = { hold: vi.fn(() => 0) };
    const rollHistory = { appendRoll: vi.fn() };
    const rollStats = { recordResults: vi.fn() };
    const setState = vi.fn();
    const app = {} as never;
    const wiring = createRollWiring(app, {
        appEvents,
        getScene: () => ({}),
        getPhysicsWorld: () => null,
        getShadowController: () => null,
        getDiceGameFeel: () => null,
        getCameraController: () => ({ setState }),
        getLampData: () => null,
        getUi: () => null,
        rollHistory: rollHistory as never,
        rollStats: rollStats as never,
        getFairnessMonitor: () => null,
        getRollHistoryPanel: () => null,
        getCollisionAudio: () => null,
        getDiceJailController: () => jail,
        multiplayerRef: { current: room },
        ...overrides,
    } as never);
    wiring.initRollSession({
        replaceDiceSet: vi.fn(),
        readAllDiceValues: () => [],
        areDiceSettled: () => true,
    });
    return { wiring, appEvents, jail, rollHistory, rollStats, setState };
}

function record(appEvents: ReturnType<typeof createAppEvents>) {
    const log: Array<{ type: string; payload: Record<string, unknown> }> = [];
    for (const type of ['roll:committed', 'roll:started']) {
        appEvents.on(type, (payload) => {
            log.push({ type, payload: payload as Record<string, unknown> });
            if (type === 'roll:committed') {
                // The dice must not have moved while the commitment is out.
                expect(hoisted.throwDice).not.toHaveBeenCalled();
            }
        });
    }
    return log;
}

const host = { isHost: () => true, isGuest: () => false, useFairCommit: true };
const guest = { isHost: () => false, isGuest: () => true, useFairCommit: true };

beforeEach(() => {
    hoisted.dice = Array.from({ length: 6 }, (_, i) => ({ type: 'd6', wasmId: 70 + i }));
    hoisted.throwDice.mockReset();
});

describe('a roll outside a room', () => {
    it('starts exactly once and commits nothing', async () => {
        const { wiring, appEvents } = setup(null);
        const log = record(appEvents);
        await wiring.rollHandlerRef.roll?.(7);

        expect(log.map((e) => e.type)).toEqual(['roll:started']);
        expect(log[0]!.payload).not.toHaveProperty('reveal');
        expect(wiring.getRollState().phase).toBe('rolling');
        expect(wiring.getRollState().startedCount).toBe(1);
    });

    it('starts a notation roll exactly once too', async () => {
        const { wiring, appEvents } = setup(null);
        const log = record(appEvents);
        const hooks = wiring.createNotationHooks();
        await hooks.onNotationRoll('1d6').catch(() => {});
        expect(log.map((e) => e.type)).toEqual(['roll:started']);
    });
});

describe('a commit-reveal host', () => {
    it('commits before the dice move, then starts the roll once with the reveal', async () => {
        const { wiring, appEvents } = setup(host);
        const log = record(appEvents);
        await wiring.rollHandlerRef.roll?.(4242);

        expect(log.map((e) => e.type)).toEqual(['roll:committed', 'roll:started']);
        expect(wiring.getRollState().startedCount).toBe(1);

        const commit = log[0]!.payload.commit as { hash: string; ids?: number[] };
        const reveal = log[1]!.payload.reveal as { seed: number; nonce: string; source: string };
        expect(commit.ids).toBeUndefined();
        expect(reveal.seed).toBe(4242);
        expect(await commitHash(reveal.seed, reveal.nonce, reveal.source)).toBe(commit.hash);
    });

    it('commits to the slots of a partial throw instead of skipping the broadcast', async () => {
        const { wiring, appEvents } = setup(host);
        const log = record(appEvents);
        await wiring.rollHandlerRef.roll?.(99, { slots: [1, 4] });

        expect(log.map((e) => e.type)).toEqual(['roll:committed', 'roll:started']);
        const commit = log[0]!.payload.commit as { hash: string; ids?: number[] };
        const reveal = log[1]!.payload.reveal as {
            seed: number;
            nonce: string;
            source: string;
            ids?: number[];
        };
        expect(commit.ids).toEqual([1, 4]);
        expect(reveal.ids).toEqual([1, 4]);
        expect(await commitHash(99, reveal.nonce, reveal.source, reveal.ids)).toBe(commit.hash);
        expect(hoisted.throwDice).toHaveBeenCalledWith(expect.anything(), null, 99, {
            ids: [71, 74],
        });
    });
});

describe('R with a die held in the jail', () => {
    it('is a partial throw that names the free dice and commits to them', async () => {
        hoisted.dice[1]!.kinematic = true;
        const { wiring, appEvents, jail } = setup(host);
        const log = record(appEvents);
        await wiring.rollHandlerRef.roll?.(31);

        const commit = log[0]!.payload.commit as { ids?: number[] };
        expect(commit.ids).toEqual([0, 2, 3, 4, 5]);
        expect(hoisted.throwDice).toHaveBeenCalledWith(expect.anything(), null, 31, {
            ids: [70, 72, 73, 74, 75],
        });
        // The held die is already parked; nothing else is.
        expect(jail.hold).not.toHaveBeenCalled();
        expect(new URL(wiring.getLastRollShareUrl()!).searchParams.get('ids')).toBe('0,2,3,4,5');
    });

    it('throws nothing when every die is held', async () => {
        hoisted.dice.forEach((d) => (d.kinematic = true));
        const { wiring, appEvents } = setup(host);
        const log = record(appEvents);
        await wiring.rollHandlerRef.roll?.(31);
        expect(log).toEqual([]);
        expect(hoisted.throwDice).not.toHaveBeenCalled();
    });
});

describe('a commit-reveal guest', () => {
    async function committed(ids: number[] | null) {
        const nonce = generateNonce();
        const commit = await createCommit(55, nonce, { dieCount: 6, source: 'ui', ids });
        return { nonce, commit };
    }

    it('replays exactly the committed slots', async () => {
        const { wiring, jail } = setup(guest);
        const { nonce, commit } = await committed([1, 4]);
        await wiring.handleRemoteCommit({ hash: commit.hash });
        await wiring.handleRemoteReveal({ seed: 55, nonce, source: 'ui', ids: [1, 4] });

        expect(jail.hold).toHaveBeenCalledWith([70, 72, 73, 75]);
        expect(hoisted.throwDice).toHaveBeenCalledWith(expect.anything(), null, 55, {
            ids: [71, 74],
        });
    });

    it('refuses a reveal whose slots differ from the commitment', async () => {
        const { wiring } = setup(guest);
        const { nonce, commit } = await committed([1, 4]);
        await wiring.handleRemoteCommit({ hash: commit.hash });
        await expect(
            wiring.handleRemoteReveal({ seed: 55, nonce, source: 'ui', ids: [1, 2] })
        ).rejects.toThrow('commit_mismatch');
        expect(hoisted.throwDice).not.toHaveBeenCalled();
    });

    it('refuses a subset revealed against a whole-table commitment', async () => {
        const { wiring } = setup(guest);
        const { nonce, commit } = await committed(null);
        await wiring.handleRemoteCommit({ hash: commit.hash });
        await expect(
            wiring.handleRemoteReveal({ seed: 55, nonce, source: 'ui', ids: [0] })
        ).rejects.toThrow('commit_mismatch');
    });
});
