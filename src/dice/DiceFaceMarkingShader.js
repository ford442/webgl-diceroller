import { createGlslKit } from '../shaders/graph/ShaderKit.js';
import {
    DICE_MAX_FACES,
    diceAlbedo,
    diceEmissive,
    diceGraphKey,
    diceInclusion,
    diceMarking,
    diceRoughness,
    diceViewNormal,
} from './DiceSurfaceGraph.js';

/**
 * GLSL for the descriptor-driven die surface (WebGL backend).
 *
 * Nothing here is shading maths: `DiceSurfaceGraph` is built through the GLSL
 * `ShaderKit` and the result is spliced into `MeshPhysicalMaterial`'s chunks.
 * `DiceFaceMarkingNodeMaterial` builds the same graph as TSL for WebGPU.
 */

export { DICE_MAX_FACES };

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

/** Graph inputs, by the uniform / varying names the header declares. */
const GLSL_INPUTS = {
    atlas: 'uGlyphAtlas',
    faceCell: 'uFaceCell',
    faceNormalRadius: 'uFaceNormalRadius',
    faceTangent: 'uFaceTangent',
    faceCenter: 'uFaceCenter',
    faceCount: 'uFaceCount',
    markingColor: 'uMarkingColor',
    markingDepth: 'uMarkingDepth',
    markingRoughness: 'uMarkingRoughness',
    glyphScale: 'uGlyphScale',
    inclusionColor: 'uInclusionColor',
    inclusionIntensity: 'uInclusionIntensity',
    position: 'vDicePosition',
    normal: 'vDiceNormal',
};

const UNIFORM_DECLARATIONS = /* glsl */ `
uniform mat3 normalMatrix;

uniform sampler2D uGlyphAtlas;
uniform vec4 uFaceCell[${DICE_MAX_FACES}];
uniform vec4 uFaceNormalRadius[${DICE_MAX_FACES}];
uniform vec4 uFaceTangent[${DICE_MAX_FACES}];
uniform vec4 uFaceCenter[${DICE_MAX_FACES}];
uniform int uFaceCount;

uniform vec3 uMarkingColor;
uniform float uMarkingDepth;
uniform float uMarkingRoughness;
uniform float uGlyphScale;

uniform vec3 uInclusionColor;
uniform float uInclusionIntensity;

varying vec3 vDicePosition;
varying vec3 vDiceNormal;
`;

/**
 * @param {import('./DiceSurfaceGraph.js').DiceGraphConfig} config
 */
function generateChunks(config) {
    const k = createGlslKit({ prefix: 'dice' });
    const u = GLSL_INPUTS;

    // Every chunk below lands in main()'s top-level scope, after
    // `color_fragment`, so the marking is computed once there and its locals
    // are read by the later chunks.
    const marking = diceMarking(k, u, config);
    const body = diceInclusion(k, u, 'diffuseColor.rgb', config.inclusionType);
    const albedo = diceAlbedo(k, u, body, marking.coverage, config.markingStyle);
    const colorStatements = k.takeStatements();

    const { flat, normal } = diceViewNormal(
        k,
        u,
        { normal: 'normal', toView: (v) => k.mul('normalMatrix', v) },
        marking,
        config
    );
    const normalStatements = k.takeStatements();

    return {
        fragmentHeader: `${UNIFORM_DECLARATIONS}\n${k.functionsSource()}\n`,
        color: ['#include <color_fragment>', colorStatements, `diffuseColor.rgb = ${albedo};`].join(
            '\n'
        ),
        roughness: [
            '#include <roughnessmap_fragment>',
            `roughnessFactor = ${diceRoughness(k, u, 'roughnessFactor', marking.coverage)};`,
        ].join('\n'),
        // `nonPerturbedNormal` feeds clearcoat and the geometry-roughness term,
        // so a flattened face has to reach it too.
        normalBegin: [
            '#include <normal_fragment_begin>',
            normalStatements,
            flat ? `normal = ${flat};\nnonPerturbedNormal = ${flat};` : '',
        ].join('\n'),
        normalMaps: [
            '#include <normal_fragment_maps>',
            normal && normal !== flat ? `normal = ${normal};` : '',
        ].join('\n'),
        emissive: [
            '#include <emissivemap_fragment>',
            `totalEmissiveRadiance = ${diceEmissive(k, 'totalEmissiveRadiance', marking.coverage)};`,
        ].join('\n'),
    };
}

/** @type {Map<string, ReturnType<typeof generateChunks>>} */
const chunkCache = new Map();

/**
 * The fragment chunks for one graph configuration. Memoised on the same key
 * the material uses for its program cache, so equal keys mean equal source.
 *
 * @param {import('./DiceSurfaceGraph.js').DiceGraphConfig} config
 */
export function diceFragmentChunks(config) {
    const key = diceGraphKey(config);
    let chunks = chunkCache.get(key);
    if (!chunks) {
        chunks = generateChunks(config);
        chunkCache.set(key, chunks);
    }
    return chunks;
}
