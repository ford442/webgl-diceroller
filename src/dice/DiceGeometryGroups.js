import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Turn a loaded die hull into the clean, origin-centred, Y-up geometry the rest
 * of the dice code assumes.
 *
 * The shipped GLBs are Draco + `KHR_mesh_quantization`, so GLTFLoader hands over
 * positions as *normalized int16* (range -1..1). Baking the node transform into
 * such an attribute is lossy: `applyMatrix4` adds the node's translation (up to
 * ~2 units on the d4, d8, d10 and d20), and any vertex pushed past 1.0 wraps
 * around in the Int16Array. The d4, d8 and d20 came out with their top vertices
 * folded to the bottom — mis-shapen on screen, and with face normals computed
 * from the folded mesh. Every attribute is therefore widened to float32 before
 * a single transform is applied.
 *
 * @param {THREE.BufferGeometry} source
 * @param {THREE.Matrix4} matrixWorld  transform baked into the vertices (node scale/translation)
 * @returns {THREE.BufferGeometry} a new geometry; `source` is left untouched
 */
export function bakeDieGeometry(source, matrixWorld) {
    const geometry = source.clone();
    for (const name of Object.keys(geometry.attributes)) {
        const attr = /** @type {THREE.BufferAttribute} */ (geometry.getAttribute(name));
        if (attr.array instanceof Float32Array) continue;
        const wide = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) {
            for (let k = 0; k < attr.itemSize; k++) {
                wide[i * attr.itemSize + k] = attr.getComponent(i, k); // de-normalizes
            }
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(wide, attr.itemSize));
    }
    geometry.center();
    geometry.applyMatrix4(matrixWorld);
    geometry.rotateX(-Math.PI / 2);
    geometry.center();
    return geometry;
}

/**
 * The shipped hulls carry their numerals as recessed geometry in a second draw
 * group. Until they are re-exported with flat faces, that relief is the cheapest
 * glyph source we have for the default numbering: the die material wears two
 * instances of itself, one per group, both built from the same descriptor entry.
 * `hasBakedMarkings` is how it knows there is a second group to dress.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {boolean} present
 */
function setBakedMarkingsFlag(geometry, present) {
    geometry.userData.hasBakedMarkings = present;
}

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
            pipGroup: geometry.userData.pipGroupIndex ?? 1,
        };
    }

    if (geometry.groups?.length >= 2) {
        setBakedMarkingsFlag(geometry, true);
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
        if (
            _e1.lengthSq() > maxEdgeSq ||
            _e2.lengthSq() > maxEdgeSq ||
            _b.distanceToSquared(_c) > maxEdgeSq
        )
            continue;

        areas[t] = _n.length() * 0.5;
    }

    const sorted = Array.from(areas)
        .filter((a) => a > 0)
        .sort((x, y) => x - y);
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
        setBakedMarkingsFlag(geometry, false);
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

    setBakedMarkingsFlag(geometry, true);
    geometry.userData.bodyPipGroupsReady = true;
    geometry.userData.bodyGroupIndex = 0;
    geometry.userData.pipGroupIndex = 1;

    return { bodyGroup: 0, pipGroup: 1 };
}
