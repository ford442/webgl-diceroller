/**
 * Determinism coverage for the dice-tower hopper drop.
 *
 * A tower dump is a seeded roll that rides the share URL (`?src=tower`), so
 * the same seed has to produce the same poses — and, because the worker draws
 * on its own engine PRNG while the main thread draws on the in-process one,
 * both have to draw in the same order.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    HOPPER_DROP_SPEED,
    HOPPER_STACK_SPACING,
    applyDropParams,
    computeSeededHopperDropParams,
    identityHopperFrame,
    type SeededHopperFrame,
} from '../../src/wasm/seededHopperDrop.js';
import { createSeededRng } from '../../src/wasm/seededThrowParams.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DICE = [
    { id: 7, index: 0 },
    { id: 9, index: 1 },
    { id: 11, index: 2 },
];

/** The tower as tierDefinitions places it, with a yaw so the basis matters. */
function rotatedFrame(yaw: number): SeededHopperFrame {
    return {
        origin: { x: 0, y: -3, z: -14 },
        axisX: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) },
        axisY: { x: 0, y: 1, z: 0 },
        axisZ: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) },
        y: 14,
        halfWidth: 1.47,
        halfDepth: 2,
    };
}

describe('computeSeededHopperDropParams', () => {
    it('is a pure function of the seed', () => {
        const frame = rotatedFrame(-Math.PI / 6);
        const a = computeSeededHopperDropParams(createSeededRng(0xbeef), DICE, frame);
        const b = computeSeededHopperDropParams(createSeededRng(0xbeef), DICE, frame);
        expect(a).toEqual(b);
    });

    it('produces different poses for different seeds', () => {
        const frame = identityHopperFrame(14, 1.47, 2);
        const a = computeSeededHopperDropParams(createSeededRng(1), DICE, frame);
        const b = computeSeededHopperDropParams(createSeededRng(2), DICE, frame);
        expect(a[0]?.x).not.toBe(b[0]?.x);
    });

    it('draws ten values per die, in a fixed order', () => {
        // The worker replays this same sequence against its own engine PRNG,
        // so a change to the draw count or order silently desyncs the two.
        let draws = 0;
        const rng = createSeededRng(99);
        computeSeededHopperDropParams(
            () => {
                draws++;
                return rng();
            },
            DICE,
            identityHopperFrame(14, 1.47, 2)
        );
        expect(draws).toBe(DICE.length * 10);
    });

    it('scatters inside the hopper mouth and staggers the queue', () => {
        const frame = identityHopperFrame(14, 1.47, 2);
        const params = computeSeededHopperDropParams(createSeededRng(0x1234), DICE, frame);
        params.forEach((p, index) => {
            expect(Math.abs(p.x)).toBeLessThanOrEqual(frame.halfWidth);
            expect(Math.abs(p.z)).toBeLessThanOrEqual(frame.halfDepth);
            expect(p.y).toBeCloseTo(frame.y + index * HOPPER_STACK_SPACING, 10);
            // Dice enter the chute falling, whatever the lateral kick was.
            expect(p.velY).toBeCloseTo(-HOPPER_DROP_SPEED, 10);
        });
    });

    it('maps the scatter through the tower basis, not the world axes', () => {
        // The tower is placed (and can be yawed) by the tier definition; a
        // drop that ignored its basis would scatter dice through the shaft
        // walls whenever the prop was rotated.
        const yawed = computeSeededHopperDropParams(
            createSeededRng(555),
            [{ id: 1, index: 0 }],
            rotatedFrame(Math.PI / 2)
        )[0];
        const unrotated = computeSeededHopperDropParams(
            createSeededRng(555),
            [{ id: 1, index: 0 }],
            rotatedFrame(0)
        )[0];

        // Same local scatter, rotated a quarter turn about Y around the tower
        // origin: local +X maps to world -Z.
        expect(yawed?.z).toBeCloseTo(-14 - (unrotated!.x - 0), 5);
        expect(yawed?.y).toBeCloseTo(unrotated!.y, 10);
    });
});

describe('applyDropParams', () => {
    it('poses and kicks each die exactly once', () => {
        const transforms: number[][] = [];
        const velocities: number[][] = [];
        const engine = {
            setDieTransform: (...args: number[]) => transforms.push(args),
            setDieVelocity: (...args: number[]) => velocities.push(args),
        };
        const params = computeSeededHopperDropParams(
            createSeededRng(7),
            DICE,
            identityHopperFrame(14, 1.47, 2)
        );
        applyDropParams(engine, params);

        expect(transforms).toHaveLength(DICE.length);
        expect(velocities).toHaveLength(DICE.length);
        expect(transforms.map((t) => t[0])).toEqual(DICE.map((d) => d.id));
        // A drop sets velocity directly — an impulse would scale with mass and
        // send a d4 down the chute faster than a d20 from the same seed.
        expect(velocities[0]?.[2]).toBeCloseTo(-HOPPER_DROP_SPEED, 10);
    });
});

describe('fair-commit ordering', () => {
    it('never starts a roll before its commit/reveal is on the wire', () => {
        // Commit-reveal only binds a host if it cannot see the outcome before
        // revealing. Firing broadcastFairCommit and rolling immediately leaves
        // the host free to watch the dice during the ack window and withhold
        // an unfavourable reveal — the abort the scheme exists to prevent.
        // The tower drop shipped that way once; this keeps every roll path
        // (throw, notation, tower) awaiting it.
        const source = readFileSync(path.join(REPO_ROOT, 'src/app/RollWiring.ts'), 'utf8');

        const callSites = source
            .split('\n')
            .map((line, i) => ({ line: line.trim(), n: i + 1 }))
            .filter(({ line }) => line.includes('broadcastFairCommit('))
            // the declaration itself, not a call
            .filter(({ line }) => !line.startsWith('async function'));

        expect(callSites.length).toBeGreaterThanOrEqual(3);
        for (const { line, n } of callSites) {
            expect(line, `RollWiring.ts:${n} must await broadcastFairCommit`).toMatch(
                /^await broadcastFairCommit\(/
            );
        }
    });
});

describe('DiceTowerController', () => {
    it('draws no entropy of its own', () => {
        // Acceptance: the tower's scatter must come from the seeded engine
        // PRNG, never from Math.random — a share link cannot reproduce the
        // latter, and a guest in a room would see different faces.
        const source = readFileSync(
            path.join(REPO_ROOT, 'src/interaction/DiceTowerController.ts'),
            'utf8'
        );
        expect(source).not.toMatch(/Math\.random/);
    });
});
