import * as THREE from 'three';
import { INCLUSION_TYPE_INDEX, MARKING_STYLE_INDEX } from './DiceShadingParams.js';

/**
 * The die surface, written once.
 *
 * `DiceFaceMarkingShader` (GLSL, `WebGLRenderer`) and `DiceFaceMarkingNodeMaterial`
 * (TSL, `WebGPURenderer`) both build *this* graph through a `ShaderKit`, so a
 * marking term — a new inclusion octave, another glyph style — exists in both
 * renderers or in neither. The twins only decide where the results plug into
 * their lighting model (`onBeforeCompile` chunks vs `colorNode` & co.).
 *
 * Three things happen here that used to need an asset:
 *   1. the glyph is found by projecting the fragment onto its face's own frame
 *      and sampling a runtime SDF atlas — numbering and glyph set are uniforms;
 *   2. the marking style is a parameter set (cut, inlay, paint), not a mesh;
 *   3. inclusions are a domain-warped noise term in the body, not geometry.
 *
 * Branches on style / inclusion type / atlas-vs-baked are resolved in JS when
 * the graph is built, so they belong in the WebGL program cache key (see
 * `diceGraphKey`) — two materials that build different graphs must not share
 * a compiled program.
 *
 * Graph inputs (`u`) are whatever the backend calls them: uniform names in
 * GLSL, uniform nodes in TSL.
 */

/** Uniform array length — the largest hull we put on the table. */
export const DICE_MAX_FACES = 20;

/** Octaves of the inclusion fbm. */
export const DICE_FBM_OCTAVES = 3;

/** Below this alignment the fragment is on a bevel between faces: no glyph. */
const FACE_ALIGNMENT_MIN = 0.55;

/**
 * @typedef {object} DiceGraphConfig
 * @property {boolean} atlasMode   glyphs come from the runtime atlas
 * @property {boolean} bakedGroup  this material draws the hull's authored-marking group
 * @property {number} markingStyle `MARKING_STYLE_INDEX`
 * @property {number} inclusionType `INCLUSION_TYPE_INDEX`
 */

/** Everything the graph branches on at build time, as a cache key. */
export function diceGraphKey({ atlasMode, bakedGroup, markingStyle, inclusionType }) {
    return [
        atlasMode ? 'atlas' : 'baked',
        bakedGroup ? 'marks' : 'body',
        markingStyle,
        inclusionType,
    ].join(':');
}

/**
 * On the atlas path, the hull's authored numerals are stale relief: the
 * descriptor no longer says what the mesh carved. That group's shading is
 * flattened back into the face (clearcoat included — a bright clearcoat
 * highlight traces the old glyph as clearly as diffuse would) rather than left
 * as a ghost of the old numbering under the new one.
 */
export function diceFlattensRelief({ atlasMode, bakedGroup }) {
    return atlasMode && bakedGroup;
}

/** Whether the marking moves the shading normal at all (paint sits on top). */
export function diceBendsNormal({ atlasMode, markingStyle }) {
    return atlasMode && markingStyle !== MARKING_STYLE_INDEX.painted;
}

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------

/** @param {any} k ShaderKit */
export function diceNoise(k) {
    const hash = k.fn('diceHash', 'float', [['vec3', 'p']], (p) =>
        k.fract(k.mul(k.sin(k.dot(p, k.vec3(127.1, 311.7, 74.7))), 43758.5453123))
    );

    const noise = k.fn('diceNoise', 'float', [['vec3', 'p']], (p) => {
        const i = k.variable('vec3', k.floor(p));
        const f = k.variable('vec3', k.fract(p));
        const t = k.variable('vec3', k.mul(k.mul(f, f), k.sub(3, k.mul(2, f))));
        const corner = (x, y, z) => hash(k.add(i, k.vec3(x, y, z)));
        const tx = k.swizzle(t, 'x');
        const ty = k.swizzle(t, 'y');
        return k.mix(
            k.mix(
                k.mix(corner(0, 0, 0), corner(1, 0, 0), tx),
                k.mix(corner(0, 1, 0), corner(1, 1, 0), tx),
                ty
            ),
            k.mix(
                k.mix(corner(0, 0, 1), corner(1, 0, 1), tx),
                k.mix(corner(0, 1, 1), corner(1, 1, 1), tx),
                ty
            ),
            k.swizzle(t, 'z')
        );
    });

    const fbm = k.fn('diceFbm', 'float', [['vec3', 'p']], (p) => {
        let sum = null;
        let point = p;
        let amplitude = 0.5;
        for (let octave = 0; octave < DICE_FBM_OCTAVES; octave++) {
            const term = k.mul(noise(point), amplitude);
            sum = sum === null ? term : k.add(sum, term);
            point = k.mul(point, 2.03);
            amplitude *= 0.5;
        }
        return sum;
    });

    return { hash, noise, fbm };
}

// ---------------------------------------------------------------------------
// inclusions
// ---------------------------------------------------------------------------

/**
 * Inclusion terms by `INCLUSION_TYPE_INDEX`, each `(k, noise, p) → 0..1`.
 * A new inclusion is a row here plus an enum entry — nothing per backend.
 */
export const DICE_INCLUSION_TERMS = {
    // swirl: fbm warped by fbm, then banded so it reads as poured colour
    [INCLUSION_TYPE_INDEX.swirl]: (k, n, p) => {
        const warped = n.fbm(k.add(k.mul(p, 0.9), k.mul(n.fbm(k.mul(p, 1.7)), 1.6)));
        return k.smoothstep(0.35, 0.75, k.add(k.mul(k.sin(k.mul(warped, 12.566)), 0.5), 0.5));
    },
    // galaxy: a dense dark nebula with hard pinpricks of light in it
    [INCLUSION_TYPE_INDEX.galaxy]: (k, n, p) => {
        const cloud = k.pow(k.clamp(k.mul(n.fbm(k.mul(p, 1.4)), 1.6), 0, 1), 2.2);
        const stars = k.step(0.88, n.hash(k.floor(k.mul(p, 7))));
        return k.clamp(k.add(cloud, k.mul(stars, 0.8)), 0, 1);
    },
    // glitter: sparse, high-frequency flakes
    [INCLUSION_TYPE_INDEX.glitter]: (k, n, p) =>
        k.mul(k.step(0.94, n.hash(k.floor(k.mul(p, 11)))), 0.9),
};

/**
 * Inclusions are a body term, not geometry. Type `none` builds nothing, so it
 * costs the same as no inclusion at all; intensity stays a uniform.
 */
export function diceInclusion(k, u, base, inclusionType) {
    const term = DICE_INCLUSION_TERMS[inclusionType];
    if (!term) return base;
    const p = k.variable('vec3', k.mul(u.position, 6));
    const amount = k.variable('float', term(k, diceNoise(k), p));
    return k.mix(base, u.inclusionColor, k.clamp(k.mul(amount, u.inclusionIntensity), 0, 1));
}

// ---------------------------------------------------------------------------
// markings
// ---------------------------------------------------------------------------

/**
 * Coverage of this fragment by its face's glyph, the edge ridge a cut or inlay
 * has a wall on, the in-plane SDF gradient the normal bends along, and the flat
 * face normal.
 *
 * @param {any} k ShaderKit
 * @param {any} u graph inputs
 * @param {DiceGraphConfig} config
 */
export function diceMarking(k, u, { atlasMode, bakedGroup }) {
    if (!atlasMode) {
        // The mesh already carries this numbering as relief, in its own draw
        // group; its normals do the shaping, so the group flag is the coverage.
        return {
            coverage: k.float(bakedGroup ? 1 : 0),
            edge: k.float(0),
            gradient: k.vec3(0, 0, 0),
            faceNormal: k.normalize(u.normal),
        };
    }

    // Nearest face wins outright. The alignment threshold below decides whether
    // a *glyph* belongs here, but the face normal is wanted either way: on the
    // wall of a baked numeral the interpolated normal is the wall's, not the face's.
    const n = k.variable('vec3', k.normalize(u.normal));
    const best = k.variable('int', k.int(0));
    const bestDot = k.variable('float', -2);
    k.Loop(DICE_MAX_FACES, (i) => {
        k.If(k.lessThan(i, u.faceCount), () => {
            const alignment = k.variable(
                'float',
                k.dot(n, k.swizzle(k.element(u.faceNormalRadius, i), 'xyz'))
            );
            k.If(k.greaterThan(alignment, bestDot), () => {
                k.assign(bestDot, alignment);
                k.assign(best, i);
            });
        });
    });

    const normalRadius = k.variable('vec4', k.element(u.faceNormalRadius, best));
    const tangent = k.variable('vec3', k.swizzle(k.element(u.faceTangent, best), 'xyz'));
    const center = k.variable('vec4', k.element(u.faceCenter, best));
    const cell = k.variable('vec4', k.element(u.faceCell, best));
    const faceNormal = k.swizzle(normalRadius, 'xyz');
    const bitangent = k.variable('vec3', k.cross(faceNormal, tangent));

    // w is the face's inradius: the largest glyph it can hold edge to edge.
    const halfExtent = k.max(k.mul(k.swizzle(normalRadius, 'w'), u.glyphScale), 1e-4);
    const rel = k.variable('vec3', k.sub(u.position, k.swizzle(center, 'xyz')));
    const local = k.div(k.vec2(k.dot(rel, tangent), k.dot(rel, bitangent)), halfExtent);
    const unflipped = k.variable('vec2', k.add(k.mul(local, 0.5), 0.5));
    // the atlas was rasterised with a top-left origin
    const uv = k.variable(
        'vec2',
        k.vec2(k.swizzle(unflipped, 'x'), k.sub(1, k.swizzle(unflipped, 'y')))
    );
    const uvX = k.swizzle(uv, 'x');
    const uvY = k.swizzle(uv, 'y');

    // Branch-free: fwidth() below needs every fragment of the quad to reach it.
    // Off-glyph fragments — on a bevel, on a face the plan left blank (centre.w
    // 0, e.g. a Fudge blank), or outside the glyph's square — are gated to 0.
    const gate = k.variable(
        'float',
        k.mul(
            k.mul(k.step(FACE_ALIGNMENT_MIN, bestDot), k.step(0.5, k.swizzle(center, 'w'))),
            k.mul(k.mul(k.step(0, uvX), k.step(uvX, 1)), k.mul(k.step(0, uvY), k.step(uvY, 1)))
        )
    );

    const sampleSdf = (at) =>
        k.swizzle(
            k.sample(
                u.atlas,
                k.add(
                    k.swizzle(cell, 'xy'),
                    k.mul(
                        k.clamp(at, k.vec2(0.003, 0.003), k.vec2(0.997, 0.997)),
                        k.swizzle(cell, 'zw')
                    )
                )
            ),
            'r'
        );

    const signedDistance = k.variable('float', k.sub(sampleSdf(uv), 0.5));
    const width = k.variable('float', k.add(k.fwidth(signedDistance), 1e-5));
    const coverage = k.variable(
        'float',
        k.mul(k.smoothstep(k.negate(width), width, signedDistance), gate)
    );

    // A ridge that peaks on the outline: this is where a cut or an inlay has a
    // wall, and so where the normal should bend. Squared by multiplication, not
    // pow(): the ratio is negative outside the glyph, and pow() of a negative
    // base is undefined (NaN on some drivers).
    const edgeRatio = k.variable('float', k.div(signedDistance, k.add(k.mul(3, width), 0.015)));
    const edge = k.variable('float', k.mul(k.exp(k.negate(k.mul(edgeRatio, edgeRatio))), gate));

    const texel = 1 / 32;
    const dx = k.sub(
        sampleSdf(k.add(uv, k.vec2(texel, 0))),
        sampleSdf(k.sub(uv, k.vec2(texel, 0)))
    );
    const dy = k.sub(
        sampleSdf(k.add(uv, k.vec2(0, texel))),
        sampleSdf(k.sub(uv, k.vec2(0, texel)))
    );
    const gradient = k.variable(
        'vec3',
        k.mul(k.sub(k.mul(tangent, dx), k.mul(bitangent, dy)), gate)
    );

    return { coverage, edge, gradient, faceNormal };
}

/** Body colour with the marking laid over it. */
export function diceAlbedo(k, u, body, coverage, markingStyle) {
    if (markingStyle === MARKING_STYLE_INDEX.engraved) {
        // engraved: the body colour continues into the cut, just shadowed
        const shadowed = k.mul(body, k.mix(1, 0.42, coverage));
        return k.mix(shadowed, k.mul(u.markingColor, 0.55), k.mul(coverage, 0.3));
    }
    // inlaid and painted both read as the marking colour; the difference is in
    // roughness and in how far the surface moves (`diceNormalBend`).
    return k.mix(body, u.markingColor, coverage);
}

/** Paint and inlay are duller (or glossier) than the body they sit in. */
export function diceRoughness(k, u, base, coverage) {
    return k.mix(base, u.markingRoughness, coverage);
}

/** Only markings glow. */
export function diceEmissive(k, emissive, coverage) {
    return k.mul(emissive, coverage);
}

/**
 * Object-space offset the shading normal bends by inside a marking, or `null`
 * when the style never moves the surface. Engraved cuts a full depth; an inlay
 * only dips to its filled surface; paint sits on top.
 */
export function diceNormalBend(k, u, marking, config) {
    if (!diceBendsNormal(config)) return null;
    const sink = config.markingStyle === MARKING_STYLE_INDEX.engraved ? -1 : -0.5;
    return k.mul(marking.gradient, k.mul(k.mul(u.markingDepth, marking.edge), 2.5 * sink));
}

/**
 * The view-space shading normal.
 *
 * @param {any} k
 * @param {any} u graph inputs
 * @param {object} view
 * @param {any} view.normal   the renderer's view-space normal so far
 * @param {(v: any) => any} view.toView object-space direction → view space, unnormalised
 * @param {ReturnType<typeof diceMarking>} marking
 * @param {DiceGraphConfig} config
 * @returns {{ flat: any, normal: any }} `flat` (or `null`) is the relief-free
 *   face normal, for the clearcoat / geometry-roughness term too; `normal` (or
 *   `null` when unchanged) is what the surface shades with.
 */
export function diceViewNormal(k, u, view, marking, config) {
    const flat = diceFlattensRelief(config)
        ? k.variable('vec3', k.normalize(view.toView(marking.faceNormal)))
        : null;
    const base = flat ?? view.normal;
    const bend = diceNormalBend(k, u, marking, config);
    const normal = bend ? k.normalize(k.add(base, view.toView(bend))) : flat;
    return { flat, normal };
}

// ---------------------------------------------------------------------------
// uniform values
// ---------------------------------------------------------------------------

/**
 * Every uniform value the graph reads, from the shading params and the face
 * binding — the single dictionary both twins upload.
 *
 * Face arrays are fixed-length: unused slots carry centre.w = 0, i.e. "no glyph
 * on this face", which is also how a blank Fudge face reads.
 *
 * @param {import('./DiceShadingParams.js').DiceShadingParams} params
 * @param {{ frames: any[], atlas: any, glyphs: any[] } | null} binding
 */
export function diceUniformValues(params, binding) {
    const frames = binding?.frames ?? [];
    const count = binding?.atlas ? Math.min(frames.length, DICE_MAX_FACES) : 0;
    const faceCell = [];
    const faceNormalRadius = [];
    const faceTangent = [];
    const faceCenter = [];

    for (let i = 0; i < DICE_MAX_FACES; i++) {
        const frame = i < count ? frames[i] : null;
        const glyph = frame ? binding.glyphs[i] : null;
        const rect = glyph ? (binding.atlas.cells[glyph.key] ?? null) : null;
        faceCell.push(rect ? rect.clone() : new THREE.Vector4(0, 0, 0, 0));
        faceNormalRadius.push(
            frame
                ? new THREE.Vector4(frame.normal.x, frame.normal.y, frame.normal.z, frame.radius)
                : new THREE.Vector4(0, 0, 0, 0)
        );
        faceTangent.push(
            frame
                ? new THREE.Vector4(frame.tangent.x, frame.tangent.y, frame.tangent.z, 0)
                : new THREE.Vector4(0, 0, 0, 0)
        );
        // w doubles as "this face has a glyph" — a face the plan skipped stays blank.
        faceCenter.push(
            frame
                ? new THREE.Vector4(frame.center.x, frame.center.y, frame.center.z, rect ? 1 : 0)
                : new THREE.Vector4(0, 0, 0, 0)
        );
    }

    return {
        glyphAtlas: binding?.atlas?.texture ?? null,
        faceCell,
        faceNormalRadius,
        faceTangent,
        faceCenter,
        faceCount: count,
        markingColor: new THREE.Color(params.markingColor),
        markingDepth: params.markingDepth,
        markingRoughness: params.markingRoughness,
        glyphScale: params.glyphScale,
        inclusionColor: new THREE.Color(params.inclusionColor),
        inclusionIntensity: params.inclusionIntensity,
    };
}

/** Build-time branches for one material instance. */
export function diceGraphConfig(params, { atlasMode, bakedGroup }) {
    return {
        atlasMode,
        bakedGroup,
        markingStyle: params.markingStyle,
        inclusionType: params.inclusionType,
    };
}
