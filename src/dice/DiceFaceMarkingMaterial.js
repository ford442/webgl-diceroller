import * as THREE from 'three';
import { buildGlyphAtlas } from './DiceGlyphAtlas.js';
import { canUseBakedMarkings, collectGlyphKeys, planFaceGlyphs } from './DiceFaceGlyphs.js';
import { computeFaceFrames } from './DiceFaceFrames.js';
import { diceShadingParams } from './DiceShadingParams.js';
import {
    DICE_VERTEX_HEADER,
    DICE_VERTEX_NORMAL,
    DICE_VERTEX_POSITION,
    diceFragmentChunks,
} from './DiceFaceMarkingShader.js';
import { diceGraphConfig, diceGraphKey, diceUniformValues } from './DiceSurfaceGraph.js';

/**
 * The die material for the WebGL backend.
 *
 * A `MeshPhysicalMaterial` with the dice chunks patched in, rather than a raw
 * `ShaderMaterial`: dice are lit by the tavern's env map, cast shadows and (for
 * gemstone / translucency) transmit, and re-implementing all of that to stamp a
 * numeral on a face would be a worse trade than an `onBeforeCompile`.
 *
 * The chunks and the uniform values both come from `DiceSurfaceGraph`, which
 * `DiceFaceMarkingNodeMaterial` (WebGPU) builds too.
 */

const _color = new THREE.Color();

/**
 * Resolve the glyph atlas and per-face frames for an entry, or `null` when the
 * mesh's own relief already says what the descriptor says.
 */
function buildAtlasBinding(entry, template) {
    const frames = computeFaceFrames(template);
    if (!frames.length) return null;

    const atlas = buildGlyphAtlas(collectGlyphKeys(entry), { font: entry.faces.font });
    if (!atlas) return null;

    return { atlas, frames, glyphs: planFaceGlyphs(entry) };
}

/** `diceUniformValues` in the `{ uName: { value } }` shape `onBeforeCompile` takes. */
function createUniforms(values) {
    return {
        uGlyphAtlas: { value: values.glyphAtlas },
        uFaceCell: { value: values.faceCell },
        uFaceNormalRadius: { value: values.faceNormalRadius },
        uFaceTangent: { value: values.faceTangent },
        uFaceCenter: { value: values.faceCenter },
        uFaceCount: { value: values.faceCount },
        uMarkingColor: { value: values.markingColor },
        uMarkingDepth: { value: values.markingDepth },
        uMarkingRoughness: { value: values.markingRoughness },
        uGlyphScale: { value: values.glyphScale },
        uInclusionColor: { value: values.inclusionColor },
        uInclusionIntensity: { value: values.inclusionIntensity },
    };
}

function applyShadingParams(material, params, options) {
    material.color.set(params.bodyColor);
    material.roughness = params.roughness;
    material.metalness = params.metalness;
    material.clearcoat = params.clearcoat;
    material.clearcoatRoughness = params.clearcoatRoughness;
    material.envMapIntensity = params.envMapIntensity;
    material.ior = params.ior;
    material.transmission = params.transmission;
    material.thickness = params.thickness;
    material.transparent = params.transmission > 0;
    material.emissive.copy(_color.set(params.emissiveColor));
    material.emissiveIntensity = params.emissiveIntensity;
    material.envMap = options.envMap ?? null;
}

/**
 * Build the die material for one `DiceSet` entry.
 *
 * Returns one material per draw group. The shipped hulls put their authored
 * numerals in a second group, and that split is per-triangle — the only exact
 * way to say "this triangle is a marking". So the die wears two instances of the
 * same material, differing in one uniform: either the second group *is* the
 * marking (the descriptor asked for what the mesh has), or it is stale relief to
 * be flattened back into the face while the atlas draws the real glyphs.
 *
 * @param {import('../core-engine/dice/DiceSetFormat.js').DiceSetEntry} entry
 * @param {THREE.Mesh} template the die template the material will be worn by
 * @param {{ envMap?: THREE.Texture|null, highQuality?: boolean }} [options]
 * @returns {{ materials: THREE.MeshPhysicalMaterial[], dispose: () => void }}
 */
export function createDiceFaceMarkingMaterial(entry, template, options = {}) {
    const hasBaked = template?.geometry?.userData?.hasBakedMarkings === true;
    const useBaked = canUseBakedMarkings(entry, hasBaked);
    const binding = useBaked ? null : buildAtlasBinding(entry, template);
    const params = diceShadingParams(entry, { highQuality: options.highQuality });

    const build = (isBakedGroup) => {
        const config = diceGraphConfig(params, {
            atlasMode: Boolean(binding),
            bakedGroup: isBakedGroup,
        });
        const uniforms = createUniforms(diceUniformValues(params, binding));
        const chunks = diceFragmentChunks(config);

        const material = new THREE.MeshPhysicalMaterial();
        applyShadingParams(material, params, options);

        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);

            shader.vertexShader = shader.vertexShader
                .replace('void main() {', `${DICE_VERTEX_HEADER}\nvoid main() {`)
                .replace(
                    '#include <beginnormal_vertex>',
                    `#include <beginnormal_vertex>\n${DICE_VERTEX_NORMAL}`
                )
                .replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>\n${DICE_VERTEX_POSITION}`
                );

            shader.fragmentShader = shader.fragmentShader
                .replace('void main() {', `${chunks.fragmentHeader}\nvoid main() {`)
                .replace('#include <color_fragment>', chunks.color)
                .replace('#include <roughnessmap_fragment>', chunks.roughness)
                .replace('#include <normal_fragment_begin>', chunks.normalBegin)
                .replace('#include <normal_fragment_maps>', chunks.normalMaps)
                .replace('#include <emissivemap_fragment>', chunks.emissive);
        };

        // The graph is resolved at build time, so everything it branches on is
        // in the key: two entries that build different graphs must not share a
        // compiled program.
        material.customProgramCacheKey = () =>
            ['dice', diceGraphKey(config), material.transmission > 0 ? 't' : '-'].join(':');

        return material;
    };

    const materials = hasBaked ? [build(false), build(true)] : [build(false)];

    return {
        materials,
        dispose: () => {
            binding?.atlas.dispose();
            materials.forEach((material) => material.dispose());
        },
    };
}
