// @vitest-environment node
/**
 * InputLog and applyTableInput without the engine: what a peer's record may
 * hold, the one order every peer applies inputs in, and the engine calls each
 * input becomes (#366). The WASM side is lockstep.test.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
    InputLog,
    InputLogError,
    MAX_CUP_PLANES,
    MAX_INPUT_DICE,
    compareTickInputs,
    parseTableInput,
    parseTickInput,
    type TickInput,
} from 'dice-core/net/InputLog';
import {
    applyTableInput,
    defaultDieMaterial,
    type TableInputEngine,
} from 'dice-core/net/applyTableInput';

const rec = (tick: number, seat: number, seq: number, input: unknown): TickInput =>
    ({ tick, seat, seq, input }) as TickInput;

describe('parseTableInput', () => {
    it.each([
        ['an unknown type', { type: 'teleport', id: 0 }],
        ['a non-finite position', { type: 'drag', body: 'die', id: 0, position: [0, NaN, 0] }],
        ['an infinite impulse', { type: 'impulse', body: 'die', id: 0, impulse: [Infinity, 0, 0] }],
        ['an absurd coordinate', { type: 'drag', body: 'die', id: 0, position: [1e30, 0, 0] }],
        ['a short vector', { type: 'drag', body: 'die', id: 0, position: [0, 0] }],
        [
            'a zero quaternion',
            { type: 'drag', body: 'die', id: 0, position: [0, 0, 0], rotation: [0, 0, 0, 0] },
        ],
        ['a fractional id', { type: 'remove', id: 1.5 }],
        ['a negative id', { type: 'grab', body: 'die', id: -1 }],
        ['an unknown body kind', { type: 'grab', body: 'wall', id: 0 }],
        ['a seven-sided die', { type: 'spawn', sides: 7, position: [0, 0, 0] }],
        ['planes that are not quads', { type: 'cupShake', planes: [0, 1, 0] }],
        [
            'too many cup walls',
            { type: 'cupShake', planes: new Array(4 * (MAX_CUP_PLANES + 1)).fill(0) },
        ],
        ['an empty throw', { type: 'throw', seed: 1, dice: [], tableSurfaceY: 1 }],
        [
            'an oversized throw',
            {
                type: 'throw',
                seed: 1,
                dice: Array.from({ length: MAX_INPUT_DICE + 1 }, (_, id) => ({ id, index: id })),
                tableSurfaceY: 1,
            },
        ],
        [
            'a negative seed',
            { type: 'throw', seed: -1, dice: [{ id: 0, index: 0 }], tableSurfaceY: 1 },
        ],
        [
            'a hopper frame with a missing axis',
            {
                type: 'towerDrop',
                seed: 1,
                dice: [{ id: 0, index: 0 }],
                frame: { origin: { x: 0, y: 0, z: 0 }, y: 1, halfWidth: 1, halfDepth: 1 },
            },
        ],
        ['not an object', 'grab'],
    ])('refuses %s', (_why, input) => {
        expect(() => parseTableInput(input)).toThrow(InputLogError);
    });

    it('names the field it refused', () => {
        expect(() =>
            parseTickInput(
                rec(3, 0, 0, { type: 'drag', body: 'die', id: 0, position: [0, 0, 'x'] })
            )
        ).toThrow(/record\.input\.position\[2\]/);
    });

    it('returns a fresh object in one key order, without strangers or -0', () => {
        const a = parseTableInput({
            torque: [0, -0, 1],
            id: 4,
            extra: 'dropped',
            body: 'die',
            type: 'impulse',
        });
        const b = parseTableInput({ type: 'impulse', body: 'die', id: 4, torque: [0, 0, 1] });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a).not.toHaveProperty('extra');
        expect(a).not.toHaveProperty('impulse');
    });

    it.each([
        ['tick', { tick: -1 }],
        ['tick', { tick: 2.5 }],
        ['seat', { seat: 256 }],
        ['seq', { seq: -3 }],
    ])('refuses a bad %s', (_field, patch) => {
        expect(() => parseTickInput({ ...rec(1, 0, 0, { type: 'cupPour' }), ...patch })).toThrow(
            InputLogError
        );
    });
});

describe('InputLog', () => {
    const pour = { type: 'cupPour' } as const;

    it('applies in tick, then seat, then seq order whatever order records arrive in', () => {
        const log = new InputLog();
        for (const r of [
            rec(5, 1, 0, pour),
            rec(2, 0, 1, pour),
            rec(5, 0, 7, pour),
            rec(2, 0, 0, pour),
        ]) {
            expect(log.insert(r)).toBe('inserted');
        }
        expect(log.toJSON().map((r) => [r.tick, r.seat, r.seq])).toEqual([
            [2, 0, 0],
            [2, 0, 1],
            [5, 0, 7],
            [5, 1, 0],
        ]);
        expect(log.at(5).map((r) => r.seat)).toEqual([0, 1]);
        expect(log.at(3)).toEqual([]);
        expect(log.since(3).map((r) => r.tick)).toEqual([5, 5]);
        expect([log.firstTick, log.lastTick, log.size]).toEqual([2, 5, 4]);
    });

    it('takes a resend as a duplicate and a reused name as a conflict', () => {
        const log = new InputLog();
        const grab = rec(9, 1, 3, { type: 'grab', body: 'die', id: 2 });
        expect(log.insert(grab)).toBe('inserted');
        expect(log.insert(structuredClone(grab))).toBe('duplicate');
        expect(log.insert(rec(9, 1, 3, { type: 'grab', body: 'die', id: 5 }))).toBe('conflict');
        expect(log.size).toBe(1);
        expect(() => InputLog.from([grab, rec(9, 1, 3, pour)])).toThrow(/conflicts/);
    });

    it('forgets records before a tick, names included', () => {
        const log = InputLog.from([rec(1, 0, 0, pour), rec(4, 0, 1, pour), rec(8, 0, 2, pour)]);
        expect(log.pruneBefore(5)).toBe(2);
        expect(log.toJSON().map((r) => r.tick)).toEqual([8]);
        // A pruned name may be used again: it can no longer be told from new.
        expect(log.insert(rec(1, 0, 0, pour))).toBe('inserted');
    });

    it('builds the same log from any permutation of its records', () => {
        const records = fc
            .uniqueArray(
                fc.record({
                    tick: fc.integer({ min: 0, max: 50 }),
                    seat: fc.integer({ min: 0, max: 3 }),
                    seq: fc.integer({ min: 0, max: 20 }),
                }),
                {
                    selector: (r) => `${r.tick}:${r.seat}:${r.seq}`,
                    minLength: 1,
                    maxLength: 40,
                }
            )
            .map((keys) => keys.map((k) => rec(k.tick, k.seat, k.seq, pour)));
        fc.assert(
            fc.property(
                records.chain((rs) =>
                    fc.tuple(fc.constant(rs), fc.shuffledSubarray(rs, { minLength: rs.length }))
                ),
                ([ordered, shuffled]) => {
                    const sorted = [...ordered].sort(compareTickInputs);
                    expect(InputLog.from(shuffled).toJSON()).toEqual(sorted);
                }
            )
        );
    });
});

/** A recording engine double: every call, in order, plus a transform buffer. */
function recordingEngine(dice: [number, number[]][] = []) {
    const calls: string[] = [];
    let nextId = dice.length;
    const log =
        (name: string) =>
        (...args: unknown[]) => {
            calls.push(`${name}(${args.map((a) => (Array.isArray(a) ? `[${a}]` : a)).join(',')})`);
        };
    const engine: TableInputEngine = {
        addDie: (...args: number[]) => {
            log('addDie')(...args);
            return nextId++;
        },
        removeDie: log('removeDie'),
        setDieMaterial: log('setDieMaterial'),
        setDieDrag: log('setDieDrag'),
        setDieKinematic: log('setDieKinematic'),
        setContainerActive: log('setContainerActive'),
        setContainerPlanes: log('setContainerPlanes'),
        setDynamicKinematic: log('setDynamicKinematic'),
        setDynamicTransform: log('setDynamicTransform'),
        applyDynamicImpulse: log('applyDynamicImpulse'),
        applyDynamicTorqueImpulse: log('applyDynamicTorqueImpulse'),
        setDieTransform: log('setDieTransform'),
        setDieVelocity: log('setDieVelocity'),
        applyImpulse: log('applyImpulse'),
        applyTorqueImpulse: log('applyTorqueImpulse'),
        randomFloat: () => 0.25,
        getDieIds: () => Float32Array.from(dice.map(([id]) => id)),
        getTransforms: () => Float32Array.from(dice.flatMap(([, xf]) => xf)),
        getDynamicIds: () => new Float32Array(0),
        getDynamicTransforms: () => new Float32Array(0),
    };
    const host = { seedRng: log('seedRng'), attachHull: log('attachHull') };
    return { engine, host, calls };
}

describe('applyTableInput', () => {
    it("spawns a die with its shape's preset and hull, and reports its id", () => {
        const { engine, host, calls } = recordingEngine();
        const id = applyTableInput(engine, host, { type: 'spawn', sides: 20, position: [1, 2, 3] });
        const m = defaultDieMaterial(20);
        expect(id).toBe(0);
        expect(calls).toEqual([
            'addDie(20,1,2,3)',
            `setDieMaterial(0,${m.friction},${m.rollingFriction})`,
            `setDieDrag(0,${m.drag})`,
            'attachHull(0,20)',
        ]);
    });

    it('drags a held die without turning it, and releases it with its impulse', () => {
        const { engine, host, calls } = recordingEngine([[4, [0, 0, 0, 0.6, 0, 0, 0.8]]]);
        applyTableInput(engine, host, { type: 'grab', body: 'die', id: 4 });
        applyTableInput(engine, host, { type: 'drag', body: 'die', id: 4, position: [1, 5, -1] });
        applyTableInput(engine, host, { type: 'drag', body: 'die', id: 9, position: [1, 5, -1] });
        applyTableInput(engine, host, { type: 'release', body: 'die', id: 4, impulse: [6, 0, 4] });
        expect(calls).toEqual([
            'setDieKinematic(4,true)',
            // Float32 round trip of the engine's own 0.6 / 0.8.
            `setDieTransform(4,1,5,-1,${Math.fround(0.6)},0,0,${Math.fround(0.8)})`,
            // Die 9 is not on the table: nothing to move.
            'setDieKinematic(4,false)',
            'applyImpulse(4,6,0,4)',
        ]);
    });

    it('scoops dice into the cup before its walls go up, and pours by dropping them', () => {
        const { engine, host, calls } = recordingEngine([[0, [0, 0, 0, 0, 0, 0, 1]]]);
        const planes = [0, 1, 0, 1];
        applyTableInput(engine, host, {
            type: 'cupScoop',
            dice: [{ id: 0, position: [0, 2, 0] }],
            planes,
        });
        applyTableInput(engine, host, { type: 'cupPour' });
        expect(calls).toEqual([
            'setDieTransform(0,0,2,0,0,0,0,1)',
            'setContainerPlanes([0,1,0,1])',
            'setContainerActive(true)',
            'setContainerActive(false)',
        ]);
    });

    it('seeds the engine before a throw draws from it', () => {
        const { engine, host, calls } = recordingEngine([[0, [0, 0, 0, 0, 0, 0, 1]]]);
        applyTableInput(engine, host, {
            type: 'throw',
            seed: 77,
            dice: [{ id: 0, index: 0 }],
            tableSurfaceY: 1,
        });
        expect(calls[0]).toBe('seedRng(77)');
        expect(calls.slice(1).map((c) => c.split('(')[0])).toEqual([
            'setDieTransform',
            'setDieVelocity',
            'applyImpulse',
            'applyTorqueImpulse',
        ]);
    });
});
