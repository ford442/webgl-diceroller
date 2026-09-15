/**
 * The numbers both die-material twins shade from.
 *
 * `MaterialSpec` and `FaceMarkingSpec` are authoring language ("gemstone",
 * "engraved", 0.4 translucency); this turns them into the handful of scalars a
 * shader can consume, once, so the GLSL and TSL implementations cannot drift
 * into shading the same descriptor differently.
 *
 * The six presets survive as *starting points* — a row in `DICE_PRESET_PARAMS`
 * the spec then overrides — rather than as an enum the renderer branches on.
 */

import type {
    DiceSetEntry,
    InclusionType,
    MarkingStyle,
    MaterialPresetId,
} from './DiceSetFormat.js';

export interface PresetParams {
    label: string;
    roughness: number;
    metalness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    envMapIntensity: number;
    ior: number;
    /** Transmission the preset asks for before `translucency` is folded in. */
    transmission: number;
    /** Markings glow (the `glow` preset is only this, plus a softer body). */
    emissive: number;
    /** Transmission is a high-quality-only effect; below that we fake it. */
    requiresHighQuality?: boolean;
}

export const DICE_PRESET_PARAMS: Record<MaterialPresetId, PresetParams> = {
    resin: {
        label: 'Resin',
        roughness: 0.18,
        metalness: 0.0,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.0,
        ior: 1.5,
        transmission: 0,
        emissive: 0,
    },
    metal: {
        label: 'Metal',
        roughness: 0.22,
        metalness: 0.92,
        clearcoat: 0.0,
        clearcoatRoughness: 0.3,
        envMapIntensity: 1.2,
        ior: 1.5,
        transmission: 0,
        emissive: 0,
    },
    gemstone: {
        label: 'Gemstone',
        roughness: 0.05,
        metalness: 0.0,
        clearcoat: 0.4,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.4,
        ior: 1.52,
        transmission: 0.72,
        emissive: 0,
        requiresHighQuality: true,
    },
    bone: {
        label: 'Bone / Ivory',
        roughness: 0.62,
        metalness: 0.02,
        clearcoat: 0.0,
        clearcoatRoughness: 0.4,
        envMapIntensity: 0.55,
        ior: 1.45,
        transmission: 0,
        emissive: 0,
    },
    obsidian: {
        label: 'Obsidian',
        roughness: 0.12,
        metalness: 0.05,
        clearcoat: 0.9,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.3,
        ior: 1.5,
        transmission: 0,
        emissive: 0,
    },
    glow: {
        label: 'Glow',
        roughness: 0.35,
        metalness: 0.05,
        clearcoat: 0.0,
        clearcoatRoughness: 0.4,
        envMapIntensity: 0.8,
        ior: 1.5,
        transmission: 0,
        emissive: 1.4,
    },
};

/** Fallback when the medium/low profile cannot afford transmission. */
const FAUX_TRANSMISSION: Pick<
    PresetParams,
    'roughness' | 'metalness' | 'clearcoat' | 'clearcoatRoughness' | 'envMapIntensity'
> = {
    roughness: 0.08,
    metalness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.6,
};

/** Shader-side enums. Keep in step with both twins. */
export const MARKING_STYLE_INDEX: Record<MarkingStyle, number> = {
    engraved: 0,
    inlaid: 1,
    painted: 2,
};

export const INCLUSION_TYPE_INDEX: Record<InclusionType, number> = {
    none: 0,
    swirl: 1,
    galaxy: 2,
    glitter: 3,
};

export interface DiceShadingParams {
    bodyColor: string;
    markingColor: string;
    roughness: number;
    metalness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    envMapIntensity: number;
    ior: number;
    transmission: number;
    thickness: number;
    emissiveColor: string;
    emissiveIntensity: number;
    inclusionType: number;
    inclusionColor: string;
    inclusionIntensity: number;
    markingStyle: number;
    /** 0..1 — how far engraved/inlaid markings sink into the face. */
    markingDepth: number;
    /** Extra roughness inside a marking; paint and inlay are duller than resin. */
    markingRoughness: number;
    /** Fraction of the face radius a glyph spans. */
    glyphScale: number;
}

export interface ShadingOptions {
    /** Transmission and thick refraction are high-quality-only. */
    highQuality?: boolean;
}

/** Marking roughness by style — a painted numeral is flat, an inlay is satin. */
const MARKING_ROUGHNESS: Record<MarkingStyle, number> = {
    engraved: 0.75,
    inlaid: 0.3,
    painted: 0.55,
};

/**
 * Translucency composes with whatever the preset already asked for rather than
 * replacing it, so "gemstone at 0" is still a gemstone.
 */
function combineTransmission(preset: number, translucency: number): number {
    return Math.min(1, preset + translucency * (1 - preset));
}

export function diceShadingParams(
    entry: DiceSetEntry,
    options: ShadingOptions = {}
): DiceShadingParams {
    const highQuality = options.highQuality !== false;
    const preset = DICE_PRESET_PARAMS[entry.body.preset] ?? DICE_PRESET_PARAMS.resin;
    const transmission = combineTransmission(preset.transmission, entry.body.translucency);
    const affordable = highQuality || !preset.requiresHighQuality;
    const base = affordable ? preset : { ...preset, ...FAUX_TRANSMISSION };

    return {
        bodyColor: entry.body.bodyColor,
        markingColor: entry.body.markingColor,
        roughness: base.roughness,
        metalness: base.metalness,
        clearcoat: base.clearcoat,
        clearcoatRoughness: base.clearcoatRoughness,
        envMapIntensity: base.envMapIntensity,
        ior: base.ior,
        transmission: highQuality ? transmission : 0,
        thickness: highQuality ? transmission * 0.9 : 0,
        emissiveColor: entry.body.markingColor,
        emissiveIntensity: preset.emissive,
        inclusionType: INCLUSION_TYPE_INDEX[entry.body.inclusion.type] ?? 0,
        inclusionColor: entry.body.inclusion.color,
        inclusionIntensity: entry.body.inclusion.intensity,
        markingStyle: MARKING_STYLE_INDEX[entry.faces.style] ?? 1,
        // Paint sits on the surface; it has a style but no depth.
        markingDepth: entry.faces.style === 'painted' ? 0 : entry.faces.depth,
        markingRoughness: MARKING_ROUGHNESS[entry.faces.style] ?? 0.4,
        glyphScale: 0.82,
    };
}
