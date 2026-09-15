/**
 * GLSL for the descriptor-driven die surface (WebGL twin).
 *
 * Shared by `DiceFaceMarkingMaterial` (this path) and mirrored node-for-node by
 * `DiceFaceMarkingNodeMaterial` (WebGPU/TSL), the way `GodRayShader` and
 * `GodRayNodeMaterial` mirror each other. Both consume `DiceShadingParams`, so
 * "engraved on a swirled gemstone d10" means one thing in both backends.
 *
 * Three things happen here that used to need an asset:
 *   1. the glyph is found by projecting the fragment onto its face's own frame
 *      and sampling a runtime SDF atlas — numbering and glyph set are uniforms;
 *   2. the marking style is a parameter set (cut, inlay, paint), not a mesh;
 *   3. inclusions are a domain-warped noise term in the body, not geometry.
 */

/** Uniform array length — the largest hull we put on the table. */
export const DICE_MAX_FACES = 20;

/** Injected ahead of `void main()` in the vertex stage. */
export const DICE_VERTEX_HEADER = /* glsl */ `
varying vec3 vDicePosition;
varying vec3 vDiceNormal;
`;

export const DICE_VERTEX_NORMAL = /* glsl */ `
vDiceNormal = objectNormal;
`;

export const DICE_VERTEX_POSITION = /* glsl */ `
vDicePosition = transformed;
`;

export const DICE_FRAGMENT_HEADER = /* glsl */ `
uniform mat3 normalMatrix;

uniform sampler2D uGlyphAtlas;
uniform vec4 uFaceCell[DICE_MAX_FACES];
uniform vec4 uFaceNormalRadius[DICE_MAX_FACES];
uniform vec4 uFaceTangent[DICE_MAX_FACES];
uniform vec4 uFaceCenter[DICE_MAX_FACES];
uniform int uFaceCount;

uniform vec3 uMarkingColor;
uniform float uMarkingStyle;
uniform float uMarkingDepth;
uniform float uMarkingRoughness;
uniform float uGlyphScale;
/** 0 = read the mesh's own relief, 1 = stamp the atlas. */
uniform float uAtlasMarkings;
/** 1 on the draw group holding the mesh's authored markings, 0 on the body. */
uniform float uBakedGroup;

uniform vec3 uInclusionColor;
uniform float uInclusionType;
uniform float uInclusionIntensity;

varying vec3 vDicePosition;
varying vec3 vDiceNormal;

float gDiceCoverage;
float gDiceEdge;
vec3 gDiceGradient;
/** Object-space normal of the flat face this fragment belongs to. */
vec3 gDiceFaceNormal;

float diceHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float diceNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = diceHash(i + vec3(0.0, 0.0, 0.0));
    float n100 = diceHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = diceHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = diceHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = diceHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = diceHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = diceHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = diceHash(i + vec3(1.0, 1.0, 1.0));
    return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z
    );
}

float diceFbm(vec3 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 3; octave++) {
        sum += diceNoise(p) * amplitude;
        p *= 2.03;
        amplitude *= 0.5;
    }
    return sum;
}

/**
 * Inclusions are a body term, not geometry: a domain-warped fbm for swirl and
 * galaxy, a hashed cell for glitter. Intensity 0 leaves the body untouched, so
 * an inclusion type of none costs the same as no inclusion at all.
 */
vec3 diceApplyInclusion(vec3 base) {
    if (uInclusionType < 0.5 || uInclusionIntensity <= 0.0) return base;

    vec3 p = vDicePosition * 6.0;
    float term = 0.0;

    if (uInclusionType < 1.5) {
        // swirl: fbm warped by fbm, then banded so it reads as poured colour
        float warped = diceFbm(p * 0.9 + diceFbm(p * 1.7) * 1.6);
        term = smoothstep(0.35, 0.75, sin(warped * 12.566) * 0.5 + 0.5);
    } else if (uInclusionType < 2.5) {
        // galaxy: a dense dark nebula with hard pinpricks of light in it
        float cloud = pow(clamp(diceFbm(p * 1.4) * 1.6, 0.0, 1.0), 2.2);
        float stars = step(0.88, diceHash(floor(p * 7.0)));
        term = clamp(cloud + stars * 0.8, 0.0, 1.0);
    } else {
        // glitter: sparse, high-frequency flakes
        term = step(0.94, diceHash(floor(p * 11.0))) * 0.9;
    }

    return mix(base, uInclusionColor, clamp(term * uInclusionIntensity, 0.0, 1.0));
}

float diceSampleSdf(vec2 uv, vec4 cell) {
    vec2 clamped = clamp(uv, vec2(0.003), vec2(0.997));
    return texture2D(uGlyphAtlas, cell.xy + clamped * cell.zw).r;
}

/**
 * Coverage of this fragment by its face's glyph, plus the in-plane gradient the
 * normal is bent along for engraved/inlaid.
 */
void diceComputeMarking() {
    gDiceCoverage = 0.0;
    gDiceEdge = 0.0;
    gDiceGradient = vec3(0.0);
    gDiceFaceNormal = normalize(vDiceNormal);

    if (uAtlasMarkings < 0.5) {
        // The mesh already carries this numbering as relief, in its own draw
        // group; its normals do the shaping, so the group flag is the coverage.
        gDiceCoverage = uBakedGroup;
        return;
    }

    vec3 n = normalize(vDiceNormal);

    // Nearest face wins outright. The threshold below decides whether a *glyph*
    // belongs here, but the face normal is wanted either way: on the wall of a
    // baked numeral the interpolated normal is the wall's, not the face's.
    float bestDot = -1.0;
    vec4 bestNormalRadius = vec4(0.0);
    vec4 bestTangent = vec4(0.0);
    vec4 bestCenter = vec4(0.0);
    vec4 bestCell = vec4(0.0);

    for (int i = 0; i < DICE_MAX_FACES; i++) {
        if (i >= uFaceCount) break;
        float alignment = dot(n, uFaceNormalRadius[i].xyz);
        if (alignment > bestDot) {
            bestDot = alignment;
            bestNormalRadius = uFaceNormalRadius[i];
            bestTangent = uFaceTangent[i];
            bestCenter = uFaceCenter[i];
            bestCell = uFaceCell[i];
        }
    }

    if (bestDot > -1.0) gDiceFaceNormal = bestNormalRadius.xyz;

    // Below this the fragment is on a bevel between faces, where no glyph lives.
    // w < 0.5 marks a face the descriptor gave no glyph (a blank Fudge face).
    if (bestDot < 0.55 || bestCenter.w < 0.5) return;

    vec3 faceNormal = bestNormalRadius.xyz;
    vec3 tangent = bestTangent.xyz;
    vec3 bitangent = cross(faceNormal, tangent);

    // w is the face's inradius: the largest glyph it can hold edge to edge.
    float halfExtent = max(bestNormalRadius.w * uGlyphScale, 1e-4);
    vec3 rel = vDicePosition - bestCenter.xyz;
    vec2 local = vec2(dot(rel, tangent), dot(rel, bitangent)) / halfExtent;

    vec2 uv = local * 0.5 + 0.5;
    uv.y = 1.0 - uv.y; // the atlas was rasterised with a top-left origin
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;

    float signedDistance = diceSampleSdf(uv, bestCell) - 0.5;
    float width = fwidth(signedDistance) + 1e-5;

    gDiceCoverage = smoothstep(-width, width, signedDistance);
    // A ridge that peaks on the outline: this is where a cut or an inlay has a
    // wall, and so where the normal should bend.
    gDiceEdge = exp(-pow(signedDistance / (3.0 * width + 0.015), 2.0));

    float texel = 1.0 / 32.0;
    float dx =
        diceSampleSdf(uv + vec2(texel, 0.0), bestCell) -
        diceSampleSdf(uv - vec2(texel, 0.0), bestCell);
    float dy =
        diceSampleSdf(uv + vec2(0.0, texel), bestCell) -
        diceSampleSdf(uv - vec2(0.0, texel), bestCell);
    gDiceGradient = tangent * dx - bitangent * dy;
}
`;

/** Replaces `#include <color_fragment>`. */
export const DICE_FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
diceComputeMarking();
diffuseColor.rgb = diceApplyInclusion(diffuseColor.rgb);
if (uMarkingStyle < 0.5) {
    // engraved: the body colour continues into the cut, just shadowed
    diffuseColor.rgb *= mix(1.0, 0.42, gDiceCoverage);
    diffuseColor.rgb = mix(diffuseColor.rgb, uMarkingColor * 0.55, gDiceCoverage * 0.3);
} else {
    // inlaid and painted both read as the marking colour; the difference is in
    // roughness and in how far the surface moves, below.
    diffuseColor.rgb = mix(diffuseColor.rgb, uMarkingColor, gDiceCoverage);
}
`;

/** Replaces `#include <roughnessmap_fragment>`. */
export const DICE_FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uMarkingRoughness, gDiceCoverage);
`;

/**
 * Replaces `#include <normal_fragment_begin>`.
 *
 * The hull still carries its authored numerals as recessed geometry. When the
 * descriptor asks for something else, that relief is not the marking any more,
 * so its shading is flattened back into the face rather than left as a ghost of
 * the old numbering under the new one. `nonPerturbedNormal` has to go with it:
 * clearcoat and the geometry-roughness term both read that one, and a bright
 * clearcoat highlight traces the old glyph just as clearly as diffuse would.
 */
export const DICE_FRAGMENT_NORMAL_BEGIN = /* glsl */ `
#include <normal_fragment_begin>
if (uAtlasMarkings > 0.5 && uBakedGroup > 0.5) {
    diceComputeMarking();
    vec3 diceFlatNormal = normalize(normalMatrix * gDiceFaceNormal);
    normal = diceFlatNormal;
    nonPerturbedNormal = diceFlatNormal;
}
`;

/** Replaces `#include <normal_fragment_maps>`. */
export const DICE_FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
if (uMarkingDepth > 0.0 && gDiceEdge > 0.002) {
    // engraved cuts in; an inlay only dips to its filled surface
    float sink = uMarkingStyle < 0.5 ? -1.0 : -0.5;
    vec3 bend = gDiceGradient * (uMarkingDepth * gDiceEdge * 2.5 * sink);
    normal = normalize(normal + normalMatrix * bend);
}
`;

/** Replaces `#include <emissivemap_fragment>` — only markings glow. */
export const DICE_FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance *= gDiceCoverage;
`;
