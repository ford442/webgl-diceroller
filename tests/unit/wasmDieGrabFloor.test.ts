import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
    createWasmDieGrabState,
    endWasmDieGrab,
    minCenterYAboveSurface,
    startWasmDieGrab,
    setWasmDieGrabTarget,
    updateWasmDieGrab,
} from '../../src/interaction/WasmDieGrab.js';

const SURFACE = 1.0;

function makeDie(half = 0.5) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(half * 2, half * 2, half * 2),
        new THREE.MeshBasicMaterial()
    );
    mesh.position.set(0, SURFACE + half, 0);
    return mesh;
}

function recordingDriver() {
    const driven: number[] = [];
    const impulses: { x: number; y: number; z: number }[] = [];
    return {
        driven,
        impulses,
        driver: {
            setKinematic: () => {},
            driveTransform: (_m: unknown, p: { y: number }) => driven.push(p.y),
            applyImpulse: (_m: unknown, i: { x: number; y: number; z: number } | null) => {
                if (i) impulses.push(i);
            },
        },
    };
}

describe('minCenterYAboveSurface', () => {
    it('is the surface plus the body half-height plus clearance', () => {
        expect(minCenterYAboveSurface(makeDie(0.5), SURFACE, 0)).toBeCloseTo(SURFACE + 0.5, 5);
    });

    it('uses the current orientation: a die on its corner needs more room than one on a face', () => {
        const flat = makeDie(0.5);
        const corner = makeDie(0.5);
        corner.rotation.set(Math.atan(Math.SQRT1_2), 0, Math.PI / 4);
        corner.updateMatrixWorld(true);
        expect(minCenterYAboveSurface(corner, SURFACE, 0)).toBeGreaterThan(
            minCenterYAboveSurface(flat, SURFACE, 0) + 0.15
        );
    });
});

describe('a grab with a surface', () => {
    it('never drives the held body below the surface, however far the cursor goes', () => {
        const die = makeDie();
        const { driver, driven } = recordingDriver();
        const grab = createWasmDieGrabState();
        startWasmDieGrab(grab, die, die.position.clone(), driver, { surfaceY: SURFACE });
        const floor = minCenterYAboveSurface(die, SURFACE);

        for (let i = 0; i < 40; i++) {
            setWasmDieGrabTarget(grab, new THREE.Vector3(0, SURFACE - i * 0.2, 0));
            updateWasmDieGrab(grab, 1 / 60);
        }
        expect(Math.min(...driven)).toBeGreaterThanOrEqual(floor - 1e-6);
        expect(die.position.y).toBeGreaterThanOrEqual(floor - 1e-6);
    });

    it('does not hand the die a downward throw for a cursor that went under the table', () => {
        const die = makeDie();
        const { driver, impulses } = recordingDriver();
        const grab = createWasmDieGrabState();
        startWasmDieGrab(grab, die, die.position.clone(), driver, { surfaceY: SURFACE });
        for (let i = 0; i < 10; i++) {
            setWasmDieGrabTarget(grab, new THREE.Vector3(i * 0.3, SURFACE - i, 0));
            updateWasmDieGrab(grab, 1 / 60);
        }
        endWasmDieGrab(grab);
        // Once the clamp is holding the target still, the release carries sideways
        // motion only; the cursor's plunge must not turn into a downward impulse.
        const last = impulses[impulses.length - 1];
        expect(last).toBeDefined();
        expect(last!.y).toBeGreaterThanOrEqual(-1e-6);
    });

    it('leaves a grab without a surface unclamped (XR, props)', () => {
        const die = makeDie();
        const { driver, driven } = recordingDriver();
        const grab = createWasmDieGrabState();
        startWasmDieGrab(grab, die, die.position.clone(), driver);
        setWasmDieGrabTarget(grab, new THREE.Vector3(0, -5, 0));
        updateWasmDieGrab(grab, 1 / 60);
        expect(driven[0]).toBeCloseTo(-5, 5);
    });

    it('forgets the surface after release', () => {
        const die = makeDie();
        const { driver } = recordingDriver();
        const grab = createWasmDieGrabState();
        startWasmDieGrab(grab, die, die.position.clone(), driver, { surfaceY: SURFACE });
        endWasmDieGrab(grab);
        expect(grab.minCenterY).toBeNull();
    });
});
