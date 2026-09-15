import * as THREE from 'three';
import { buildGlyphAtlas } from './DiceGlyphAtlas.js';
import { canUseBakedMarkings, collectGlyphKeys, planFaceGlyphs } from './DiceFaceGlyphs.js';
import { computeFaceFrames } from './DiceFaceFrames.js';
import { diceShadingParams } from './DiceShadingParams.js';
import { DICE_MAX_FACES } from './DiceFaceMarkingShader.js';

/**
 * Dice Face Marking Node Material (WebGPU / TSL)
 *
 * The TSL twin of `DiceFaceMarkingMaterial`, for `WebGPURenderer`, which cannot
 * consume a GLSL `onBeforeCompile` patch. The math mirrors `DiceFaceMarkingShader`
 * term for term:
 *   - pick the face whose normal this fragment is closest to, project onto its
 *     frame, and sample the glyph's SDF cell in the runtime atlas
 *   - engraved / inlaid / painted as one parameter set, not three meshes
 *   - inclusions as a domain-warped noise term in the body colour
 *
 * `three/tsl` and `three/webgpu` are imported lazily so the WebGL path never
 * pays for the node system — the same bargain `GodRayNodeMaterial` strikes.
 * Returns a synchronous factory the dice loader can call inline.
 */
export async function loadDiceFaceMarkingNodeMaterialFactory() {
    const [TSL, WEBGPU] = await Promise.all([import('three/tsl'), import('three/webgpu')]);
    const {
        Fn,
        If,
        Loop,
        bumpMap,
        clamp,
        cross,
        dot,
        float,
        floor,
        fract,
        fwidth,
        int,
        mix,
        normalLocal,
        normalize,
        pow,
        positionLocal,
        sin,
        smoothstep,
        step,
        texture,
        transformNormalToView,
        uniform,
        uniformArray,
        vec2,
        vec3,
        vec4,
    } = TSL;
    const { MeshPhysicalNodeMaterial } = WEBGPU;

    // TSL's published types describe `Fn` for its own shader-graph callers; here
    // it is being handed plain arrow functions, so the node graph is built
    // through an untyped alias rather than scattering casts through the maths.
    /** @type {(fn: (args?: any) => any) => any} */
    const node = /** @type {any} */ (Fn);

    const hash3 = node(([p]) =>
        sin(dot(p, vec3(127.1, 311.7, 74.7)))
            .mul(43758.5453123)
            .fract()
    );

    const noise3 = node(([p]) => {
        const i = floor(p);
        const f = fract(p);
        const t = f.mul(f).mul(float(3).sub(f.mul(2)));
        const n000 = hash3(i.add(vec3(0, 0, 0)));
        const n100 = hash3(i.add(vec3(1, 0, 0)));
        const n010 = hash3(i.add(vec3(0, 1, 0)));
        const n110 = hash3(i.add(vec3(1, 1, 0)));
        const n001 = hash3(i.add(vec3(0, 0, 1)));
        const n101 = hash3(i.add(vec3(1, 0, 1)));
        const n011 = hash3(i.add(vec3(0, 1, 1)));
        const n111 = hash3(i.add(vec3(1, 1, 1)));
        return mix(
            mix(mix(n000, n100, t.x), mix(n010, n110, t.x), t.y),
            mix(mix(n001, n101, t.x), mix(n011, n111, t.x), t.y),
            t.z
        );
    });

    const fbm3 = node(([p]) => {
        const sum = float(0).toVar();
        const point = p.toVar();
        const amplitude = float(0.5).toVar();
        Loop(3, () => {
            sum.addAssign(noise3(point).mul(amplitude));
            point.mulAssign(2.03);
            amplitude.mulAssign(0.5);
        });
        return sum;
    });

    /**
     * One material instance per draw group, both from the same entry — see
     * `DiceFaceMarkingMaterial` for why the split has to be per-triangle.
     */
    function buildDiceNodeMaterial(entry, template, options, isBakedGroup) {
        const params = diceShadingParams(entry, { highQuality: options.highQuality });

        const hasBaked = template?.geometry?.userData?.hasBakedMarkings === true;
        const useBaked = canUseBakedMarkings(entry, hasBaked);
        const frames = useBaked ? [] : computeFaceFrames(template);
        const atlas = frames.length
            ? buildGlyphAtlas(collectGlyphKeys(entry), { font: entry.faces.font })
            : null;
        const glyphs = atlas ? planFaceGlyphs(entry) : [];
        const atlasMode = Boolean(atlas);

        // Fixed-length uniform arrays: unused slots carry centre.w = 0, i.e.
        // "no glyph on this face", which is also how a blank Fudge face reads.
        const cells = [];
        const normalRadius = [];
        const tangents = [];
        const centers = [];
        for (let i = 0; i < DICE_MAX_FACES; i++) {
            const frame = frames[i];
            const glyph = glyphs[i];
            const rect = frame && glyph ? atlas?.cells[glyph.key] : null;
            cells.push(rect ? rect.clone() : new THREE.Vector4());
            normalRadius.push(
                frame
                    ? new THREE.Vector4(
                          frame.normal.x,
                          frame.normal.y,
                          frame.normal.z,
                          frame.radius
                      )
                    : new THREE.Vector4()
            );
            tangents.push(
                frame
                    ? new THREE.Vector4(frame.tangent.x, frame.tangent.y, frame.tangent.z, 0)
                    : new THREE.Vector4()
            );
            centers.push(
                frame
                    ? new THREE.Vector4(
                          frame.center.x,
                          frame.center.y,
                          frame.center.z,
                          rect ? 1 : 0
                      )
                    : new THREE.Vector4()
            );
        }

        const uFaceCell = uniformArray(cells, 'vec4');
        const uFaceNormalRadius = uniformArray(normalRadius, 'vec4');
        const uFaceTangent = uniformArray(tangents, 'vec4');
        const uFaceCenter = uniformArray(centers, 'vec4');
        const uFaceCount = uniform(atlasMode ? Math.min(frames.length, DICE_MAX_FACES) : 0, 'int');

        const uMarkingColor = uniform(new THREE.Color(params.markingColor));
        const uMarkingStyle = uniform(params.markingStyle);
        const uMarkingDepth = uniform(params.markingDepth);
        const uMarkingRoughness = uniform(params.markingRoughness);
        const uGlyphScale = uniform(params.glyphScale);
        const uInclusionColor = uniform(new THREE.Color(params.inclusionColor));
        const uInclusionIntensity = uniform(params.inclusionIntensity);

        const sampleSdf = node(
            ([uv, cell]) =>
                texture(
                    atlas.texture,
                    cell.xy.add(clamp(uv, vec2(0.003), vec2(0.997)).mul(cell.zw))
                ).r
        );

        /** Signed distance to the glyph outline, or "far outside" off-glyph. */
        const signedDistance = node(() => {
            const distance = float(-1).toVar();
            if (!atlasMode) return distance;

            const n = normalize(normalLocal);
            const bestDot = float(0.55).toVar();
            const bestNormalRadius = vec4(0).toVar();
            const bestTangent = vec4(0).toVar();
            const bestCenter = vec4(0).toVar();
            const bestCell = vec4(0).toVar();

            Loop(DICE_MAX_FACES, ({ i }) => {
                If(int(i).lessThan(uFaceCount), () => {
                    const candidate = uFaceNormalRadius.element(i);
                    const alignment = dot(n, candidate.xyz);
                    If(alignment.greaterThan(bestDot), () => {
                        bestDot.assign(alignment);
                        bestNormalRadius.assign(candidate);
                        bestTangent.assign(uFaceTangent.element(i));
                        bestCenter.assign(uFaceCenter.element(i));
                        bestCell.assign(uFaceCell.element(i));
                    });
                });
            });

            If(bestCenter.w.greaterThan(0.5), () => {
                const faceNormal = bestNormalRadius.xyz;
                const tangent = bestTangent.xyz;
                const bitangent = cross(faceNormal, tangent);
                // w is the face's inradius: the largest glyph it can hold edge to edge.
                const halfExtent = bestNormalRadius.w.mul(uGlyphScale).max(1e-4);
                const rel = positionLocal.sub(bestCenter.xyz);
                const local = vec2(dot(rel, tangent), dot(rel, bitangent)).div(halfExtent);
                const uv = vec2(local.x.mul(0.5).add(0.5), float(1).sub(local.y.mul(0.5).add(0.5)));
                distance.assign(sampleSdf(uv, bestCell).sub(0.5));
            });

            return distance;
        });

        /**
         * Object-space normal of the flat face this fragment belongs to. On the
         * wall of a baked numeral the interpolated normal is the wall's, not the
         * face's, so the nearest face wins outright here — no threshold.
         */
        const faceNormal = node(() => {
            const best = vec3(normalLocal).toVar();
            if (!atlasMode) return normalize(best);

            const n = normalize(normalLocal);
            const bestDot = float(-1).toVar();
            Loop(DICE_MAX_FACES, ({ i }) => {
                If(int(i).lessThan(uFaceCount), () => {
                    const candidate = uFaceNormalRadius.element(i);
                    const alignment = dot(n, candidate.xyz);
                    If(alignment.greaterThan(bestDot), () => {
                        bestDot.assign(alignment);
                        best.assign(candidate.xyz);
                    });
                });
            });
            return normalize(best);
        });

        /** Coverage of this fragment by its glyph — the one value every term needs. */
        const coverage = node(() => {
            // On the baked path the mesh's own draw group *is* the marking, so
            // coverage is a constant per material instance.
            if (!atlasMode) return float(isBakedGroup ? 1 : 0);
            const distance = signedDistance();
            const width = fwidth(distance).add(1e-5);
            return smoothstep(width.negate(), width, distance);
        });

        /**
         * How far the surface moves inside a marking. Engraved cuts a full
         * depth; an inlay only dips to its filled surface; paint has depth 0 and
         * so leaves the normal alone.
         */
        const markingHeight = node(() => {
            const sink = mix(float(-0.5), float(-1), step(uMarkingStyle, 0.5));
            return coverage().mul(uMarkingDepth).mul(sink);
        });

        const inclusion = node(([base]) => {
            const result = base.toVar();
            if (params.inclusionType === 0 || params.inclusionIntensity <= 0) return result;

            const p = positionLocal.mul(6);
            const term = float(0).toVar();

            if (params.inclusionType === 1) {
                // swirl: fbm warped by fbm, then banded so it reads as poured colour
                const warped = fbm3(p.mul(0.9).add(fbm3(p.mul(1.7)).mul(1.6)));
                term.assign(smoothstep(0.35, 0.75, sin(warped.mul(12.566)).mul(0.5).add(0.5)));
            } else if (params.inclusionType === 2) {
                // galaxy: a dense dark nebula with hard pinpricks of light in it
                const cloud = pow(clamp(fbm3(p.mul(1.4)).mul(1.6), 0, 1), 2.2);
                const stars = step(0.88, hash3(floor(p.mul(7))));
                term.assign(clamp(cloud.add(stars.mul(0.8)), 0, 1));
            } else {
                // glitter: sparse, high-frequency flakes
                term.assign(step(0.94, hash3(floor(p.mul(11)))).mul(0.9));
            }

            return mix(result, uInclusionColor, clamp(term.mul(uInclusionIntensity), 0, 1));
        });

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

        material.colorNode = node(() => {
            const body = inclusion(vec3(uniform(new THREE.Color(params.bodyColor))));
            const cover = coverage();
            const engraved = body
                .mul(mix(float(1), float(0.42), cover))
                .mix(uMarkingColor.mul(0.55), cover.mul(0.3));
            const filled = mix(body, uMarkingColor, cover);
            // engraved keeps the body colour in the cut, just shadowed; inlay and
            // paint both read as the marking colour.
            return mix(filled, engraved, step(uMarkingStyle, 0.5));
        })();

        material.roughnessNode = mix(float(params.roughness), uMarkingRoughness, coverage());

        // The WebGL twin bends the normal along the analytic SDF gradient; here
        // the same height field is differentiated in screen space by bumpMap.
        // Same depth, same style parameters, same wall on the glyph's edge.
        if (atlasMode && isBakedGroup) {
            // Stale relief: the descriptor no longer says what the mesh carved,
            // so flatten that group back into its face instead of leaving a
            // ghost of the old numbering under the new glyphs.
            material.normalNode = transformNormalToView(faceNormal());
        } else if (atlasMode && params.markingDepth > 0) {
            material.normalNode = bumpMap(markingHeight(), float(2.5));
        }

        material.emissiveNode = vec3(uniform(new THREE.Color(params.emissiveColor)))
            .mul(params.emissiveIntensity)
            .mul(coverage());

        return { material, atlas };
    }

    return function createDiceFaceMarkingNodeMaterial(entry, template, options = {}) {
        const hasBaked = template?.geometry?.userData?.hasBakedMarkings === true;
        const built = hasBaked
            ? [
                  buildDiceNodeMaterial(entry, template, options, false),
                  buildDiceNodeMaterial(entry, template, options, true),
              ]
            : [buildDiceNodeMaterial(entry, template, options, false)];

        return {
            materials: built.map((entryBuild) => entryBuild.material),
            dispose: () => {
                built.forEach((entryBuild) => {
                    entryBuild.atlas?.dispose();
                    entryBuild.material.dispose();
                });
            },
        };
    };
}
