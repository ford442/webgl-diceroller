import * as THREE from 'three';
import { buildGlyphAtlas } from './DiceGlyphAtlas.js';
import { canUseBakedMarkings, collectGlyphKeys, planFaceGlyphs } from './DiceFaceGlyphs.js';
import { computeFaceFrames } from './DiceFaceFrames.js';
import { diceShadingParams } from './DiceShadingParams.js';
import {
    DICE_FRAGMENT_COLOR,
    DICE_FRAGMENT_EMISSIVE,
    DICE_FRAGMENT_HEADER,
    DICE_FRAGMENT_NORMAL,
    DICE_FRAGMENT_NORMAL_BEGIN,
    DICE_FRAGMENT_ROUGHNESS,
    DICE_MAX_FACES,
    DICE_VERTEX_HEADER,
    DICE_VERTEX_NORMAL,
    DICE_VERTEX_POSITION,
} from './DiceFaceMarkingShader.js';

/**
 * The die material for the WebGL backend.
 *
 * A `MeshPhysicalMaterial` with the dice chunks patched in, rather than a raw
 * `ShaderMaterial`: dice are lit by the tavern's env map, cast shadows and (for
 * gemstone / translucency) transmit, and re-implementing all of that to stamp a
 * numeral on a face would be a worse trade than an `onBeforeCompile`.
 *
 * `DiceFaceMarkingNodeMaterial` is the WebGPU twin — keep the two in step.
 */

const _color = new THREE.Color();

/** Uniform slots are fixed-length; unused faces read as "no glyph here". */
function emptyFaceUniforms() {
    return {
        cells: Array.from({ length: DICE_MAX_FACES }, () => new THREE.Vector4()),
        normalRadius: Array.from({ length: DICE_MAX_FACES }, () => new THREE.Vector4()),
        tangent: Array.from({ length: DICE_MAX_FACES }, () => new THREE.Vector4()),
        center: Array.from({ length: DICE_MAX_FACES }, () => new THREE.Vector4()),
    };
}

function createUniforms() {
    const faces = emptyFaceUniforms();
    return {
        uGlyphAtlas: { value: null },
        uFaceCell: { value: faces.cells },
        uFaceNormalRadius: { value: faces.normalRadius },
        uFaceTangent: { value: faces.tangent },
        uFaceCenter: { value: faces.center },
        uFaceCount: { value: 0 },
        uMarkingColor: { value: new THREE.Color('#ffffff') },
        uMarkingStyle: { value: 1 },
        uMarkingDepth: { value: 0.35 },
        uMarkingRoughness: { value: 0.4 },
        uGlyphScale: { value: 0.82 },
        uAtlasMarkings: { value: 1 },
        uBakedGroup: { value: 0 },
        uInclusionColor: { value: new THREE.Color('#ffffff') },
        uInclusionType: { value: 0 },
        uInclusionIntensity: { value: 0 },
    };
}

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

function applyFaceUniforms(uniforms, binding) {
    const count = binding ? Math.min(binding.frames.length, DICE_MAX_FACES) : 0;
    uniforms.uFaceCount.value = count;

    for (let i = 0; i < DICE_MAX_FACES; i++) {
        const cell = uniforms.uFaceCell.value[i];
        const normalRadius = uniforms.uFaceNormalRadius.value[i];
        const tangent = uniforms.uFaceTangent.value[i];
        const center = uniforms.uFaceCenter.value[i];

        if (i >= count) {
            center.w = 0;
            continue;
        }

        const frame = binding.frames[i];
        const glyph = binding.glyphs[i];
        const rect = glyph ? binding.atlas.cells[glyph.key] : null;

        normalRadius.set(frame.normal.x, frame.normal.y, frame.normal.z, frame.radius);
        tangent.set(frame.tangent.x, frame.tangent.y, frame.tangent.z, 0);
        // w doubles as "this face has a glyph" — a face the plan skipped stays blank.
        center.set(frame.center.x, frame.center.y, frame.center.z, rect ? 1 : 0);
        if (rect) cell.copy(rect);
        else cell.set(0, 0, 0, 0);
    }
}

function applyShadingParams(material, uniforms, params, options) {
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

    uniforms.uMarkingColor.value.set(params.markingColor);
    uniforms.uMarkingStyle.value = params.markingStyle;
    uniforms.uMarkingDepth.value = params.markingDepth;
    uniforms.uMarkingRoughness.value = params.markingRoughness;
    uniforms.uGlyphScale.value = params.glyphScale;
    uniforms.uInclusionColor.value.set(params.inclusionColor);
    uniforms.uInclusionType.value = params.inclusionType;
    uniforms.uInclusionIntensity.value = params.inclusionIntensity;
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
 * @param {import('./DiceSetFormat.js').DiceSetEntry} entry
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
        const uniforms = createUniforms();
        uniforms.uAtlasMarkings.value = binding ? 1 : 0;
        uniforms.uBakedGroup.value = isBakedGroup ? 1 : 0;
        uniforms.uGlyphAtlas.value = binding?.atlas.texture ?? null;
        applyFaceUniforms(uniforms, binding);

        const material = new THREE.MeshPhysicalMaterial();
        applyShadingParams(material, uniforms, params, options);

        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.defines = { ...shader.defines, DICE_MAX_FACES };

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
                .replace('void main() {', `${DICE_FRAGMENT_HEADER}\nvoid main() {`)
                .replace('#include <color_fragment>', DICE_FRAGMENT_COLOR)
                .replace('#include <roughnessmap_fragment>', DICE_FRAGMENT_ROUGHNESS)
                .replace('#include <normal_fragment_begin>', DICE_FRAGMENT_NORMAL_BEGIN)
                .replace('#include <normal_fragment_maps>', DICE_FRAGMENT_NORMAL)
                .replace('#include <emissivemap_fragment>', DICE_FRAGMENT_EMISSIVE);
        };

        // Two entries that shade differently must not share a compiled program,
        // so the key carries everything the injection branches on.
        material.customProgramCacheKey = () =>
            [
                'dice',
                binding ? 'atlas' : 'baked',
                isBakedGroup ? 'marks' : 'body',
                params.markingStyle,
                params.inclusionType,
                material.transmission > 0 ? 't' : '-',
            ].join(':');

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
