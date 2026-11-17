/**
 * Named lighting rigs a scene document points at (`SceneDocument.lighting`).
 *
 * A preset is numbers for the lights `setupScene` already builds — it is not a
 * second light implementation. The candle's flicker stays in
 * `LightingSystems.js` (it drives whichever `PointLight` `setupScene` returns),
 * and the rig's *shape* (dice-zone pool, ambient, hemisphere, fill, candle,
 * moon, fog) is the same for every preset; a preset can only retune a light or
 * switch the moon off.
 */

/** Intensities differ by renderer: the WebGPU path reads darker at equal numbers. */
export interface PerRenderer {
    webgl: number;
    webgpu: number;
}

export interface LightingPreset {
    id: string;
    /** Warm pool on the velvet zone (no shadows). */
    diceZone: {
        color: number;
        intensity: number;
        distance: number;
        angle: number;
        penumbra: number;
        decay: number;
    };
    ambient: { color: number; intensity: PerRenderer };
    hemisphere: { sky: number; ground: number; intensity: PerRenderer };
    /** Soft directional fill that keeps dice faces readable. */
    fill: { color: number; intensity: number };
    /** Key light; `setupScene` returns it and the candle flicker drives it. */
    candle: { color: number; intensity: number; distance: number };
    /** Window moonlight. `null` hides the spot (the room has no window). */
    moon: { color: number; intensity: number } | null;
    fog: { color: number; density: number };
}

export const LIGHTING_PRESETS: Readonly<Record<string, LightingPreset>> = {
    // The tavern's rig, numbers unchanged from when it was inline in SceneSetup.
    'tavern-night': {
        id: 'tavern-night',
        diceZone: {
            color: 0xfff2d6,
            intensity: 2.8,
            distance: 40,
            angle: Math.PI / 4,
            penumbra: 0.65,
            decay: 1.2,
        },
        ambient: { color: 0xfff8f0, intensity: { webgl: 0.09, webgpu: 0.16 } },
        hemisphere: {
            sky: 0xc8d4ff,
            ground: 0x3a2418,
            intensity: { webgl: 0.24, webgpu: 0.38 },
        },
        fill: { color: 0xfff0dd, intensity: 0.32 },
        candle: { color: 0xff9933, intensity: 2.2, distance: 22 },
        moon: { color: 0x5566bb, intensity: 2.2 },
        fog: { color: 0x111111, density: 0.015 },
    },
    // A windowless room with one lantern: no moon, a warmer and tighter pool,
    // a little more fog so the far walls fall away.
    'lantern-dim': {
        id: 'lantern-dim',
        diceZone: {
            color: 0xffe2b0,
            intensity: 2.4,
            distance: 34,
            angle: Math.PI / 5,
            penumbra: 0.7,
            decay: 1.2,
        },
        ambient: { color: 0xffeedd, intensity: { webgl: 0.08, webgpu: 0.14 } },
        hemisphere: {
            sky: 0x9aa8c8,
            ground: 0x2a1c12,
            intensity: { webgl: 0.18, webgpu: 0.3 },
        },
        fill: { color: 0xffe6c8, intensity: 0.3 },
        candle: { color: 0xffa040, intensity: 2.8, distance: 24 },
        moon: null,
        fog: { color: 0x0c0e12, density: 0.02 },
    },
};

export const LIGHTING_PRESET_IDS: ReadonlySet<string> = new Set(Object.keys(LIGHTING_PRESETS));

export const DEFAULT_LIGHTING_ID = 'tavern-night';

/** The preset for `id`; an unknown id logs and gets the tavern rig. */
export function getLightingPreset(id: string | null | undefined): LightingPreset {
    const preset = id ? LIGHTING_PRESETS[id] : undefined;
    if (preset) return preset;
    if (id) console.warn(`[Lighting] Unknown preset "${id}"; using "${DEFAULT_LIGHTING_ID}".`);
    return LIGHTING_PRESETS[DEFAULT_LIGHTING_ID] as LightingPreset;
}
