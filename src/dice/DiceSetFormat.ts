/**
 * Portable, versioned dice-set descriptor (#XXX slice 1).
 *
 * A `DiceSet` is plain data: no Three.js, no DOM, no asset references beyond a
 * shape id. It is the single source of truth for what a die looks like, so
 * appearance stops being baked into a GLB and starts being something that can
 * be hashed, shared, stored and compared across peers.
 *
 * Deliberately dependency-free — this module is part of the headless surface
 * and must stay importable from Node with no renderer in the module graph.
 */

/** Format version. Bump only on a breaking shape change; add a migration too. */
export const DICE_SET_VERSION = 1;

/** Physical meshes we can actually put on the table today. */
export const DIE_SHAPE_IDS = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;
export type DieShapeId = (typeof DIE_SHAPE_IDS)[number];

/** Face count of each shape, i.e. how many natural face values it reads. */
export const DIE_SHAPE_FACE_COUNT: Record<DieShapeId, number> = {
    d4: 4,
    d6: 6,
    d8: 8,
    d10: 10,
    d12: 12,
    d20: 20,
};

export const MATERIAL_PRESET_IDS = [
    'resin',
    'metal',
    'gemstone',
    'bone',
    'obsidian',
    'glow',
] as const;
export type MaterialPresetId = (typeof MATERIAL_PRESET_IDS)[number];

export const INCLUSION_TYPES = ['none', 'swirl', 'galaxy', 'glitter'] as const;
export type InclusionType = (typeof INCLUSION_TYPES)[number];

export const MARKING_STYLES = ['engraved', 'inlaid', 'painted'] as const;
export type MarkingStyle = (typeof MARKING_STYLES)[number];

export const GLYPH_SETS = ['numerals', 'pips', 'symbols'] as const;
export type GlyphSet = (typeof GLYPH_SETS)[number];

export interface InclusionSpec {
    type: InclusionType;
    /** `#rrggbb` */
    color: string;
    /** 0..1 */
    intensity: number;
}

export interface MaterialSpec {
    preset: MaterialPresetId;
    /** `#rrggbb` */
    bodyColor: string;
    /** `#rrggbb` — inlay / paint / pip colour. */
    markingColor: string;
    /** 0..1, 0 = opaque. */
    translucency: number;
    inclusion: InclusionSpec;
}

export interface FaceMarkingSpec {
    style: MarkingStyle;
    glyphs: GlyphSet;
    /** MSDF atlas font key; resolved by the renderer, opaque here. */
    font: string;
    /** 0..1 engrave/emboss depth, ignored by `painted`. */
    depth: number;
    /** Underline the 6 and the 9 so they can be told apart. */
    underlineSixNine: boolean;
}

export interface NumberingSpec {
    /** Value shown on the face whose natural index is 1. */
    start: number;
    /** Increment per natural face index. */
    step: number;
    /**
     * Explicit per-face values, natural index 1..faceCount in order. When
     * present it wins over `start`/`step` — this is what lets dF, d2 and d3
     * ride an existing d6 mesh instead of shipping a new one.
     */
    sequence: number[] | null;
}

export interface DiceSetEntry {
    shape: DieShapeId;
    body: MaterialSpec;
    faces: FaceMarkingSpec;
    numbering: NumberingSpec;
}

export interface DiceSet {
    version: typeof DICE_SET_VERSION;
    /** Content hash of everything but this field. */
    id: string;
    name: string;
    dice: Record<string, DiceSetEntry>;
}

/** The v0 `{ preset, bodyColor, pipColor }` entry this format supersedes. */
export interface LegacyAppearanceEntry {
    preset?: string;
    bodyColor?: string;
    pipColor?: string;
}

/**
 * Die keys we know how to build, and the shape + numbering each rides on.
 * Anything whose `shape` is a mesh we already ship costs no new asset.
 */
export const DIE_TYPE_CATALOG: Record<string, { shape: DieShapeId; sequence: number[] | null }> = {
    d4: { shape: 'd4', sequence: null },
    d6: { shape: 'd6', sequence: null },
    d8: { shape: 'd8', sequence: null },
    d10: { shape: 'd10', sequence: null },
    d12: { shape: 'd12', sequence: null },
    d20: { shape: 'd20', sequence: null },
    // Derived from meshes we already have — no GLB authoring required.
    d2: { shape: 'd6', sequence: [1, 2, 1, 2, 1, 2] },
    d3: { shape: 'd6', sequence: [1, 2, 3, 1, 2, 3] },
    dF: { shape: 'd6', sequence: [-1, 0, 1, -1, 0, 1] },
    d5: { shape: 'd10', sequence: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5] },
    d100: { shape: 'd10', sequence: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] },
};

/** Die keys present in a freshly created set. */
export const DEFAULT_DIE_KEYS = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;

const DEFAULT_LOOKS: Record<string, { preset: MaterialPresetId; body: string; marking: string }> = {
    d4: { preset: 'resin', body: '#b83232', marking: '#fff8ef' },
    d6: { preset: 'resin', body: '#c43c3c', marking: '#fff8ef' },
    d8: { preset: 'metal', body: '#8b7355', marking: '#1a1410' },
    d10: { preset: 'gemstone', body: '#5b3fa6', marking: '#efe8ff' },
    d12: { preset: 'bone', body: '#e8dcc8', marking: '#3d3428' },
    d20: { preset: 'obsidian', body: '#1a1a22', marking: '#c9a84c' },
};

const FALLBACK_LOOK = { preset: 'resin' as MaterialPresetId, body: '#c43c3c', marking: '#fff8ef' };

// ---------------------------------------------------------------------------
// normalisation primitives
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
    return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
        ? (raw as T)
        : fallback;
}

/** Accepts `abc`, `#abc`, `aabbcc`, `#AABBCC`; returns lowercase `#rrggbb`. */
export function normalizeHexColor(raw: unknown, fallback: string): string {
    if (typeof raw !== 'string') return fallback;
    const trimmed = raw.trim();
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
        const h = withHash.slice(1).toLowerCase();
        return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    return fallback;
}

function clamp01(raw: unknown, fallback: number): number {
    const n = typeof raw === 'number' ? raw : Number.NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));
}

function safeInt(raw: unknown, fallback: number): number {
    const n = typeof raw === 'number' ? raw : Number.NaN;
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// ---------------------------------------------------------------------------
// constructors
// ---------------------------------------------------------------------------

export function createDefaultMaterialSpec(dieKey: string): MaterialSpec {
    const look = DEFAULT_LOOKS[dieKey] ?? FALLBACK_LOOK;
    return {
        preset: look.preset,
        bodyColor: look.body,
        markingColor: look.marking,
        translucency: 0,
        inclusion: { type: 'none', color: look.marking, intensity: 0 },
    };
}

export function createDefaultFaceMarkingSpec(dieKey: string): FaceMarkingSpec {
    return {
        style: 'inlaid',
        glyphs: dieKey === 'd6' ? 'pips' : 'numerals',
        font: 'default',
        depth: 0.35,
        underlineSixNine: false,
    };
}

export function createDefaultNumberingSpec(dieKey: string): NumberingSpec {
    const catalog = DIE_TYPE_CATALOG[dieKey];
    return { start: 1, step: 1, sequence: catalog?.sequence ? [...catalog.sequence] : null };
}

export function createDefaultEntry(dieKey: string): DiceSetEntry {
    return {
        shape: DIE_TYPE_CATALOG[dieKey]?.shape ?? 'd6',
        body: createDefaultMaterialSpec(dieKey),
        faces: createDefaultFaceMarkingSpec(dieKey),
        numbering: createDefaultNumberingSpec(dieKey),
    };
}

/** A set matching today's curated defaults, with a freshly computed id. */
export function createDefaultDiceSet(name = 'Default'): DiceSet {
    const dice: Record<string, DiceSetEntry> = {};
    for (const key of DEFAULT_DIE_KEYS) dice[key] = createDefaultEntry(key);
    return withComputedId({ version: DICE_SET_VERSION, id: '', name, dice });
}

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------

function normalizeInclusion(raw: unknown, fallback: InclusionSpec): InclusionSpec {
    const src = isRecord(raw) ? raw : {};
    return {
        type: oneOf(src.type, INCLUSION_TYPES, fallback.type),
        color: normalizeHexColor(src.color, fallback.color),
        intensity: clamp01(src.intensity, fallback.intensity),
    };
}

export function normalizeMaterialSpec(raw: unknown, dieKey: string): MaterialSpec {
    const defaults = createDefaultMaterialSpec(dieKey);
    const src = isRecord(raw) ? raw : {};
    return {
        preset: oneOf(src.preset, MATERIAL_PRESET_IDS, defaults.preset),
        bodyColor: normalizeHexColor(src.bodyColor, defaults.bodyColor),
        // `pipColor` is the v0 spelling; accept it so old payloads survive.
        markingColor: normalizeHexColor(src.markingColor ?? src.pipColor, defaults.markingColor),
        translucency: clamp01(src.translucency, defaults.translucency),
        inclusion: normalizeInclusion(src.inclusion, defaults.inclusion),
    };
}

export function normalizeFaceMarkingSpec(raw: unknown, dieKey: string): FaceMarkingSpec {
    const defaults = createDefaultFaceMarkingSpec(dieKey);
    const src = isRecord(raw) ? raw : {};
    const font = typeof src.font === 'string' && src.font.trim() ? src.font.trim() : defaults.font;
    return {
        style: oneOf(src.style, MARKING_STYLES, defaults.style),
        glyphs: oneOf(src.glyphs, GLYPH_SETS, defaults.glyphs),
        font: font.slice(0, 64),
        depth: clamp01(src.depth, defaults.depth),
        underlineSixNine:
            typeof src.underlineSixNine === 'boolean'
                ? src.underlineSixNine
                : defaults.underlineSixNine,
    };
}

export function normalizeNumberingSpec(
    raw: unknown,
    dieKey: string,
    faceCount: number
): NumberingSpec {
    const defaults = createDefaultNumberingSpec(dieKey);
    const src = isRecord(raw) ? raw : {};

    let sequence: number[] | null = defaults.sequence;
    if (Array.isArray(src.sequence)) {
        const values = src.sequence.filter(
            (v): v is number => typeof v === 'number' && Number.isFinite(v)
        );
        // A partial sequence is meaningless — every face needs a value.
        sequence =
            values.length === faceCount ? values.map((v) => Math.trunc(v)) : defaults.sequence;
    } else if (src.sequence === null) {
        sequence = null;
    }

    return {
        start: safeInt(src.start, defaults.start),
        step: safeInt(src.step, defaults.step) || defaults.step,
        sequence: sequence ? sequence.slice(0, faceCount) : null,
    };
}

export function normalizeDiceSetEntry(raw: unknown, dieKey: string): DiceSetEntry {
    const src = isRecord(raw) ? raw : {};
    const shape = oneOf(src.shape, DIE_SHAPE_IDS, DIE_TYPE_CATALOG[dieKey]?.shape ?? 'd6');
    return {
        shape,
        body: normalizeMaterialSpec(src.body, dieKey),
        faces: normalizeFaceMarkingSpec(src.faces, dieKey),
        numbering: normalizeNumberingSpec(src.numbering, dieKey, DIE_SHAPE_FACE_COUNT[shape]),
    };
}

/** Die keys are URL- and storage-safe tokens; reject anything else. */
export function isValidDieKey(key: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(key);
}

/**
 * Coerce arbitrary input into a valid `DiceSet`, filling every gap with a
 * default. Never throws — unparseable input yields the default set.
 */
export function normalizeDiceSet(raw: unknown, fallbackName = 'Default'): DiceSet {
    const src = isRecord(raw) ? raw : {};
    const rawDice = isRecord(src.dice) ? src.dice : {};

    const dice: Record<string, DiceSetEntry> = {};
    for (const key of Object.keys(rawDice)) {
        if (!isValidDieKey(key)) continue;
        dice[key] = normalizeDiceSetEntry(rawDice[key], key);
    }
    if (Object.keys(dice).length === 0) {
        for (const key of DEFAULT_DIE_KEYS) dice[key] = createDefaultEntry(key);
    }

    const name =
        typeof src.name === 'string' && src.name.trim()
            ? src.name.trim().slice(0, 64)
            : fallbackName;

    return withComputedId({ version: DICE_SET_VERSION, id: '', name, dice });
}

// ---------------------------------------------------------------------------
// content hash
// ---------------------------------------------------------------------------

/** Deterministic JSON with sorted keys, excluding the (derived) `id`. */
export function canonicalizeDiceSet(set: DiceSet): string {
    const canonical = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(canonical);
        if (isRecord(value)) {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
            return out;
        }
        return value;
    };
    const { id: _ignored, ...rest } = set;
    return JSON.stringify(canonical(rest));
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a/64 over the UTF-8 canonical form. Stable across Node and browsers. */
export function hashString(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let hash = FNV_OFFSET;
    for (const byte of bytes) {
        hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK64;
    }
    return hash.toString(16).padStart(16, '0');
}

/** Content hash of a set — identical content always yields an identical id. */
export function computeDiceSetId(set: DiceSet): string {
    return hashString(canonicalizeDiceSet(set));
}

export function withComputedId(set: DiceSet): DiceSet {
    return { ...set, id: computeDiceSetId(set) };
}

// ---------------------------------------------------------------------------
// face values
// ---------------------------------------------------------------------------

/** Number of natural faces a die entry reads from its mesh. */
export function getFaceCount(entry: DiceSetEntry): number {
    return DIE_SHAPE_FACE_COUNT[entry.shape];
}

/**
 * Map a natural face value (1..faceCount, as read from the mesh's face map)
 * to the value the descriptor says that face shows.
 */
export function resolveFaceValue(entry: DiceSetEntry, naturalValue: number): number {
    const faceCount = getFaceCount(entry);
    const index = Math.trunc(naturalValue);
    if (!Number.isFinite(index) || index < 1 || index > faceCount) return naturalValue;
    const { sequence, start, step } = entry.numbering;
    if (sequence && sequence.length === faceCount) return sequence[index - 1];
    return start + (index - 1) * step;
}

/** Every displayed value, in natural face order. */
export function resolveFaceValues(entry: DiceSetEntry): number[] {
    const faceCount = getFaceCount(entry);
    return Array.from({ length: faceCount }, (_, i) => resolveFaceValue(entry, i + 1));
}

// ---------------------------------------------------------------------------
// v0 migration
// ---------------------------------------------------------------------------

/** Lift the legacy `{ preset, bodyColor, pipColor }` config into a `DiceSet`. */
export function migrateLegacyAppearanceConfig(
    legacy: Record<string, LegacyAppearanceEntry> | null | undefined,
    name = 'Default'
): DiceSet {
    const set = createDefaultDiceSet(name);
    if (!isRecord(legacy)) return set;

    for (const [key, entry] of Object.entries(legacy)) {
        if (!isValidDieKey(key) || !isRecord(entry)) continue;
        const base = set.dice[key] ?? createDefaultEntry(key);
        set.dice[key] = {
            ...base,
            body: normalizeMaterialSpec(
                {
                    preset: entry.preset,
                    bodyColor: entry.bodyColor,
                    markingColor: entry.pipColor,
                },
                key
            ),
        };
    }
    return withComputedId(set);
}

/**
 * Project a set back onto the legacy shape, so `DiceMaterials` and the v0
 * short code keep working while the renderer catches up.
 */
export function toLegacyAppearanceConfig(
    set: DiceSet
): Record<string, { preset: string; bodyColor: string; pipColor: string }> {
    const out: Record<string, { preset: string; bodyColor: string; pipColor: string }> = {};
    for (const [key, entry] of Object.entries(set.dice)) {
        out[key] = {
            preset: entry.body.preset,
            bodyColor: entry.body.bodyColor,
            pipColor: entry.body.markingColor,
        };
    }
    return out;
}
