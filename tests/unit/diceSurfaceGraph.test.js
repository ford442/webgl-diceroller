/**
 * The die surface is one graph built by two backends. These tests pin what the
 * graph generates per configuration and the uniform dictionary both twins
 * upload; `npm run verify:shader-parity` compiles and renders it on WebGL and
 * WebGPU and compares the pixels.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { createTslKit } from '../../src/shaders/graph/ShaderKit.js';
import {
    DICE_INCLUSION_TERMS,
    DICE_MAX_FACES,
    diceAlbedo,
    diceGraphKey,
    diceInclusion,
    diceMarking,
    diceUniformValues,
} from '../../src/dice/DiceSurfaceGraph.js';
import { diceFragmentChunks } from '../../src/dice/DiceFaceMarkingShader.js';
import {
    INCLUSION_TYPE_INDEX,
    MARKING_STYLE_INDEX,
    diceShadingParams,
} from '../../src/dice/DiceShadingParams.js';
import { createDefaultEntry } from '../../src/dice/DiceSetFormat.js';

const STYLES = Object.values(MARKING_STYLE_INDEX);
const INCLUSIONS = Object.values(INCLUSION_TYPE_INDEX);

function allConfigs() {
    const configs = [];
    for (const atlasMode of [false, true])
        for (const bakedGroup of [false, true])
            for (const markingStyle of STYLES)
                for (const inclusionType of INCLUSIONS)
                    configs.push({ atlasMode, bakedGroup, markingStyle, inclusionType });
    return configs;
}

describe('DiceSurfaceGraph', () => {
    it('has a term for every inclusion type but none', () => {
        const missing = Object.entries(INCLUSION_TYPE_INDEX)
            .filter(([name, index]) => name !== 'none' && !DICE_INCLUSION_TERMS[index])
            .map(([name]) => name);
        expect(missing).toEqual([]);
    });

    it('gives every configuration its own program key', () => {
        const keys = allConfigs().map(diceGraphKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it.each(allConfigs().map((config) => [diceGraphKey(config), config]))(
        'generates GLSL for %s',
        (_key, config) => {
            const chunks = diceFragmentChunks(config);
            expect(chunks.fragmentHeader).toContain(`uniform vec4 uFaceCell[${DICE_MAX_FACES}];`);
            expect(chunks.color).toMatch(/^#include <color_fragment>/);
            expect(chunks.color).toMatch(/diffuseColor\.rgb = /);

            // Build-time branches, not runtime ones.
            const source = Object.values(chunks).join('\n');
            expect(source).not.toMatch(/uMarkingStyle|uInclusionType|uAtlasMarkings|uBakedGroup/);

            // Only the atlas path samples the glyph atlas or walks the faces.
            expect(source.includes('texture2D(uGlyphAtlas')).toBe(config.atlasMode);
            expect(source.includes('for (int')).toBe(config.atlasMode);

            // Only an inclusion builds noise.
            const hasInclusion = config.inclusionType !== INCLUSION_TYPE_INDEX.none;
            expect(source.includes('diceHash(')).toBe(hasInclusion);

            // Stale baked relief is flattened, clearcoat normal included.
            expect(chunks.normalBegin.includes('nonPerturbedNormal =')).toBe(
                config.atlasMode && config.bakedGroup
            );
        }
    );

    it('builds the same graph as TSL nodes', () => {
        const k = createTslKit(TSL);
        const u = {
            atlas: new THREE.Texture(),
            faceCell: TSL.uniformArray([new THREE.Vector4()], 'vec4'),
            faceNormalRadius: TSL.uniformArray([new THREE.Vector4()], 'vec4'),
            faceTangent: TSL.uniformArray([new THREE.Vector4()], 'vec4'),
            faceCenter: TSL.uniformArray([new THREE.Vector4()], 'vec4'),
            faceCount: TSL.uniform(1, 'int'),
            markingColor: TSL.uniform(new THREE.Color()),
            markingDepth: TSL.uniform(0.3),
            markingRoughness: TSL.uniform(0.4),
            glyphScale: TSL.uniform(0.8),
            inclusionColor: TSL.uniform(new THREE.Color()),
            inclusionIntensity: TSL.uniform(1),
            position: TSL.positionLocal,
            normal: TSL.normalLocal,
        };
        // TSL statements only record inside a function build, so wrap it the
        // way the node material does and check it at least assembles.
        const color = TSL.Fn(() => {
            const marking = diceMarking(k, u, {
                atlasMode: true,
                bakedGroup: false,
                markingStyle: MARKING_STYLE_INDEX.engraved,
                inclusionType: INCLUSION_TYPE_INDEX.swirl,
            });
            const body = diceInclusion(k, u, TSL.vec3(1, 0, 0), INCLUSION_TYPE_INDEX.swirl);
            return diceAlbedo(k, u, body, marking.coverage, MARKING_STYLE_INDEX.engraved);
        })();
        expect(color.isNode).toBe(true);
    });
});

describe('diceUniformValues', () => {
    const frame = (i) => ({
        normal: new THREE.Vector3(0, 0, 1),
        tangent: new THREE.Vector3(1, 0, 0),
        center: new THREE.Vector3(0, 0, i),
        radius: 0.5 + i,
    });
    const binding = {
        frames: [frame(0), frame(1), frame(2)],
        atlas: {
            texture: new THREE.Texture(),
            cells: {
                1: new THREE.Vector4(0, 0, 0.25, 0.25),
                2: new THREE.Vector4(0.25, 0, 0.25, 0.25),
            },
        },
        // face 2 has no glyph (a blank face)
        glyphs: [{ key: '1' }, { key: '2' }, null],
    };

    it('is the dictionary both twins upload', () => {
        const params = diceShadingParams(createDefaultEntry('d6'));
        const values = diceUniformValues(params, binding);

        expect(values.faceCount).toBe(3);
        expect(values.glyphAtlas).toBe(binding.atlas.texture);
        for (const key of ['faceCell', 'faceNormalRadius', 'faceTangent', 'faceCenter']) {
            expect(values[key]).toHaveLength(DICE_MAX_FACES);
        }
        expect(values.faceNormalRadius[1].toArray()).toEqual([0, 0, 1, 1.5]);
        expect(values.faceCell[1].toArray()).toEqual([0.25, 0, 0.25, 0.25]);
        // centre.w flags "this face carries a glyph"
        expect(values.faceCenter.slice(0, 4).map((c) => c.w)).toEqual([1, 1, 0, 0]);

        expect({
            markingColor: values.markingColor.getHexString(),
            markingDepth: values.markingDepth,
            markingRoughness: values.markingRoughness,
            glyphScale: values.glyphScale,
            inclusionColor: values.inclusionColor.getHexString(),
            inclusionIntensity: values.inclusionIntensity,
        }).toEqual({
            markingColor: new THREE.Color(params.markingColor).getHexString(),
            markingDepth: params.markingDepth,
            markingRoughness: params.markingRoughness,
            glyphScale: params.glyphScale,
            inclusionColor: new THREE.Color(params.inclusionColor).getHexString(),
            inclusionIntensity: params.inclusionIntensity,
        });
    });

    it('leaves every face blank without an atlas', () => {
        const params = diceShadingParams(createDefaultEntry('d6'));
        const values = diceUniformValues(params, { ...binding, atlas: null });
        expect(values.faceCount).toBe(0);
        expect(values.glyphAtlas).toBeNull();
        expect(values.faceCenter.every((c) => c.w === 0)).toBe(true);
    });
});
