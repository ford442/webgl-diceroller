/**
 * RollWiring's partial-throw paths: a game throws a subset and reads back what
 * *that* throw landed; the subset rides the share link (as table slots); a
 * link or message that names a subset throws exactly those dice and parks the
 * rest, so a replay does not depend on where a fresh spawn left them.
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

function setup(overrides: Record<string, unknown> = {}) {
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
        multiplayerRef: { current: null },
        getDiceJailController: () => jail,
        ...overrides,
    } as never);
    wiring.initRollSession({
        replaceDiceSet: vi.fn(),
        readAllDiceValues: () => [],
        areDiceSettled: () => true,
    });
    return { wiring, appEvents, jail, rollHistory, rollStats, setState };
}

/** What the camera controller emits once the dice settle: one row per spawned die. */
function settle(
    appEvents: ReturnType<typeof createAppEvents>,
    values: Array<number | null>,
    extra: Record<string, unknown> = {},
    cocked: number[] = []
) {
    appEvents.emit('roll:settled', {
        results: values.map((value, slot) => ({
            type: 'd6',
            value,
            ...(cocked.includes(slot) ? { cocked: true } : {}),
        })),
        timedOut: cocked.length > 0,
        reason: cocked.length > 0 ? 'simTimeout' : null,
        simSeconds: 1,
        ...extra,
    });
}

beforeEach(() => {
    // Body ids deliberately not 0..5: slots and ids must not be confused.
    hoisted.dice = Array.from({ length: 6 }, (_, i) => ({ type: 'd6', wasmId: 70 + i }));
    hoisted.throwDice.mockReset();
    hoisted.showResults.mockReset();
});

describe('throwSubset (a game throw)', () => {
    it('throws exactly the ids asked for and resolves with the faces they landed', async () => {
        const { wiring, appEvents } = setup();
        const pending = wiring.throwSubset([71, 74], 1234);

        expect(hoisted.throwDice).toHaveBeenCalledWith(expect.anything(), null, 1234, {
            ids: [71, 74],
        });
        // Dice 1 and 4 landed 6 and 2; the rest are held in the jail (their rows are irrelevant).
        settle(appEvents, [3, 6, 3, 3, 2, 3]);
        await expect(pending).resolves.toEqual({
            values: [6, 2],
            cocked: [],
            timedOut: false,
            reason: null,
            superseded: false,
        });
    });

    it('reports a die that never lay flat as cocked, and a timed-out roll as timed out', async () => {
        const { wiring, appEvents } = setup();
        const pending = wiring.throwSubset([70, 72], 5);
        settle(appEvents, [4, 1, 5, 1, 1, 1], {}, [2]);
        const out = await pending;
        expect(out.cocked).toEqual([72]);
        expect(out.timedOut).toBe(true);
        expect(out.reason).toBe('simTimeout');
        expect(out.values).toEqual([4, 5]);
    });

    it('treats an unreadable die as cocked rather than inventing a face', async () => {
        const { wiring, appEvents } = setup();
        const pending = wiring.throwSubset([70, 71], 5);
        settle(appEvents, [4, null, 1, 1, 1, 1]);
        expect((await pending).cocked).toEqual([71]);
    });

    it('says when another roll started before this one settled', async () => {
        const { wiring, appEvents } = setup();
        const pending = wiring.throwSubset([70], 5);
        appEvents.emit('roll:started', { seed: 99 });
        settle(appEvents, [1, 1, 1, 1, 1, 1]);
        expect((await pending).superseded).toBe(true);
    });

    it('moves the camera to wait for this roll, like every other throw', async () => {
        const { wiring, appEvents, setState } = setup();
        const pending = wiring.throwSubset([70], 5);
        expect(setState).toHaveBeenCalledWith('WAITING_FOR_STOP');
        settle(appEvents, [1, 1, 1, 1, 1, 1]);
        await pending;
    });

    it('keeps the generic results overlay out of a game, and history to the dice that moved', async () => {
        const { wiring, appEvents, rollHistory, rollStats } = setup();
        const pending = wiring.throwSubset([71, 74], 5);
        settle(appEvents, [3, 6, 3, 3, 2, 3]);
        await pending;

        // The overlay would list the jail's dice too, and its re-roll would throw outside the game.
        expect(hoisted.showResults).not.toHaveBeenCalled();
        // The held dice were not rolled: counting them again would skew fairness stats.
        expect(rollStats.recordResults).toHaveBeenCalledWith([
            { type: 'd6', value: 6 },
            { type: 'd6', value: 2 },
        ]);
        expect(rollHistory.appendRoll).toHaveBeenCalledTimes(1);
        expect(wiring.getRollState()).toMatchObject({ phase: 'settled', settledCount: 1 });
    });

    it('still shows the overlay for an ordinary roll', async () => {
        const { wiring, appEvents } = setup();
        await wiring.rollHandlerRef.roll?.(7);
        settle(appEvents, [1, 2, 3, 4, 5, 6]);
        expect(hoisted.showResults).toHaveBeenCalledTimes(1);
    });

    it('puts the moved slots, not the body ids, on the share link', async () => {
        const { wiring, appEvents } = setup();
        const pending = wiring.throwSubset([71, 74], 1234);
        settle(appEvents, [3, 6, 3, 3, 2, 3]);
        await pending;

        const url = new URL(wiring.getLastRollShareUrl()!);
        expect(url.searchParams.get('seed')).toBe('1234');
        expect(url.searchParams.get('ids')).toBe('1,4');
        expect(url.searchParams.get('v')).toBe('3');
        expect(url.searchParams.get('dice')).toBe('d6:6');
    });

    it('announces the slots on roll:started so a room can pass them on', () => {
        const { wiring, appEvents } = setup();
        const started: unknown[] = [];
        appEvents.on('roll:started', (p) => started.push(p));
        void wiring.throwSubset([71, 74], 1234);
        expect(started[0]).toMatchObject({ seed: 1234, source: 'game', ids: [1, 4] });
    });
});

describe('replaying a link that names a subset', () => {
    it('throws exactly those slots and parks the dice it leaves out', async () => {
        const { wiring, jail } = setup();
        await wiring.replayShareableRoll(new URLSearchParams('seed=99&v=3&dice=d6:6&ids=1,4'));

        expect(jail.hold).toHaveBeenCalledWith([70, 72, 73, 75]);
        expect(hoisted.throwDice).toHaveBeenCalledWith(expect.anything(), null, 99, {
            ids: [71, 74],
        });
        // The replay is itself a partial roll, so its link says so.
        expect(new URL(wiring.getLastRollShareUrl()!).searchParams.get('ids')).toBe('1,4');
    });

    it('opened twice names the same slots on different body ids', async () => {
        const first = setup();
        await first.wiring.replayShareableRoll(
            new URLSearchParams('seed=99&v=3&dice=d6:6&ids=1,4')
        );
        const firstCall = hoisted.throwDice.mock.calls[0]!;

        // A page that has burned more engine ids before the replay.
        hoisted.dice = hoisted.dice.map((d, i) => ({ ...d, wasmId: 200 + i }));
        hoisted.throwDice.mockClear();
        const second = setup();
        await second.wiring.replayShareableRoll(
            new URLSearchParams('seed=99&v=3&dice=d6:6&ids=1,4')
        );
        const secondCall = hoisted.throwDice.mock.calls[0]!;

        expect(firstCall[2]).toBe(secondCall[2]);
        expect(firstCall[3].ids.map((id: number) => id - 70)).toEqual(
            secondCall[3].ids.map((id: number) => id - 200)
        );
    });

    it('an old link with no ids still throws every die and parks nothing', async () => {
        const { wiring, jail } = setup();
        await wiring.replayShareableRoll(new URLSearchParams('seed=99&v=1&dice=d6:6'));
        expect(jail.hold).not.toHaveBeenCalled();
        expect(hoisted.throwDice).toHaveBeenCalledWith(expect.anything(), null, 99, {});
        expect(new URL(wiring.getLastRollShareUrl()!).searchParams.has('ids')).toBe(false);
    });

    it('does not re-park a die that is already held', async () => {
        hoisted.dice[0]!.kinematic = true;
        const { wiring, jail } = setup();
        await wiring.replayShareableRoll(new URLSearchParams('seed=99&v=3&dice=d6:6&ids=1,4'));
        expect(jail.hold).toHaveBeenCalledWith([72, 73, 75]);
    });
});

describe('a game claiming the roll key', () => {
    it("does not throw the free dice behind the rules' back", async () => {
        const interceptRoll = vi.fn(() => true);
        const { wiring } = setup({ interceptRoll });
        await wiring.rollHandlerRef.roll?.();
        expect(interceptRoll).toHaveBeenCalled();
        expect(hoisted.throwDice).not.toHaveBeenCalled();
    });

    it('rolls normally when no game is active', async () => {
        const { wiring } = setup({ interceptRoll: () => false });
        await wiring.rollHandlerRef.roll?.(5);
        expect(hoisted.throwDice).toHaveBeenCalledWith(expect.anything(), null, 5, {});
    });
});
