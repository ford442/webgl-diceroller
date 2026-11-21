/**
 * `immersive-ar` table placement: a hit-test source from the viewer drives a
 * reticle (velvet-zone outline) on detected surfaces; a select / pinch places
 * the table there, facing the player, and — when the browser grants
 * `anchors` — pins it to an XRAnchor so tracking refinements keep the velvet
 * on the real table instead of drifting with the reference space.
 *
 * Without `hit-test` (emulators, some browsers) the reticle falls back to a
 * fixed spot 0.6 m ahead of the head, 0.45 m below it, so AR still works.
 */

import * as THREE from 'three';
import { DICE_ZONE_HALF } from '../core/SceneMetrics.js';
import { facingYaw, yawFromQuaternion } from './XrRecenter.js';
import { XR_WORLD_SCALE } from './XrRig.js';

const FALLBACK_FORWARD_M = 0.6;
const FALLBACK_BELOW_HEAD_M = 0.45;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _fwd = new THREE.Vector3();

/**
 * @param {object} options
 * @param {import('three').Scene} options.scene
 * @param {ReturnType<typeof import('./XrRig.js').createXrRig>} options.rig
 * @param {() => { position: THREE.Vector3, quaternion: THREE.Quaternion } | null} options.getHeadPose
 */
export function createXrArPlacement({ scene, rig, getHeadPose }) {
    const reticle = new THREE.Group();
    reticle.name = 'xrArReticle';
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.05, 0.065, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 })
    );
    reticle.add(ring);
    const h = DICE_ZONE_HALF * XR_WORLD_SCALE;
    const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-h, 0.002, -h),
            new THREE.Vector3(h, 0.002, -h),
            new THREE.Vector3(h, 0.002, h),
            new THREE.Vector3(-h, 0.002, h),
        ]),
        new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.8 })
    );
    reticle.add(outline);
    scene.add(reticle);

    /** @type {XRSession | null} */
    let session = null;
    /** @type {XRHitTestSource | null} */
    let hitTestSource = null;
    /** @type {XRHitTestResult | null} */
    let lastHit = null;
    /** @type {XRAnchor | null} */
    let anchor = null;
    let anchorYawOffset = 0;
    let active = false;
    let usingFallback = false;

    /** @param {XRSession} s */
    async function onSessionStart(s) {
        session = s;
        active = true;
        lastHit = null;
        usingFallback = true;
        try {
            if (typeof s.requestHitTestSource === 'function') {
                const viewer = await s.requestReferenceSpace('viewer');
                hitTestSource = (await s.requestHitTestSource?.({ space: viewer })) ?? null;
                usingFallback = hitTestSource == null;
            }
        } catch (err) {
            console.warn('[XR] hit-test unavailable; using fixed AR placement:', err);
            hitTestSource = null;
            usingFallback = true;
        }
    }

    function onSessionEnd() {
        hitTestSource?.cancel?.();
        hitTestSource = null;
        dropAnchor();
        lastHit = null;
        session = null;
        active = false;
        reticle.visible = false;
    }

    function dropAnchor() {
        try {
            anchor?.delete?.();
        } catch {
            /* already gone */
        }
        anchor = null;
    }

    /**
     * @param {XRFrame | null | undefined} frame
     * @param {XRReferenceSpace | null | undefined} refSpace
     */
    function update(frame, refSpace) {
        if (!active) return;

        if (rig.placed) {
            reticle.visible = false;
            if (anchor && frame && refSpace && frame.trackedAnchors?.has?.(anchor) !== false) {
                const pose = frame.getPose?.(anchor.anchorSpace, refSpace);
                if (pose) {
                    const p = pose.transform.position;
                    const yaw = yawFromQuaternion(pose.transform.orientation) + anchorYawOffset;
                    rig.placeAt({ x: p.x, y: p.y, z: p.z }, yaw);
                }
            }
            return;
        }

        lastHit = null;
        if (hitTestSource && frame && refSpace) {
            const results = frame.getHitTestResults(hitTestSource);
            const hit = results[0];
            const pose = hit?.getPose(refSpace);
            if (pose) {
                lastHit = hit;
                _matrix.fromArray(pose.transform.matrix);
                reticle.matrix.copy(_matrix);
                reticle.visible = true;
                return;
            }
            reticle.visible = false;
            return;
        }

        // Fallback: a fixed spot in front of (and below) the head.
        const head = getHeadPose();
        if (!head) {
            reticle.visible = false;
            return;
        }
        _fwd.set(0, 0, -1).applyQuaternion(head.quaternion);
        _fwd.y = 0;
        if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
        _fwd.normalize();
        _pos.copy(head.position).addScaledVector(_fwd, FALLBACK_FORWARD_M);
        _pos.y = head.position.y - FALLBACK_BELOW_HEAD_M;
        _matrix.makeTranslation(_pos.x, _pos.y, _pos.z);
        reticle.matrix.copy(_matrix);
        reticle.visible = true;
    }

    /**
     * Place the table on the reticle. False when there is nothing to place on.
     * @returns {boolean}
     */
    function confirm() {
        if (!active || rig.placed || !reticle.visible) return false;
        reticle.matrix.decompose(_pos, _quat, _scale);
        const head = getHeadPose();
        const yaw = head ? facingYaw(_pos, head.position) : 0;
        rig.placeAt({ x: _pos.x, y: _pos.y, z: _pos.z }, yaw);
        reticle.visible = false;

        const hit = lastHit;
        if (hit && typeof hit.createAnchor === 'function') {
            const placedAt = session;
            // The anchor is created at the hit pose: remember how far our
            // facing yaw is from the hit's own yaw, so following the anchor's
            // orientation later keeps the table facing the same way.
            const hitYaw = yawFromQuaternion(_quat);
            hit.createAnchor()
                .then((a) => {
                    // A late anchor for a session that ended, or a table moved
                    // again meanwhile, is thrown away.
                    if (session !== placedAt || !rig.placed || anchor) {
                        a?.delete?.();
                        return;
                    }
                    anchor = a;
                    anchorYawOffset = yaw - hitYaw;
                })
                .catch((err) => console.info('[XR] anchor not created:', err));
        }
        return true;
    }

    /** Show the reticle again and let the player put the table elsewhere. */
    function reset() {
        dropAnchor();
        rig.unplace();
    }

    function dispose() {
        onSessionEnd();
        scene.remove(reticle);
        ring.geometry.dispose();
        /** @type {THREE.Material} */ (ring.material).dispose();
        outline.geometry.dispose();
        /** @type {THREE.Material} */ (outline.material).dispose();
    }

    return {
        reticle,
        onSessionStart,
        onSessionEnd,
        update,
        confirm,
        reset,
        dispose,
        getState: () => ({
            active,
            placed: rig.placed,
            anchored: anchor != null,
            hitTest: !usingFallback,
            reticleVisible: reticle.visible,
        }),
    };
}
