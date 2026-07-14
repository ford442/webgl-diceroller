import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Split die geometry into body (group 0) and pip/engraving (group 1) draw groups.
 * GLBs exported with dual materials are respected; otherwise triangles below an
 * area percentile are treated as pips (engraved numbers are much smaller).
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {{ bodyGroup: number, pipGroup: number }}
 */
export function ensureBodyPipGroups(geometry) {
    if (geometry.userData.bodyPipGroupsReady) {
        return {
            bodyGroup: geometry.userData.bodyGroupIndex ?? 0,
            pipGroup: geometry.userData.pipGroupIndex ?? 1
        };
    }

    if (geometry.groups?.length >= 2) {
        geometry.userData.bodyPipGroupsReady = true;
        geometry.userData.bodyGroupIndex = 0;
        geometry.userData.pipGroupIndex = 1;
        return { bodyGroup: 0, pipGroup: 1 };
    }

    const pos = geometry.attributes.position;
    const index = geometry.index;
    const triCount = index ? index.count / 3 : pos.count / 3;

    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const maxEdge = (geometry.boundingSphere?.radius ?? 1) * 0.6;
    const maxEdgeSq = maxEdge * maxEdge;

    const areas = new Float32Array(triCount);

    const getVertex = (i) => {
        const vi = index ? index.getX(i) : i;
        return { x: pos.getX(vi), y: pos.getY(vi), z: pos.getZ(vi) };
    };

    for (let t = 0; t < triCount; t++) {
        const va = getVertex(t * 3);
        const vb = getVertex(t * 3 + 1);
        const vc = getVertex(t * 3 + 2);

        _a.set(va.x, va.y, va.z);
        _b.set(vb.x, vb.y, vb.z);
        _c.set(vc.x, vc.y, vc.z);

        _e1.subVectors(_b, _a);
        _e2.subVectors(_c, _a);
        _n.crossVectors(_e1, _e2);

        if (_n.lengthSq() < 1e-10) continue;
        if (_e1.lengthSq() > maxEdgeSq || _e2.lengthSq() > maxEdgeSq || _b.distanceToSquared(_c) > maxEdgeSq) continue;

        areas[t] = _n.length() * 0.5;
    }

    const sorted = Array.from(areas).filter((a) => a > 0).sort((x, y) => x - y);
    const percentile = sorted[Math.max(0, Math.floor(sorted.length * 0.22) - 1)] ?? 0;
    const areaThreshold = Math.max(percentile, sorted[0] ?? 0) * 1.15;

    const bodyTris = [];
    const pipTris = [];

    for (let t = 0; t < triCount; t++) {
        const tri = index
            ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
            : [t * 3, t * 3 + 1, t * 3 + 2];
        const area = areas[t];
        if (area > 0 && area <= areaThreshold) pipTris.push(...tri);
        else bodyTris.push(...tri);
    }

    if (!pipTris.length || !bodyTris.length) {
        geometry.userData.bodyPipGroupsReady = true;
        geometry.userData.bodyGroupIndex = 0;
        geometry.userData.pipGroupIndex = 0;
        return { bodyGroup: 0, pipGroup: 0 };
    }

    const merged = new Uint32Array(bodyTris.length + pipTris.length);
    merged.set(bodyTris, 0);
    merged.set(pipTris, bodyTris.length);

    geometry.setIndex(new THREE.BufferAttribute(merged, 1));
    geometry.clearGroups();
    geometry.addGroup(0, bodyTris.length, 0);
    geometry.addGroup(bodyTris.length, pipTris.length, 1);

    geometry.userData.bodyPipGroupsReady = true;
    geometry.userData.bodyGroupIndex = 0;
    geometry.userData.pipGroupIndex = 1;

    return { bodyGroup: 0, pipGroup: 1 };
}
