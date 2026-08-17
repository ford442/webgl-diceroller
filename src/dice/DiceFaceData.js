import * as THREE from 'three';
import { getDieSides, getMassBiasRatio } from './DicePhysicsPresets.js';
import faceMaps from './diceFaceMaps.json';

function _computeFaceNormals(geometry) {
    const CLUSTER_THRESHOLD = 0.98;
    const faceClusters = [];

    const pos = geometry.attributes.position;
    const index = geometry.index;

    const _a = new THREE.Vector3();
    const _b = new THREE.Vector3();
    const _c = new THREE.Vector3();
    const _e1 = new THREE.Vector3();
    const _e2 = new THREE.Vector3();
    const _n = new THREE.Vector3();

    const getVertex = (i) => {
        const vi = index ? index.getX(i) : i;
        return { x: pos.getX(vi), y: pos.getY(vi), z: pos.getZ(vi) };
    };

    const triCount = index ? index.count / 3 : pos.count / 3;

    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const maxEdge = (geometry.boundingSphere?.radius ?? 1) * 0.6;
    const maxEdgeSq = maxEdge * maxEdge;

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
        const area = _n.length() * 0.5;
        _n.normalize();

        let cluster = null;
        for (const existing of faceClusters) {
            if (existing.normal.dot(_n) > CLUSTER_THRESHOLD) {
                cluster = existing;
                break;
            }
        }
        if (!cluster) {
            cluster = {
                normal: _n.clone(),
                sum: new THREE.Vector3(),
                area: 0,
            };
            faceClusters.push(cluster);
        }
        cluster.sum.addScaledVector(_n, area);
        cluster.area += area;
    }

    return faceClusters.map((cluster) => {
        const normal =
            cluster.sum.lengthSq() > 1e-10
                ? cluster.sum.clone().normalize()
                : cluster.normal.clone();
        /** @type {import('three').Vector3 & { userData: { area: number } }} */ (normal).userData =
            {
                area: cluster.area,
            };
        return normal;
    });
}

function _selectPrincipalFaceNormals(allNormals, sides) {
    if (!allNormals.length) return [];
    if (allNormals.length <= sides) return allNormals.map((n) => n.clone());

    const selected = [];
    const byArea = allNormals
        .slice()
        .sort((a, b) => (b.userData?.area ?? 0) - (a.userData?.area ?? 0));

    for (const normal of byArea) {
        if (selected.length >= sides) break;
        if (selected.every((existing) => existing.dot(normal) < 0.92)) {
            selected.push(normal.clone());
        }
    }

    for (const normal of byArea) {
        if (selected.length >= sides) break;
        if (!selected.some((existing) => existing.dot(normal) > 0.98)) {
            selected.push(normal.clone());
        }
    }

    return selected;
}

const FACE_VALUE_NORMAL_MAPS = faceMaps;

function _assignFaceValues(faceNormals, type = null) {
    const n = faceNormals.length;
    if (n === 0) return [];

    const mappedNormals = FACE_VALUE_NORMAL_MAPS[type];
    if (mappedNormals?.length === n) {
        const assigned = faceNormals.map((faceNormal) => {
            let best = null;
            let bestDot = -Infinity;
            for (const entry of mappedNormals) {
                const normal = new THREE.Vector3(...entry.normal).normalize();
                const dot = faceNormal.dot(normal);
                if (dot > bestDot) {
                    bestDot = dot;
                    best = entry;
                }
            }
            return bestDot > 0.92 ? best.value : null;
        });

        if (assigned.every((value) => value !== null) && new Set(assigned).size === n) {
            return assigned;
        }
        console.warn(
            `[DiceReader] Explicit face map did not match ${type}; using Y-sort fallback`,
            assigned
        );
    }

    const sorted = faceNormals.map((fn, i) => ({ i, y: fn.y })).sort((a, b) => a.y - b.y);
    const values = new Array(n);
    for (let i = 0; i < n; i++) {
        values[sorted[i].i] = i + 1;
    }
    return values;
}

function _getFaceNormalForValue(faceNormals, faceValues, targetValue) {
    if (!faceNormals || !faceValues) return null;
    const index = faceValues.findIndex((value) => value === targetValue);
    return index >= 0 ? (faceNormals[index]?.clone() ?? null) : null;
}

/** Precompute face normals, value map, and mass-bias offset on a die template mesh. */
export function finalizeDieTemplateUserData(cleanMesh, type) {
    const sides = getDieSides(type);
    const allNormals = _computeFaceNormals(cleanMesh.geometry);
    const faceNormals = _selectPrincipalFaceNormals(allNormals, sides);
    cleanMesh.userData.faceNormals = faceNormals;
    cleanMesh.userData.faceValues = _assignFaceValues(faceNormals, type);

    const oneFaceNormal = _getFaceNormalForValue(
        cleanMesh.userData.faceNormals,
        cleanMesh.userData.faceValues,
        1
    );
    if (oneFaceNormal && cleanMesh.geometry.boundingBox) {
        const bboxSize = new THREE.Vector3();
        cleanMesh.geometry.boundingBox.getSize(bboxSize);
        const massBiasMagnitude = bboxSize.y * getMassBiasRatio();
        cleanMesh.userData.massBiasOffset = oneFaceNormal.multiplyScalar(massBiasMagnitude);
    } else {
        cleanMesh.userData.massBiasOffset = null;
    }
}
