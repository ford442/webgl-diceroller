import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    canonicalWorldText,
    hashWorld,
    installWorldRecorder,
    parseWorldFixtureFile,
    serializeWorldFixtureFile,
    type WorldFixture,
} from '../src/wasm/WorldRecorder.js';
import type { PhysicsEngine } from '../src/wasm/physicsTypes.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function box(id: number, x: number): WorldFixture['statics'][number] {
    return {
        type: 'box',
        id,
        center: [x, 0, 0],
        halfExtents: [1, 1, 1],
        rotation: [0, 0, 0, 1],
        material: 0,
    };
}

const world = (statics: WorldFixture['statics']): WorldFixture => ({
    version: 1,
    init: { gravity: -15, tableY: -2.75, tableHalfW: 18, tableHalfD: 18 },
    statics,
    dynamics: [],
});

describe('hashWorld', () => {
    it('ignores collider ids and registration order', () => {
        const a = world([box(10000, 1), box(10001, 2), box(10002, 3)]);
        // Same colliders, different ids (a re-rolled client's counter ran on)
        // and a different order (re-rolled clutter registers last).
        const b = world([box(10042, 3), box(10040, 1), box(10041, 2)]);
        expect(hashWorld(b)).toBe(hashWorld(a));
    });

    it('moves when any collider moves, appears or disappears', () => {
        const base = world([box(1, 1), box(2, 2)]);
        const moved = world([box(1, 1), box(2, 2.00002)]);
        const extra = world([box(1, 1), box(2, 2), box(3, 3)]);
        const fewer = world([box(1, 1)]);
        const hashes = new Set([base, moved, extra, fewer].map(hashWorld));
        expect(hashes.size).toBe(4);
        expect(hashWorld(base)).toMatch(/^[0-9a-f]{16}$/);
    });

    it('moves with the init block and the dynamics', () => {
        const base = world([box(1, 1)]);
        const taller = { ...base, init: { ...base.init!, tableY: -2.5 } };
        const withDynamic: WorldFixture = {
            ...base,
            dynamics: [
                {
                    type: 'box',
                    id: 20000,
                    mass: 1,
                    center: [0, 0, 0],
                    halfExtents: [1, 1, 1],
                    rotation: [0, 0, 0, 1],
                    material: 0,
                },
            ],
        };
        expect(new Set([base, taller, withDynamic].map(hashWorld)).size).toBe(3);
    });

    it('hashes the canonical text', () => {
        const w = world([box(1, 1)]);
        expect(canonicalWorldText(w)).not.toContain('"id"');
    });
});

describe('installWorldRecorder().worldHash', () => {
    function fakeEngine() {
        let nextAnswer = 1;
        const engine = {
            init: () => {},
            reset: () => {},
            clearStatics: () => {},
            removeStatic: () => true,
            addStaticBox: () => nextAnswer,
            addStaticPlane: () => nextAnswer,
            addStaticConvexHull: () => nextAnswer,
            addStaticOpenCylinder: () => nextAnswer,
            clearDynamics: () => {},
            removeDynamic: () => true,
            addDynamicBox: () => nextAnswer,
            addDynamicHull: () => nextAnswer,
            addDie: () => 0,
            removeDie: () => {},
            clearAllDice: () => {},
        };
        return { engine: engine as unknown as PhysicsEngine, reject: () => (nextAnswer = -1) };
    }

    const addBox = (engine: PhysicsEngine, id: number, x: number) =>
        engine.addStaticBox(id, x, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0);

    it('hashes what was registered, under any ids, and tracks removals', () => {
        const a = fakeEngine();
        const recA = installWorldRecorder(a.engine);
        a.engine.init(-15, -2.75, 18, 18);
        addBox(a.engine, 10000, 1);
        addBox(a.engine, 10001, 2);

        const b = fakeEngine();
        const recB = installWorldRecorder(b.engine);
        b.engine.init(-15, -2.75, 18, 18);
        addBox(b.engine, 10500, 2);
        addBox(b.engine, 10501, 1);

        expect(recB.worldHash()).toBe(recA.worldHash());
        expect(recA.worldHash()).toBe(hashWorld(recA.exportWorld()));

        const before = recA.worldHash();
        a.engine.removeStatic(10001);
        expect(recA.worldHash()).not.toBe(before);
    });

    it('does not count colliders the engine rejected', () => {
        const a = fakeEngine();
        const rec = installWorldRecorder(a.engine);
        a.engine.init(-15, -2.75, 18, 18);
        const empty = rec.worldHash();
        a.reject();
        addBox(a.engine, 10000, 1);
        expect(rec.worldHash()).toBe(empty);
    });
});

describe('world fixture file', () => {
    it('round-trips through serialize / parse and rejects a stale hash', () => {
        const w = world([box(1, 1), box(2, 2)]);
        const file = { hash: hashWorld(w), world: w };
        const text = serializeWorldFixtureFile(file);
        expect(parseWorldFixtureFile(text)).toEqual(file);
        // One collider per line keeps a moved prop a one-line diff.
        expect(text.split('\n').filter((line) => line.includes('"type":"box"'))).toHaveLength(2);

        const tampered = text.replace('"center":[2,0,0]', '"center":[9,0,0]');
        expect(() => parseWorldFixtureFile(tampered)).toThrow(/does not match its world/);
        expect(() => parseWorldFixtureFile('{"statics":[]}')).toThrow(/\{ hash, world \}/);
    });

    it('the checked-in tavern fixture still cites the hash of its world', () => {
        const text = readFileSync(path.join(REPO_ROOT, 'tests/fixtures/tavern-world.json'), 'utf8');
        const { hash, world: tavern } = parseWorldFixtureFile(text);
        expect(hash).toBe(hashWorld(tavern));
        expect(serializeWorldFixtureFile({ hash, world: tavern })).toBe(text);
    });
});
