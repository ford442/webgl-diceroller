import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    getXrSessionMode,
    getXrSnapDegrees,
    isArRequested,
    isXrHandsEnabled,
    isXrRequested,
    isXrWebGlForced,
    isXrWebGpuRequested,
} from '../../src/xr/XrFlags.js';
import { buildXrSessionInit, xrButtonLabel } from '../../src/xr/XrSessionOptions.js';
import {
    createXrFramebufferScaleMonitor,
    XR_SAMPLE_WINDOW,
    XR_SLOW_WINDOWS,
} from '../../src/xr/XrFramebufferScale.js';
import {
    computeSeatedRecenter,
    facingYaw,
    rotateAboutPivot,
    yawFromQuaternion,
} from '../../src/xr/XrRecenter.js';
import {
    createPinchState,
    nearestWithinReach,
    PINCH_END_M,
    PINCH_START_M,
    updatePinch,
} from '../../src/xr/XrPinch.js';
import {
    CHROME_CANVAS_H,
    CHROME_CANVAS_W,
    CHROME_MAX_SEATS,
    hitTestChrome,
    layoutChrome,
} from '../../src/xr/XrChromeLayout.js';
import { keepInAr } from '../../src/xr/XrArScene.js';
import {
    createXrRig,
    XR_SEAT_DISTANCE_M,
    XR_TABLE_HEIGHT_M,
    XR_WORLD_SCALE,
} from '../../src/xr/XrRig.js';
import { xrChromeButtons } from '../../src/xr/XrAppWiring.js';
import { getRendererPreference } from '../../src/core/DeviceSession';
import { QUALITY_PROFILES } from '../../src/core/AdaptiveQuality';
import { TABLE_SURFACE_Y } from '../../src/core/SceneMetrics.js';

const q = (s) => new URLSearchParams(s);

describe('XrFlags', () => {
    it('treats ?ar and ?xr-webgpu as XR requests', () => {
        expect(isXrRequested(q(''))).toBe(false);
        for (const flag of ['xr', 'xr-emulator', 'ar', 'xr-webgpu']) {
            expect(isXrRequested(q(flag))).toBe(true);
        }
        expect(isArRequested(q('ar'))).toBe(true);
        expect(isArRequested(q('xr'))).toBe(false);
        expect(isXrWebGpuRequested(q('xr&xr-webgpu'))).toBe(true);
    });

    it('forces WebGL for every XR path but the WebGPU experiment', () => {
        expect(isXrWebGlForced(q('xr'))).toBe(true);
        expect(isXrWebGlForced(q('ar'))).toBe(true);
        expect(isXrWebGlForced(q('xr&xr-webgpu'))).toBe(false);
        expect(isXrWebGlForced(q(''))).toBe(false);
        expect(getRendererPreference(q('ar'))).toBe('webgl');
        expect(getRendererPreference(q('ar&webgpu'))).toBe('webgl');
        expect(getRendererPreference(q('xr&xr-webgpu'))).toBe('webgpu');
        expect(getRendererPreference(q(''))).toBe('webgpu');
    });

    it('picks the session mode and hand tracking opt-out', () => {
        expect(getXrSessionMode(q('xr'))).toBe('immersive-vr');
        expect(getXrSessionMode(q('ar'))).toBe('immersive-ar');
        expect(isXrHandsEnabled(q('xr'))).toBe(true);
        expect(isXrHandsEnabled(q('xr&xr-hands=off'))).toBe(false);
        expect(isXrHandsEnabled(q('xr&xr-hands=0'))).toBe(false);
        expect(isXrHandsEnabled(q('xr&xr-hands=on'))).toBe(true);
    });

    it('keeps snap-turn parsing', () => {
        expect(getXrSnapDegrees(q(''))).toBe(45);
        expect(getXrSnapDegrees(q('xr-snap=5'))).toBe(15);
        expect(getXrSnapDegrees(q('xr-snap=200'))).toBe(90);
    });
});

describe('buildXrSessionInit', () => {
    it('requires nothing beyond the mode', () => {
        expect(buildXrSessionInit('immersive-vr').requiredFeatures).toEqual([]);
        expect(buildXrSessionInit('immersive-ar').requiredFeatures).toEqual([]);
    });

    it('asks for hit-test + anchors only in AR, hands unless disabled', () => {
        const vr = buildXrSessionInit('immersive-vr').optionalFeatures;
        const ar = buildXrSessionInit('immersive-ar').optionalFeatures;
        expect(vr).toContain('local-floor');
        expect(vr).toContain('hand-tracking');
        expect(vr).not.toContain('hit-test');
        expect(ar).toEqual(expect.arrayContaining(['hit-test', 'anchors', 'hand-tracking']));
        expect(buildXrSessionInit('immersive-ar', { hands: false }).optionalFeatures).not.toContain(
            'hand-tracking'
        );
    });

    it('labels the button for the mode', () => {
        expect(xrButtonLabel('immersive-vr', false)).toBe('Enter VR');
        expect(xrButtonLabel('immersive-ar', false)).toBe('Enter AR');
        expect(xrButtonLabel('immersive-ar', true)).toBe('Exit AR');
    });
});

describe('XR framebuffer scale monitor', () => {
    const feed = (monitor, ms, frames) => {
        let stepped = false;
        for (let i = 0; i < frames; i++) stepped = monitor.sample(ms / 1000) || stepped;
        return stepped;
    };

    it('applies the xr profile scale + foveation before the session', () => {
        const calls = [];
        const monitor = createXrFramebufferScaleMonitor(QUALITY_PROFILES.xr);
        const applied = monitor.applyBeforeSession({
            setFramebufferScaleFactor: (v) => calls.push(['scale', v]),
            setFoveation: (v) => calls.push(['foveation', v]),
        });
        expect(applied.framebufferScale).toBe(QUALITY_PROFILES.xr.framebufferScale);
        expect(calls).toEqual([
            ['scale', QUALITY_PROFILES.xr.framebufferScale],
            ['foveation', QUALITY_PROFILES.xr.foveation],
        ]);
    });

    it('steps the next session down after sustained slow frames, never below min', () => {
        const monitor = createXrFramebufferScaleMonitor({
            framebufferScale: 1,
            framebufferScaleMin: 0.8,
            framebufferScaleStep: 0.1,
        });
        monitor.applyBeforeSession(null);
        // Fast frames: nothing changes.
        expect(feed(monitor, 13.9, XR_SAMPLE_WINDOW * 4)).toBe(false);
        // One slow window is not sustained.
        expect(feed(monitor, 30, XR_SAMPLE_WINDOW * (XR_SLOW_WINDOWS - 1))).toBe(false);
        expect(feed(monitor, 30, XR_SAMPLE_WINDOW)).toBe(true);
        let stats = monitor.getStats();
        // The live layer keeps its size; the next session gets the step.
        expect(stats.framebufferScale).toBe(1);
        expect(stats.nextFramebufferScale).toBe(0.9);
        expect(stats.stepDowns).toBe(1);

        feed(monitor, 30, XR_SAMPLE_WINDOW * XR_SLOW_WINDOWS * 5);
        stats = monitor.getStats();
        expect(stats.nextFramebufferScale).toBe(0.8);
        expect(monitor.applyBeforeSession(null).framebufferScale).toBe(0.8);
    });

    it('ignores hitches and zero deltas', () => {
        const monitor = createXrFramebufferScaleMonitor();
        expect(feed(monitor, 0, XR_SAMPLE_WINDOW * 10)).toBe(false);
        expect(feed(monitor, 1000, XR_SAMPLE_WINDOW * 10)).toBe(false);
        expect(monitor.getStats().stepDowns).toBe(0);
    });
});

describe('XR recenter math', () => {
    const quatYaw = (yaw) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));

    it('reads head heading as a dolly yaw', () => {
        for (const yaw of [0, 0.5, -1.2, Math.PI * 0.9]) {
            expect(yawFromQuaternion(quatYaw(yaw))).toBeCloseTo(yaw, 6);
        }
        // Pitch does not change the heading.
        const pitched = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0.7, 0, 'YXZ'));
        expect(yawFromQuaternion(pitched)).toBeCloseTo(0.7, 6);
    });

    it('rotates about a pivot like Object3D.rotation.y', () => {
        const pivot = { x: 1, z: 2 };
        const p = { x: 3, z: 2 };
        const out = rotateAboutPivot(p, pivot, Math.PI / 2);
        const v = new THREE.Vector3(2, 0, 0).applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            Math.PI / 2
        );
        expect(out.x).toBeCloseTo(pivot.x + v.x, 9);
        expect(out.z).toBeCloseTo(pivot.z + v.z, 9);
    });

    it('seated recenter puts the table in front of the head', () => {
        const head = { x: 0.4, z: -0.2 };
        const pose = computeSeatedRecenter(head, quatYaw(1.1));
        expect(pose).toMatchObject({ x: 0.4, z: -0.2 });
        expect(pose.yaw).toBeCloseTo(1.1, 6);
    });

    it('AR facing yaw points the seat edge (+Z) at the viewer', () => {
        const yaw = facingYaw({ x: 0, z: 0 }, { x: 1, z: 1 });
        const seat = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        expect(seat.x).toBeCloseTo(Math.SQRT1_2, 6);
        expect(seat.z).toBeCloseTo(Math.SQRT1_2, 6);
    });
});

describe('pinch detection', () => {
    it('has hysteresis between start and end', () => {
        const s = createPinchState();
        expect(updatePinch(s, 0.05)).toBe(null);
        expect(updatePinch(s, PINCH_START_M)).toBe('start');
        // Between thresholds: still pinching, no chatter.
        expect(updatePinch(s, (PINCH_START_M + PINCH_END_M) / 2)).toBe(null);
        expect(s.pinching).toBe(true);
        expect(updatePinch(s, PINCH_END_M)).toBe('end');
        expect(updatePinch(s, PINCH_END_M)).toBe(null);
    });

    it('releases when tracking is lost mid-pinch', () => {
        const s = createPinchState();
        updatePinch(s, 0.01);
        expect(updatePinch(s, null)).toBe('end');
        expect(updatePinch(s, null)).toBe(null);
    });

    it('picks the nearest die within reach, counting its radius', () => {
        const point = { x: 0, y: 0, z: 0 };
        const near = { item: 'd4', position: { x: 0.05, y: 0, z: 0 }, radius: 0.01 };
        const big = { item: 'd20', position: { x: 0.09, y: 0, z: 0 }, radius: 0.06 };
        const far = { item: 'far', position: { x: 1, y: 0, z: 0 }, radius: 0.02 };
        expect(nearestWithinReach(point, [near, big, far])).toBe('d20');
        expect(nearestWithinReach(point, [near, far])).toBe('d4');
        expect(nearestWithinReach(point, [far])).toBe(null);
    });
});

describe('XR chrome layout', () => {
    const buttons = [
        { id: 'pass', label: 'Pass turn' },
        { id: 'tower', label: 'Tower drop' },
        { id: 'recenter', label: 'Recenter', enabled: false },
    ];

    it('lays out seats with the current actor and overflow', () => {
        const seats = Array.from({ length: CHROME_MAX_SEATS + 2 }, (_, i) => ({
            id: `s${i}`,
            name: `P${i}`,
        }));
        const layout = layoutChrome({ seats, currentIndex: 1, lastExpression: '2d6 = 7', buttons });
        expect(layout.seats).toHaveLength(CHROME_MAX_SEATS);
        expect(layout.seats[1].current).toBe(true);
        expect(layout.overflow).toBe(2);
        expect(layout.lastExpression).toBe('2d6 = 7');
    });

    it('buttons stay inside the canvas and do not overlap', () => {
        const layout = layoutChrome({ buttons });
        for (const b of layout.buttons) {
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.x + b.w).toBeLessThanOrEqual(CHROME_CANVAS_W);
            expect(b.y + b.h).toBeLessThanOrEqual(CHROME_CANVAS_H);
        }
        for (let i = 1; i < layout.buttons.length; i++) {
            const prev = layout.buttons[i - 1];
            expect(layout.buttons[i].x).toBeGreaterThan(prev.x + prev.w);
        }
    });

    it('hit-tests UVs to enabled buttons only', () => {
        const layout = layoutChrome({ buttons });
        const uvOf = (b) => ({
            x: (b.x + b.w / 2) / CHROME_CANVAS_W,
            y: 1 - (b.y + b.h / 2) / CHROME_CANVAS_H,
        });
        expect(hitTestChrome(layout, uvOf(layout.buttons[0]))).toBe('pass');
        expect(hitTestChrome(layout, uvOf(layout.buttons[1]))).toBe('tower');
        expect(hitTestChrome(layout, uvOf(layout.buttons[2]))).toBe(null); // disabled
        expect(hitTestChrome(layout, { x: 0.5, y: 0.95 })).toBe(null); // title area
        expect(hitTestChrome(layout, null)).toBe(null);
    });

    it('chooses buttons from session state', () => {
        expect(
            xrChromeButtons({ mode: 'immersive-vr', canPassTurn: true, hasTower: false }).map(
                (b) => b.id
            )
        ).toEqual(['pass', 'recenter']);
        const ar = xrChromeButtons({ mode: 'immersive-ar', canPassTurn: false, hasTower: true });
        expect(ar.map((b) => b.id)).toEqual(['pass', 'tower', 'recenter']);
        expect(ar[0].enabled).toBe(false); // a room guest cannot pass the turn
        expect(ar[2].label).toBe('Move table');
    });
});

describe('AR room hiding', () => {
    const box = (min, max) => ({
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] },
    });
    const S = TABLE_SURFACE_Y;

    it('keeps the table, lights, dice and XR objects', () => {
        const huge = box([-60, -10, -60], [60, 22, 60]);
        expect(keepInAr({ factory: 'Table', box: huge })).toBe(true);
        expect(keepInAr({ isLight: true, box: huge })).toBe(true);
        expect(keepInAr({ isDie: true, box: huge })).toBe(true);
        expect(keepInAr({ name: 'xrDolly', box: huge })).toBe(true);
        expect(keepInAr({ name: 'empty', box: null })).toBe(true);
    });

    it('keeps tabletop props, hides room-scale ones', () => {
        expect(keepInAr({ factory: 'Mug', box: box([5, S, 5], [6, S + 2, 6]) })).toBe(true);
        // walls / room: far past the footprint
        expect(keepInAr({ factory: 'TavernWalls', box: box([-40, -10, -40], [40, 22, 40]) })).toBe(
            false
        );
        // rug / chair: reaches the floor
        expect(keepInAr({ factory: 'Chair', box: box([-16, -10, 4], [-12, S + 1, 8]) })).toBe(
            false
        );
        // a tall prop resting on the table (dice tower) stays
        expect(keepInAr({ factory: 'DiceTower', box: box([-3, S, -17], [3, S + 18, -11]) })).toBe(
            true
        );
        // off the table edge (gong behind it)
        expect(keepInAr({ factory: 'Gong', box: box([-4, S, -27], [4, S + 9, -22]) })).toBe(false);
        // ceiling lamp: hangs from far above
        expect(keepInAr({ factory: 'Lamp', box: box([-3, S + 6, -3], [3, S + 40, 3]) })).toBe(
            false
        );
    });
});

describe('XR rig', () => {
    const makeScene = () => {
        const scene = new THREE.Scene();
        const table = new THREE.Group();
        table.name = 'Table';
        scene.add(table);
        const controller = new THREE.Group();
        controller.name = 'xrController0';
        scene.add(controller);
        return { scene, table, controller };
    };

    it('seats the table in VR and restores identity on exit', () => {
        const { scene, table, controller } = makeScene();
        const rig = createXrRig(scene);
        rig.applySeatedCalibration(true, { mode: 'vr' });
        expect(table.parent).toBe(rig.xrWorld);
        expect(controller.parent).toBe(scene); // reference space, never scaled
        expect(rig.xrWorld.scale.x).toBeCloseTo(XR_WORLD_SCALE);
        // The table surface lands at seated height, velvet in front (-Z).
        scene.updateMatrixWorld(true);
        const surface = new THREE.Vector3(0, TABLE_SURFACE_Y, 0).applyMatrix4(
            rig.xrWorld.matrixWorld
        );
        expect(surface.y).toBeCloseTo(XR_TABLE_HEIGHT_M, 6);
        expect(surface.z).toBeCloseTo(-XR_SEAT_DISTANCE_M, 6);
        const anchor = rig.tableAnchor.getWorldPosition(new THREE.Vector3());
        expect(anchor.distanceTo(surface)).toBeLessThan(1e-9);

        rig.applySeatedCalibration(false);
        expect(rig.xrWorld.scale.x).toBe(1);
        expect(rig.dolly.position.length()).toBe(0);
        expect(rig.dolly.rotation.y).toBe(0);
    });

    it('adopts content spawned mid-session in scene units (add, not attach)', () => {
        const { scene } = makeScene();
        const rig = createXrRig(scene);
        rig.applySeatedCalibration(true, { mode: 'vr' });
        const die = new THREE.Mesh();
        die.position.set(2, 5, 1);
        scene.add(die);
        rig.adoptSceneContent();
        expect(die.parent).toBe(rig.xrWorld);
        expect(die.position.toArray()).toEqual([2, 5, 1]);
    });

    it('recenters under the head without touching height', () => {
        const { scene } = makeScene();
        const rig = createXrRig(scene);
        rig.applySeatedCalibration(true, { mode: 'vr' });
        const head = {
            position: new THREE.Vector3(0.3, 1.2, 0.5),
            quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.8, 0)),
        };
        rig.resetSeat(head);
        expect(rig.dolly.position.x).toBeCloseTo(0.3);
        expect(rig.dolly.position.y).toBe(0);
        expect(rig.dolly.position.z).toBeCloseTo(0.5);
        expect(rig.yawRadians).toBeCloseTo(0.8);
    });

    it('snap turn pivots about the head', () => {
        const { scene } = makeScene();
        const rig = createXrRig(scene);
        rig.applySeatedCalibration(true, { mode: 'vr' });
        scene.updateMatrixWorld(true);
        const pivot = { x: 0, z: 0.2 };
        const before = rig.tableAnchor.getWorldPosition(new THREE.Vector3());
        rig.snapTurn(90, pivot);
        scene.updateMatrixWorld(true);
        const after = rig.tableAnchor.getWorldPosition(new THREE.Vector3());
        const r = (v) => Math.hypot(v.x - pivot.x, v.z - pivot.z);
        expect(r(after)).toBeCloseTo(r(before), 9);
        expect(after.y).toBeCloseTo(before.y, 9);
    });

    it('AR hides the table until placed, then puts the surface on the pose', () => {
        const { scene } = makeScene();
        const rig = createXrRig(scene);
        rig.applySeatedCalibration(true, { mode: 'ar' });
        expect(rig.xrWorld.visible).toBe(false);
        rig.placeAt({ x: 0.2, y: 0.74, z: -0.6 }, 0.3);
        expect(rig.placed).toBe(true);
        expect(rig.xrWorld.visible).toBe(true);
        scene.updateMatrixWorld(true);
        const surface = new THREE.Vector3(0, TABLE_SURFACE_Y, 0).applyMatrix4(
            rig.xrWorld.matrixWorld
        );
        expect(surface.x).toBeCloseTo(0.2, 6);
        expect(surface.y).toBeCloseTo(0.74, 6);
        expect(surface.z).toBeCloseTo(-0.6, 6);
        rig.unplace();
        expect(rig.xrWorld.visible).toBe(false);
        rig.applySeatedCalibration(false);
        expect(rig.xrWorld.visible).toBe(true);
        expect(rig.placed).toBe(false);
    });
});
