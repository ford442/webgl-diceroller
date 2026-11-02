/**
 * The jail as the kept set (src/interaction/DiceJailController.ts): hold(ids)
 * parks and holds exactly those dice, release(ids) frees them where they lie,
 * getState() names the held ids, and a locked jail ignores the click toggle.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeDie {
    wasmId: number;
    mesh: THREE.Object3D;
    kinematic?: boolean;
}

const hoisted = vi.hoisted(() => ({
    dice: [] as FakeDie[],
    kinematicCalls: [] as Array<{ wasmId: number; kinematic: boolean }>,
    driven: [] as Array<{ wasmId: number; pos: { x: number; y: number; z: number } }>,
}));

vi.mock('../../src/dice.js', () => ({
    get spawnedDice() {
        return hoisted.dice;
    },
    findSpawnedDieByPhysicsId: (id: number) => hoisted.dice.find((d) => d.wasmId === id) ?? null,
    driveDieWasmTransform: (mesh: THREE.Object3D, pos: THREE.Vector3) => {
        const die = hoisted.dice.find((d) => d.mesh === mesh)!;
        hoisted.driven.push({ wasmId: die.wasmId, pos: { x: pos.x, y: pos.y, z: pos.z } });
    },
    setDieWasmVelocity: () => {},
    setDieWasmKinematic: (mesh: THREE.Object3D, kinematic: boolean) => {
        const die = hoisted.dice.find((d) => d.mesh === mesh)!;
        die.kinematic = kinematic;
        hoisted.kinematicCalls.push({ wasmId: die.wasmId, kinematic });
    },
}));
vi.mock('../../src/wasm/PhysicsBridge.js', () => ({ isWasmAvailable: () => true }));

const { createDiceJailController } = await import('../../src/interaction/DiceJailController.js');

function makeJail() {
    const group = new THREE.Group();
    group.position.set(-13, 0, -13);
    return {
        group,
        halfExtents: { x: 0.8, y: 1, z: 0.8 },
        interiorCenter: { x: 0, y: 1, z: 0 },
    };
}

beforeEach(() => {
    hoisted.dice = Array.from({ length: 6 }, (_, i) => {
        const mesh = new THREE.Object3D();
        mesh.position.set(i, 1, 0);
        return { wasmId: 100 + i, mesh };
    });
    hoisted.kinematicCalls.length = 0;
    hoisted.driven.length = 0;
});

describe('DiceJailController as the kept set', () => {
    it('holds exactly the ids it is given and reports them', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        expect(jail.hold([101, 104])).toBe(2);
        expect(jail.getState()).toMatchObject({ held: true, heldCount: 2, heldIds: [101, 104] });
        expect(hoisted.dice.filter((d) => d.kinematic).map((d) => d.wasmId)).toEqual([101, 104]);
    });

    it('holding an already-held die is a no-op, not a re-park', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        jail.hold([101]);
        const first = hoisted.driven.find((d) => d.wasmId === 101)!.pos;
        hoisted.driven.length = 0;
        expect(jail.hold([101, 102])).toBe(1);
        expect(hoisted.driven.map((d) => d.wasmId)).toEqual([102]);
        // The earlier die was not moved, and the new one did not land on it.
        const second = hoisted.driven[0]!.pos;
        expect(Math.hypot(first.x - second.x, first.z - second.z)).toBeGreaterThan(1);
    });

    it('gives dice held in separate set-asides separate parking slots', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        jail.hold([100]);
        jail.hold([101]);
        jail.hold([102]);
        const spots = hoisted.driven.map((d) => d.pos);
        for (let a = 0; a < spots.length; a++) {
            for (let b = a + 1; b < spots.length; b++) {
                expect(
                    Math.hypot(spots[a]!.x - spots[b]!.x, spots[a]!.z - spots[b]!.z)
                ).toBeGreaterThan(2);
            }
        }
    });

    it('release(ids) frees only those dice and leaves them where they are', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        jail.hold([100, 101, 102]);
        hoisted.driven.length = 0;
        expect(jail.release([101])).toBe(1);
        expect(jail.getState().heldIds).toEqual([100, 102]);
        expect(hoisted.dice.find((d) => d.wasmId === 101)!.kinematic).toBe(false);
        // Releasing is setDieKinematic(false) and nothing else: no pose, no kick.
        expect(hoisted.driven).toEqual([]);
    });

    it('release() with no ids frees everything; unknown ids are ignored', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        jail.hold([100, 101]);
        expect(jail.release([999])).toBe(0);
        expect(jail.release()).toBe(2);
        expect(jail.getState()).toMatchObject({ held: false, heldCount: 0, heldIds: [] });
    });

    it('a freed slot is reused by the next die held', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        jail.hold([100, 101]);
        const slotOne = hoisted.driven.find((d) => d.wasmId === 101)!.pos;
        jail.release([101]);
        hoisted.driven.length = 0;
        jail.hold([105]);
        expect(hoisted.driven[0]!.pos).toEqual(slotOne);
    });

    it('forgets a held die that left the table', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        jail.hold([100, 101]);
        hoisted.dice = hoisted.dice.filter((d) => d.wasmId !== 100);
        expect(jail.getState().heldIds).toEqual([101]);
    });

    it('the click toggle still holds nearby dice, then releases them', () => {
        const jail = createDiceJailController({ jailProp: makeJail() });
        hoisted.dice[0]!.mesh.position.set(-13, 1, -13);
        jail.trigger();
        expect(jail.getState().heldIds).toEqual([100]);
        jail.trigger();
        expect(jail.getState().held).toBe(false);
    });

    it('a locked jail ignores the click toggle but still obeys hold/release', () => {
        const onFeedback = vi.fn();
        const jail = createDiceJailController({ jailProp: makeJail(), onFeedback });
        jail.hold([100]);
        jail.setLocked('Farkle owns the jail');
        jail.trigger();
        expect(onFeedback).toHaveBeenCalledWith('Farkle owns the jail');
        expect(jail.getState()).toMatchObject({ heldIds: [100], locked: true });
        jail.release([100]);
        expect(jail.getState().held).toBe(false);
        jail.setLocked(null);
        expect(jail.getState().locked).toBe(false);
    });
});
