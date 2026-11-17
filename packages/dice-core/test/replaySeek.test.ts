// @vitest-environment node
/**
 * Roll theatre, engine side: seeking a recorded throw re-simulates it on the
 * table's own engine. Seeking to tick N twice gives identical poses, seeking
 * to the settle lands where the live roll landed, and replayExit puts the
 * live table back byte for byte. Runs the in-process bridge (the worker runs
 * the same replayThrow.ts calls) over the recorded tavern collider world.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import {
    PHYSICS_GRAVITY,
    PHYSICS_TABLE_HALF,
    PHYSICS_TABLE_Y,
    THROW_TABLE_SURFACE_Y,
    defaultHeadlessAssets,
} from 'dice-core';
import * as bridge from 'dice-core/wasm/WasmPhysicsBridge';
import { applyWorld, parseWorldFixtureFile } from 'dice-core/wasm/WorldRecorder';
import type { ReplayThrowSpec } from 'dice-core/wasm/replayThrow';
import type { PhysicsEngine } from 'dice-core/wasm/physicsTypes';
import { describeWasm } from './wasmGate.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { world } = parseWorldFixtureFile(
    readFileSync(path.join(REPO_ROOT, 'tests/fixtures/tavern-world.json'), 'utf8')
);

const SIDES = [20, 6, 8, 12];

function stepTicks(engine: PhysicsEngine, n: number): void {
    for (let i = 0; i < n; i++) engine.step(1 / 120);
}

describeWasm('roll replay seek', () => {
    let engine: PhysicsEngine;
    let spec: ReplayThrowSpec;

    beforeAll(async () => {
        expect(await bridge.loadWasmEngine({ assets: defaultHeadlessAssets(), quiet: true })).toBe(
            true
        );
        engine = bridge.getWasmEngine();
        engine.init(PHYSICS_GRAVITY, PHYSICS_TABLE_Y, PHYSICS_TABLE_HALF, PHYSICS_TABLE_HALF);
        applyWorld(engine, world);
        const dice = SIDES.map((sides, index) => {
            const id = engine.addDie(sides, index * 2 - 3, THROW_TABLE_SURFACE_Y + 1, 0);
            bridge.loadHullForDie(id, sides);
            return { id, index };
        });
        // Let the spawned dice come to rest, so the throw starts from a real table.
        stepTicks(engine, 600);
        spec = { kind: 'throw', seed: 0x5eed1234, dice, tableSurfaceY: THROW_TABLE_SURFACE_Y };
    });

    it('seeks twice to the same tick with identical transforms, and back to live', async () => {
        const base = await bridge.recordSeededThrow(spec);
        expect(base).not.toBeNull();
        expect(base!.snapshot.byteLength).toBeGreaterThan(0);
        // The live roll, to the settle (or the 12 s cap).
        let ticks = 0;
        while (ticks < 1440 && !engine.areAllSettled()) {
            stepTicks(engine, 1);
            ticks++;
        }
        const liveBytes = engine.serializeState();
        const liveTransforms = Array.from(engine.getTransforms());
        const faces = Array.from(engine.getFaceValues());

        expect(await bridge.replayEnter()).toBe(true);
        expect(bridge.isReplayActive()).toBe(true);

        const a = await bridge.replaySeek(base!, spec, 97);
        const b = await bridge.replaySeek(base!, spec, 97);
        expect(a?.tick).toBe(97);
        expect(Array.from(a!.transforms)).toEqual(Array.from(b!.transforms));
        // Mid-flight is not the settled pose.
        expect(Array.from(a!.transforms)).not.toEqual(liveTransforms);

        // Seek, then play on: 50 + 47 steps is tick 97 again.
        await bridge.replaySeek(base!, spec, 50);
        const stepped = await bridge.replayStep(47);
        expect(stepped?.tick).toBe(97);
        expect(Array.from(stepped!.transforms)).toEqual(Array.from(a!.transforms));

        // The seek re-simulates the roll itself: at the settle tick it lands
        // on the faces the live roll did.
        const end = await bridge.replaySeek(base!, spec, ticks);
        expect(Array.from(end!.transforms)).toEqual(liveTransforms);
        expect(Array.from(engine.getFaceValues())).toEqual(faces);

        expect(await bridge.replayExit()).toBe(true);
        expect(bridge.isReplayActive()).toBe(false);
        expect(Array.from(engine.serializeState())).toEqual(Array.from(liveBytes));
    });

    it('refuses a seek outside a replay and a base from a different dice set', async () => {
        const base = await bridge.recordSeededThrow(spec);
        expect(await bridge.replaySeek(base!, spec, 10)).toBeNull();
        stepTicks(engine, 240);

        const extra = engine.addDie(4, 0, THROW_TABLE_SURFACE_Y + 1, 0);
        bridge.loadHullForDie(extra, 4);
        const before = Array.from(engine.serializeState());
        expect(await bridge.replayEnter()).toBe(true);
        expect(await bridge.replaySeek(base!, spec, 10)).toBeNull();
        expect(await bridge.replayExit()).toBe(true);
        expect(Array.from(engine.serializeState())).toEqual(before);
        engine.removeDie(extra);
    });
});
