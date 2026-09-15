import * as THREE from 'three';

/**
 * Per-face tangent frames for a die hull.
 *
 * The markings no longer live in the mesh, so the material has to work out where
 * a face *is* before it can stamp a glyph on it. For each face this derives:
 *
 *   - the outward normal (from the template's clustered face normals),
 *   - the face centre and its inradius, so a glyph fills the face without
 *     running over an edge, at any hull size,
 *   - an "up" pointing at an edge midpoint rather than a corner, so numerals sit
 *     square on the face and keep the same orientation every frame.
 *
 * The face polygon is read from the triangles that lie *in* the face plane, not
 * from every vertex near it: the shipped hulls are chamfered and carry their
 * numerals as recessed geometry, and both would otherwise be mistaken for the
 * face's own outline.
 *
 * Computed once per template geometry and cached on it; the shader then only
 * needs "which face am I on", which is a dot product.
 */

/** Triangles this parallel to the face normal are part of the face itself. */
const FACE_NORMAL_THRESHOLD = 0.995;
/** How far below the face plane a triangle may sit and still count, in face radii. */
const FACE_PLANE_TOLERANCE = 0.06;

/**
 * Sides of one face, by how many faces the hull has. The shapes we ship are
 * regular: triangles on the d4/d8/d20, squares on the d6, kites on the d10 and
 * pentagons on the d12.
 */
const FACE_POLYGON_SIDES = { 4: 3, 6: 4, 8: 3, 10: 4, 12: 5, 20: 3 };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _edge1 = new THREE.Vector3();
const _edge2 = new THREE.Vector3();
const _triNormal = new THREE.Vector3();

/** Vertices of the triangles that make up one flat face. */
function collectFaceVertices(geometry, normal) {
    const positions = geometry.attributes.position;
    const index = geometry.index;
    const triangleCount = index ? index.count / 3 : positions.count / 3;

    const getIndex = (i) => (index ? index.getX(i) : i);

    const candidates = [];
    let maxOffset = -Infinity;

    for (let t = 0; t < triangleCount; t++) {
        _a.fromBufferAttribute(positions, getIndex(t * 3));
        _b.fromBufferAttribute(positions, getIndex(t * 3 + 1));
        _c.fromBufferAttribute(positions, getIndex(t * 3 + 2));

        _edge1.subVectors(_b, _a);
        _edge2.subVectors(_c, _a);
        _triNormal.crossVectors(_edge1, _edge2);
        if (_triNormal.lengthSq() < 1e-12) continue;
        _triNormal.normalize();
        if (_triNormal.dot(normal) < FACE_NORMAL_THRESHOLD) continue;

        const offset = (_a.dot(normal) + _b.dot(normal) + _c.dot(normal)) / 3;
        if (offset > maxOffset) maxOffset = offset;
        candidates.push({ offset, vertices: [_a.clone(), _b.clone(), _c.clone()] });
    }

    if (!candidates.length) return { vertices: [], planeOffset: 0 };

    // Coplanar triangles only: a recessed numeral is parallel to its face but
    // sits below it, and must not stretch the face's outline.
    const tolerance = Math.max(Math.abs(maxOffset) * FACE_PLANE_TOLERANCE, 1e-4);
    const vertices = [];
    for (const candidate of candidates) {
        if (maxOffset - candidate.offset > tolerance) continue;
        vertices.push(...candidate.vertices);
    }

    return { vertices, planeOffset: maxOffset };
}

/**
 * Principal orientation of an n-fold symmetric polygon: the circular mean of
 * its vertex angles taken n times over. Chamfered corners and uneven tessellation
 * move individual vertices; they barely move this.
 */
function principalAngle(planar, sides) {
    let sumSin = 0;
    let sumCos = 0;
    for (const point of planar) {
        sumSin += point.radius * Math.sin(sides * point.angle);
        sumCos += point.radius * Math.cos(sides * point.angle);
    }
    if (Math.abs(sumSin) < 1e-9 && Math.abs(sumCos) < 1e-9) return 0;
    return Math.atan2(sumSin, sumCos) / sides;
}

/** Smallest absolute angle between two directions, in radians. */
function angularDistance(a, b) {
    const delta = Math.abs(a - b) % (Math.PI * 2);
    return delta > Math.PI ? Math.PI * 2 - delta : delta;
}

function frameForNormal(geometry, normal, sides, radiusHint) {
    const basisSeed =
        Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const basisU = new THREE.Vector3().crossVectors(basisSeed, normal).normalize();
    const basisV = new THREE.Vector3().crossVectors(normal, basisU).normalize();

    const fallback = () => ({
        normal: normal.clone(),
        tangent: basisU.clone(),
        bitangent: basisV.clone(),
        center: normal.clone().multiplyScalar(radiusHint * 0.6),
        radius: radiusHint * 0.35,
    });

    const { vertices } = collectFaceVertices(geometry, normal);
    if (!vertices.length) return fallback();

    const center = new THREE.Vector3();
    for (const vertex of vertices) center.add(vertex);
    center.multiplyScalar(1 / vertices.length);

    const offset = new THREE.Vector3();
    const planar = [];
    let circumradius = 0;
    for (const vertex of vertices) {
        offset.subVectors(vertex, center).addScaledVector(normal, -offset.dot(normal));
        const radius = offset.length();
        if (radius < 1e-6) continue;
        circumradius = Math.max(circumradius, radius);
        planar.push({ radius, angle: Math.atan2(offset.dot(basisV), offset.dot(basisU)) });
    }
    if (!planar.length || circumradius < 1e-6) return fallback();

    const step = (Math.PI * 2) / sides;
    const halfStep = step / 2;
    // The principal angle points at a corner; half a step on is an edge midpoint.
    const cornerAngle = principalAngle(planar, sides);

    // Upright and deterministic: of the `sides` equivalent orientations, take the
    // one closest to world up projected onto the face.
    const reference = new THREE.Vector3(0, 1, 0).addScaledVector(normal, -normal.y);
    const referenceAngle =
        reference.lengthSq() < 1e-8 ? 0 : Math.atan2(reference.dot(basisV), reference.dot(basisU));

    let upAngle = cornerAngle + halfStep;
    let bestDelta = Infinity;
    for (let k = 0; k < sides; k++) {
        const candidate = cornerAngle + halfStep + k * step;
        const delta = angularDistance(candidate, referenceAngle);
        if (delta < bestDelta) {
            bestDelta = delta;
            upAngle = candidate;
        }
    }

    const bitangent = basisU
        .clone()
        .multiplyScalar(Math.cos(upAngle))
        .addScaledVector(basisV, Math.sin(upAngle))
        .normalize();
    // `bitangent` is the glyph's up; the material reads `tangent` as its right
    // and rebuilds up as cross(normal, tangent).
    const tangent = new THREE.Vector3().crossVectors(bitangent, normal).normalize();

    // Inradius of a regular n-gon: the largest glyph the face can hold edge to edge.
    const inradius = circumradius * Math.cos(halfStep);

    return { normal: normal.clone(), tangent, bitangent, center, radius: inradius };
}

/**
 * Frames indexed by natural face value (1..faceCount), so `frames[value - 1]`
 * is the face that reads as `value` — the same indexing `NumberingSpec.sequence`
 * uses.
 *
 * @param {THREE.Mesh} template a die template with `faceNormals` / `faceValues`
 * @returns {Array<{ normal: THREE.Vector3, tangent: THREE.Vector3, bitangent: THREE.Vector3, center: THREE.Vector3, radius: number }>}
 */
export function computeFaceFrames(template) {
    const geometry = template?.geometry;
    const faceNormals = template?.userData?.faceNormals;
    const faceValues = template?.userData?.faceValues;
    if (!geometry?.attributes?.position || !faceNormals?.length || !faceValues?.length) return [];

    const cached = geometry.userData.diceFaceFrames;
    if (cached) return cached;

    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const radiusHint = geometry.boundingSphere?.radius ?? 1;
    const sides = FACE_POLYGON_SIDES[faceNormals.length] ?? 4;

    const frames = [];
    for (let i = 0; i < faceNormals.length; i++) {
        const value = faceValues[i];
        if (!Number.isInteger(value) || value < 1) continue;
        frames[value - 1] = frameForNormal(geometry, faceNormals[i], sides, radiusHint);
    }

    // A hull whose face map skipped a value would leave a hole; fill it with a
    // frame the material will simply find no glyph on.
    for (let i = 0; i < frames.length; i++) {
        if (frames[i]) continue;
        frames[i] = {
            normal: new THREE.Vector3(0, 1, 0),
            tangent: new THREE.Vector3(1, 0, 0),
            bitangent: new THREE.Vector3(0, 0, 1),
            center: new THREE.Vector3(),
            radius: radiusHint * 0.35,
        };
    }

    geometry.userData.diceFaceFrames = frames;
    return frames;
}
