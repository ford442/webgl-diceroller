/**
 * Roll theatre: crit rules, playback arithmetic, and the controller's
 * contract (refuse mid-roll, crit cam only on a natural max/min, "live" hands
 * the table back) over a fake physics bridge. The real seek determinism is
 * packages/dice-core/test/replaySeek.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CRIT_REPLAY_RATE,
    advancePlayback,
    critReplayStartTick,
    findCritDice,
} from '../../src/app/rollTheatreModel.js';

const bridge = vi.hoisted(() => ({
    active: false,
    tick: 0,
    seeks: [] as number[],
    steps: [] as number[],
    engineTick: 1000,
}));

vi.mock('../../src/wasm/PhysicsBridge.js', () => ({
    isWasmAvailable: () => true,
    getWasmEngine: () => ({ getFixedTickCount: () => bridge.engineTick }),
    isReplayActive: () => bridge.active,
    replayEnter: async () => {
        bridge.active = true;
        return true;
    },
    replayExit: async () => {
        bridge.active = false;
        return true;
    },
    replaySeek: async (_base: unknown, _spec: unknown, ticks: number) => {
        bridge.seeks.push(ticks);
        bridge.tick = ticks;
        return { tick: ticks, ids: new Float32Array([0]), transforms: new Float32Array(7) };
    },
    replayStep: async (ticks: number) => {
        bridge.steps.push(ticks);
        bridge.tick += ticks;
        return { tick: bridge.tick, ids: new Float32Array([0]), transforms: new Float32Array(7) };
    },
}));

const record = vi.hoisted(() => ({
    current: null as null | Record<string, unknown>,
    matches: true,
}));

vi.mock('../../src/dice/ThrowRecord.js', () => ({
    getLastThrowRecord: () => record.current,
    throwRecordMatchesTable: () => record.matches,
}));

const { createRollTheatre } = await import('../../src/app/RollTheatre.js');
const { createAppEvents, AppEvent } = await import('../../src/core/AppEvents.js');

describe('findCritDice', () => {
    it('finds a natural max or min, max first and the bigger die first', () => {
        const crits = findCritDice([
            { type: 'd6', value: 1 },
            { type: 'd20', value: 20 },
            { type: 'd8', value: 8 },
            { type: 'd12', value: 7 },
        ]);
        expect(crits.map((c) => [c.slot, c.kind])).toEqual([
            [1, 'max'],
            [2, 'max'],
            [0, 'min'],
        ]);
    });

    it('ignores a cocked die, an unread die and a percentile digit', () => {
        expect(
            findCritDice([
                { type: 'd20', value: 20, cocked: true },
                { type: 'd6', value: null },
                { type: 'd10', value: 10, role: 'ones' },
            ])
        ).toEqual([]);
    });

    it('only counts the dice a partial throw moved', () => {
        const rows = [
            { type: 'd20', value: 20 },
            { type: 'd6', value: 3 },
        ];
        expect(findCritDice(rows, [1])).toEqual([]);
        expect(findCritDice(rows, [0])).toHaveLength(1);
    });
});

describe('playback arithmetic', () => {
    it('quarter speed runs one tick per four ticks of wall time', () => {
        let carry = 0;
        let ticks = 0;
        for (let frame = 0; frame < 120; frame++) {
            const step = advancePlayback(carry, 1 / 120, CRIT_REPLAY_RATE);
            carry = step.carry;
            ticks += step.ticks;
        }
        expect(ticks).toBe(30);
    });

    it('a long frame cannot leap through the replay', () => {
        expect(advancePlayback(0, 5, 1).ticks).toBe(30);
    });

    it('the crit replay starts 1.5 s before the settle, never before the throw', () => {
        expect(critReplayStartTick(400)).toBe(220);
        expect(critReplayStartTick(100)).toBe(0);
    });
});

describe('createRollTheatre', () => {
    let events: ReturnType<typeof createAppEvents>;
    let rolling: boolean;

    function settle(results: Array<{ type: string; value: number; cocked?: boolean }>) {
        const base = { snapshot: new Uint8Array([1]), startTick: 600 };
        record.current = {
            spec: { kind: 'throw', seed: 7, dice: [{ id: 0, index: 0 }], tableSurfaceY: 1 },
            base: Promise.resolve(base),
            resolvedBase: base,
            tableIds: [0],
            heldIds: [],
            serial: 1,
        };
        bridge.engineTick = 1000;
        rolling = false;
        events.emit(AppEvent.ROLL_SETTLED, { results });
    }

    beforeEach(() => {
        events = createAppEvents();
        rolling = false;
        bridge.active = false;
        bridge.seeks = [];
        bridge.steps = [];
        record.current = null;
        record.matches = true;
    });

    it('refuses a seek while a throw is in flight', async () => {
        const theatre = createRollTheatre({ appEvents: events, isRolling: () => rolling });
        settle([{ type: 'd6', value: 3 }]);
        events.emit(AppEvent.ROLL_STARTED, {});
        rolling = true;
        expect(theatre.refusal()).toBe('rolling');
        expect(await theatre.seek(10)).toBeNull();
        expect(bridge.seeks).toEqual([]);
        expect(bridge.active).toBe(false);
    });

    it('seeks within the timeline (throw → settle) and goes live', async () => {
        const theatre = createRollTheatre({ appEvents: events, isRolling: () => rolling });
        settle([{ type: 'd6', value: 3 }]);
        expect(theatre.getState()).toMatchObject({ available: true, endTick: 400 });
        expect((await theatre.seek(9999))?.tick).toBe(400);
        expect(theatre.getState().active).toBe(true);
        await theatre.live();
        expect(bridge.active).toBe(false);
        expect(theatre.getState().active).toBe(false);
    });

    it('refuses an unseeded roll and a table that changed since', async () => {
        const theatre = createRollTheatre({ appEvents: events });
        events.emit(AppEvent.ROLL_SETTLED, { results: [] });
        expect(theatre.refusal()).toBe('unseeded');
        settle([{ type: 'd6', value: 3 }]);
        record.matches = false;
        expect(theatre.refusal()).toBe('table-changed');
    });

    it('crit cam plays a natural 20 at quarter speed to the settle, then goes live', async () => {
        const theatre = createRollTheatre({ appEvents: events });
        settle([{ type: 'd20', value: 20 }]);
        const run = theatre.beginCrit();
        expect(run?.crit.slot).toBe(0);
        await vi.waitFor(() => expect(theatre.getState().playing).toBe(true));
        expect(bridge.seeks).toEqual([220]);
        expect(theatre.getState().rate).toBe(CRIT_REPLAY_RATE);
        let resolved = false;
        void run!.done.then(() => (resolved = true));
        for (let i = 0; i < 2000 && !resolved; i++) {
            theatre.update(1 / 30);
            await Promise.resolve();
            await Promise.resolve();
        }
        expect(resolved).toBe(true);
        expect(bridge.tick).toBe(400);
        expect(bridge.active).toBe(false);
    });

    it('no crit cam for an ordinary or a cocked roll', () => {
        const theatre = createRollTheatre({ appEvents: events });
        settle([{ type: 'd20', value: 13 }]);
        expect(theatre.beginCrit()).toBeNull();
        settle([{ type: 'd20', value: 20, cocked: true }]);
        expect(theatre.beginCrit()).toBeNull();
    });

    it('skipping the crit replay resolves it and hands the table back', async () => {
        const theatre = createRollTheatre({ appEvents: events });
        settle([{ type: 'd6', value: 1 }]);
        const run = theatre.beginCrit();
        await vi.waitFor(() => expect(theatre.getState().playing).toBe(true));
        await theatre.skip();
        await run!.done;
        expect(bridge.active).toBe(false);
        expect(theatre.getState()).toMatchObject({ active: false, crit: false, playing: false });
    });
});
