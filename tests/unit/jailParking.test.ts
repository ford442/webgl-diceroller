import { describe, expect, it } from 'vitest';
import {
    JAIL_PARKING_SLOTS,
    JAIL_PARKING_SPACING,
    jailParkingPose,
    jailParkingRadius,
    nextFreeParkingSlot,
} from '../../src/interaction/jailParking.js';

const layout = { center: { x: 0, z: 0 }, minRadius: 0.24 };

describe('jail parking layout', () => {
    it('gives every slot its own place, at least the spacing from any other', () => {
        const poses = Array.from({ length: JAIL_PARKING_SLOTS }, (_, s) =>
            jailParkingPose(s, layout)
        );
        for (let a = 0; a < poses.length; a++) {
            for (let b = a + 1; b < poses.length; b++) {
                const d = Math.hypot(poses[a]!.x - poses[b]!.x, poses[a]!.z - poses[b]!.z);
                expect(d).toBeGreaterThanOrEqual(JAIL_PARKING_SPACING - 1e-9);
            }
        }
    });

    it('widens the ring past a small interior rather than stacking dice', () => {
        expect(jailParkingRadius(0.24)).toBeGreaterThan(0.24);
        expect(jailParkingRadius(99)).toBe(99);
    });

    it('wraps a bad slot instead of throwing', () => {
        expect(jailParkingPose(JAIL_PARKING_SLOTS + 2, layout)).toEqual(jailParkingPose(2, layout));
        expect(jailParkingPose(-1, layout)).toEqual(
            jailParkingPose(JAIL_PARKING_SLOTS - 1, layout)
        );
    });

    it('hands out the lowest free slot, so a later hold never lands on an earlier one', () => {
        expect(nextFreeParkingSlot([])).toBe(0);
        expect(nextFreeParkingSlot([0, 1, 3])).toBe(2);
        expect(
            nextFreeParkingSlot(Array.from({ length: JAIL_PARKING_SLOTS }, (_, i) => i))
        ).toBeNull();
    });
});
