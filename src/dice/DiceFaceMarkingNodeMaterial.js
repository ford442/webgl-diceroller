import * as THREE from 'three';
import { buildGlyphAtlas } from './DiceGlyphAtlas.js';
import { canUseBakedMarkings, collectGlyphKeys, planFaceGlyphs } from './DiceFaceGlyphs.js';
import { computeFaceFrames } from './DiceFaceFrames.js';
import { diceShadingParams } from './DiceShadingParams.js';
import { createTslKit } from '../shaders/graph/ShaderKit.js';
import {
    diceAlbedo,
    diceBendsNormal,
    diceEmissive,
    diceFlattensRelief,
    diceGraphConfig,
    diceInclusion,
    diceMarking,
    diceRoughness,
    diceUniformValues,
    diceViewNormal,
} from './DiceSurfaceGraph.js';

/**
 * Dice Face Marking Node Material (WebGPU / TSL)
 *
 * `WebGPURenderer` cannot consume a GLSL `onBeforeCompile` patch, so the die
 * surface is built here as TSL — from the same `DiceSurfaceGraph` the WebGL
 * material generates its GLSL from. This module only wires the graph's outputs
 * into `MeshPhysicalNodeMaterial`'s slots.
 *
 * `three/tsl` and `three/webgpu` are imported lazily so the WebGL path never
 * pays for the node system — the same bargain `GodRayNodeMaterial` strikes.
 * Returns a synchronous factory the dice loader can call inline.
 */
export async function loadDiceFaceMarkingNodeMaterialFactory() {
    const [TSL, WEBGPU] = await Promise.all([import('three/tsl'), import('three/webgpu')]);
    const {
        Fn,
        cameraViewMatrix,
        float,
        modelNormalMatrix,
        normalLocal,
        normalView,
        positionLocal,
        uniform,
        uniformArray,
        vec3,
        vec4,
    } = /** @type {any} */ (TSL);
    const { MeshPhysicalNodeMaterial } = WEBGPU;
    const k = createTslKit(TSL);

    /** Object-space direction → view space, unnormalised (GLSL's `normalMatrix * v`). */
    const toView = (v) => cameraViewMatrix.mul(vec4(modelNormalMatrix.mul(v), 0)).xyz;

    /**
     * One material instance per draw group, both from the same entry — see
     * `DiceFaceMarkingMaterial` for why the split has to be per-triangle.
     */
    function buildDiceNodeMaterial(entry, options, isBakedGroup, binding) {
        const params = diceShadingParams(entry, { highQuality: options.highQuality });
        const config = diceGraphConfig(params, {
            atlasMode: Boolean(binding.atlas),
            bakedGroup: isBakedGroup,
        });
        const values = diceUniformValues(params, binding);

        const u = {
            atlas: values.glyphAtlas,
            faceCell: uniformArray(values.faceCell, 'vec4'),
            faceNormalRadius: uniformArray(values.faceNormalRadius, 'vec4'),
            faceTangent: uniformArray(values.faceTangent, 'vec4'),
            faceCenter: uniformArray(values.faceCenter, 'vec4'),
            faceCount: uniform(values.faceCount, 'int'),
            markingColor: uniform(values.markingColor),
            markingDepth: uniform(values.markingDepth),
            markingRoughness: uniform(values.markingRoughness),
            glyphScale: uniform(values.glyphScale),
            inclusionColor: uniform(values.inclusionColor),
            inclusionIntensity: uniform(values.inclusionIntensity),
            position: positionLocal,
            normal: normalLocal,
        };
        const bodyColor = uniform(new THREE.Color(params.bodyColor));
        const emissiveColor = uniform(new THREE.Color(params.emissiveColor));

        // Each slot is its own Fn: the graph's statements (the face-pick loop)
        // have to be recorded inside a function build.
        const coverage = Fn(() => diceMarking(k, u, config).coverage)();

        const material = new MeshPhysicalNodeMaterial();
        material.color = new THREE.Color(params.bodyColor);
        material.metalness = params.metalness;
        material.clearcoat = params.clearcoat;
        material.clearcoatRoughness = params.clearcoatRoughness;
        material.envMapIntensity = params.envMapIntensity;
        material.ior = params.ior;
        material.transmission = params.transmission;
        material.thickness = params.thickness;
        material.transparent = params.transmission > 0;
        material.emissive = new THREE.Color(params.emissiveColor);

        material.colorNode = Fn(() => {
            const marking = diceMarking(k, u, config);
            const body = diceInclusion(k, u, vec3(bodyColor), config.inclusionType);
            return diceAlbedo(k, u, body, marking.coverage, config.markingStyle);
        })();
        material.roughnessNode = diceRoughness(k, u, float(params.roughness), coverage);
        material.emissiveNode = diceEmissive(
            k,
            vec3(emissiveColor).mul(params.emissiveIntensity),
            coverage
        );

        const shadesNormal = (pick) =>
            Fn(() => {
                const marking = diceMarking(k, u, config);
                return pick(diceViewNormal(k, u, { normal: normalView, toView }, marking, config));
            })();
        const flattens = diceFlattensRelief(config);
        if (flattens || diceBendsNormal(config)) {
            material.normalNode = shadesNormal((view) => view.normal);
        }
        if (flattens) material.clearcoatNormalNode = shadesNormal((view) => view.flat);

        return material;
    }

    return function createDiceFaceMarkingNodeMaterial(entry, template, options = {}) {
        const hasBaked = template?.geometry?.userData?.hasBakedMarkings === true;

        // Frames, glyph plan and atlas belong to the die, not to a draw group:
        // built once here and shared, so the two materials do not rasterise the
        // same glyphs into two textures and then both try to dispose them.
        const useBaked = canUseBakedMarkings(entry, hasBaked);
        const frames = useBaked ? [] : computeFaceFrames(template);
        const atlas = frames.length
            ? buildGlyphAtlas(collectGlyphKeys(entry), { font: entry.faces.font })
            : null;
        const binding = { frames, atlas, glyphs: atlas ? planFaceGlyphs(entry) : [] };

        const materials = hasBaked
            ? [
                  buildDiceNodeMaterial(entry, options, false, binding),
                  buildDiceNodeMaterial(entry, options, true, binding),
              ]
            : [buildDiceNodeMaterial(entry, options, false, binding)];

        return {
            materials,
            dispose: () => {
                atlas?.dispose();
                materials.forEach((material) => material.dispose());
            },
        };
    };
}
