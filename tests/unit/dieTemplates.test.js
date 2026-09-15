/**
 * A die key's template must follow the shape its descriptor entry names.
 *
 * `shape` is part of the `DiceSet`, so an incoming set — a share link, a peer's
 * presence payload — can change which hull a key rides. A template cached from
 * the old shape leaves the table showing one die while physics simulates
 * another, which is invisible until a roll disagrees with what the player sees.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { diceModels, diceMeshPool, spawnedDice } from '../../src/dice/DiceState.js';
import {
    ensureDieTemplate,
    getDieTemplate,
    resetDieTemplatesForTests,
} from '../../src/dice/DiceModels.js';
import { createDefaultDiceSet, withComputedId } from '../../src/dice/DiceSetFormat.js';
import { resetDiceSetRuntimeForTests, setActiveDiceSet } from '../../src/dice/DiceSetRuntime.js';

/** A stand-in hull: the loader's output, minus the GLB. */
function fakeHull(shape) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.userData.hullShape = shape;
    mesh.userData.faceNormals = [];
    mesh.userData.faceValues = [];
    return mesh;
}

function useSet(mutate) {
    const set = createDefaultDiceSet();
    mutate?.(set);
    setActiveDiceSet(withComputedId(set), { persist: false, url: false });
}

describe('die templates', () => {
    beforeEach(() => {
        resetDiceSetRuntimeForTests();
        resetDieTemplatesForTests();
        spawnedDice.length = 0;
        for (const key of Object.keys(diceModels)) delete diceModels[key];
        for (const key of Object.keys(diceMeshPool)) delete diceMeshPool[key];
        for (const shape of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
            diceModels[shape] = fakeHull(shape);
        }
        useSet();
    });

    it('rides the hull its catalog entry names', () => {
        expect(ensureDieTemplate('d6').userData.hullShape).toBe('d6');
        // dF has no mesh of its own — it is a d6 hull with its own numbering.
        expect(ensureDieTemplate('dF').userData.hullShape).toBe('d6');
        expect(ensureDieTemplate('d100').userData.hullShape).toBe('d10');
    });

    it('is a template, not the hull itself', () => {
        const template = ensureDieTemplate('d6');
        expect(template).not.toBe(diceModels.d6);
        expect(getDieTemplate('d6')).toBe(template);
    });

    it('rebuilds when the set re-shapes a die key', () => {
        const before = ensureDieTemplate('d6');
        expect(before.userData.hullShape).toBe('d6');

        useSet((set) => {
            set.dice.d6 = { ...set.dice.d6, shape: 'd8' };
        });

        const after = ensureDieTemplate('d6');
        expect(after).not.toBe(before);
        expect(after.userData.hullShape).toBe('d8');
        expect(after.userData.builtForShape).toBe('d8');
    });

    it('re-points dice already on the table at the new hull', () => {
        const template = ensureDieTemplate('d6');
        const mesh = template.clone();
        spawnedDice.push({
            mesh,
            type: 'd6',
            wasmId: 1,
            physicsPreset: { mass: 5, friction: 0.6, rollingFriction: 0.1 },
        });
        diceMeshPool.d6 = [template.clone()];

        useSet((set) => {
            set.dice.d6 = { ...set.dice.d6, shape: 'd20' };
        });
        const reshaped = ensureDieTemplate('d6');

        expect(mesh.geometry).toBe(reshaped.geometry);
        // The preset is cleared so the next sync recomputes it from the new
        // shape rather than simulating the hull this die no longer has.
        expect(spawnedDice[0].physicsPreset).toBeNull();
        // Pooled clones are stale geometry nobody is using; they go.
        expect(diceMeshPool.d6).toEqual([]);
    });

    it('keeps its template when the set changes something other than shape', () => {
        const before = ensureDieTemplate('d6');
        useSet((set) => {
            set.dice.d6 = {
                ...set.dice.d6,
                body: { ...set.dice.d6.body, bodyColor: '#010203' },
            };
        });
        expect(ensureDieTemplate('d6')).toBe(before);
    });
});
