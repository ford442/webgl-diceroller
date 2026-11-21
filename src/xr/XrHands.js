import * as THREE from 'three';
import { createPinchState, updatePinch } from './XrPinch.js';

const _thumb = new THREE.Vector3();
const _index = new THREE.Vector3();

/**
 * Tracked hands (`hand-tracking` optional feature). Three fills
 * `renderer.xr.getHand(i).joints` while a hand input source is connected;
 * this module turns thumb/index tips into a pinch with hysteresis and a
 * world-space pinch point, and draws a small marker on each fingertip pair.
 *
 * When the session has no hands (feature not granted, or the player is on
 * controllers) the joints never become visible and nothing here fires —
 * controllers keep working through XrControllers unchanged.
 *
 * @param {object} options
 * @param {{ xr: { getHand: (i: number) => import('three').XRHandSpace } }} options.renderer
 * @param {import('three').Scene} options.scene
 * @param {(index: number, point: import('three').Vector3) => void} options.onPinchStart
 * @param {(index: number) => void} options.onPinchEnd
 */
export function createXrHands({ renderer, scene, onPinchStart, onPinchEnd }) {
    /** @type {import('three').XRHandSpace[]} */
    const hands = [];
    const pinchStates = [createPinchState(), createPinchState()];
    /** @type {Array<'left' | 'right' | 'none' | null>} */
    const handedness = [null, null];

    const markerGeo = new THREE.SphereGeometry(0.006, 10, 8);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
    const pinchMat = new THREE.MeshBasicMaterial({ color: 0x66ccff });
    /** @type {Array<{ thumb: THREE.Mesh, index: THREE.Mesh }>} */
    const markers = [];

    for (let i = 0; i < 2; i++) {
        const hand = renderer.xr.getHand(i);
        hand.name = `xrHand${i}`;
        scene.add(hand);
        hands.push(hand);

        const thumb = new THREE.Mesh(markerGeo, markerMat);
        const index = new THREE.Mesh(markerGeo, markerMat);
        thumb.name = `xrHandMarker${i}`;
        index.name = `xrHandMarker${i}`;
        thumb.visible = false;
        index.visible = false;
        scene.add(thumb, index);
        markers.push({ thumb, index });

        const slot = i;
        hand.addEventListener('connected', (event) => {
            handedness[slot] = /** @type {any} */ (event).data?.handedness ?? 'none';
        });
        hand.addEventListener('disconnected', () => {
            handedness[slot] = null;
            if (pinchStates[slot].pinching) {
                pinchStates[slot].pinching = false;
                onPinchEnd(slot);
            }
        });
    }

    /**
     * @param {number} i
     * @param {string} name
     * @param {THREE.Vector3} out
     */
    function jointWorld(i, name, out) {
        const joint = /** @type {any} */ (hands[i]?.joints)?.[name];
        if (!joint || joint.visible === false) return false;
        joint.getWorldPosition(out);
        return true;
    }

    /**
     * World-space pinch point (thumb/index midpoint) for a tracked hand.
     * @param {number} i
     * @param {THREE.Vector3} out
     * @returns {boolean}
     */
    function getPinchPoint(i, out) {
        if (handedness[i] == null) return false;
        if (!jointWorld(i, 'thumb-tip', _thumb) || !jointWorld(i, 'index-finger-tip', _index)) {
            return false;
        }
        out.lerpVectors(_thumb, _index, 0.5);
        return true;
    }

    function update() {
        for (let i = 0; i < hands.length; i++) {
            const tracked =
                handedness[i] != null &&
                jointWorld(i, 'thumb-tip', _thumb) &&
                jointWorld(i, 'index-finger-tip', _index);
            const m = markers[i];
            m.thumb.visible = tracked;
            m.index.visible = tracked;
            if (tracked) {
                m.thumb.position.copy(_thumb);
                m.index.position.copy(_index);
            }
            const edge = updatePinch(pinchStates[i], tracked ? _thumb.distanceTo(_index) : null);
            const mat = pinchStates[i].pinching ? pinchMat : markerMat;
            m.thumb.material = mat;
            m.index.material = mat;
            if (edge === 'start') {
                onPinchStart(i, _thumb.clone().lerp(_index, 0.5));
            } else if (edge === 'end') {
                onPinchEnd(i);
            }
        }
    }

    function reset() {
        for (let i = 0; i < pinchStates.length; i++) {
            pinchStates[i].pinching = false;
            markers[i].thumb.visible = false;
            markers[i].index.visible = false;
        }
    }

    function dispose() {
        for (const h of hands) scene.remove(h);
        for (const m of markers) scene.remove(m.thumb, m.index);
        markerGeo.dispose();
        markerMat.dispose();
        pinchMat.dispose();
    }

    return {
        hands,
        update,
        reset,
        dispose,
        getPinchPoint,
        /** @param {number} i */
        isTracked: (i) => handedness[i] != null,
        /** Any hand currently tracked (for stats / tests). */
        anyTracked: () => handedness.some((h) => h != null),
    };
}
