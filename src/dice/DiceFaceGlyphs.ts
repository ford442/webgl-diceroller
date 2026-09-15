/**
 * What each face of a die actually *shows*.
 *
 * This is the bridge between the descriptor (`FaceMarkingSpec` + `NumberingSpec`)
 * and the renderer's glyph atlas: it turns a die entry into an ordered list of
 * glyphs, one per natural face index, with no knowledge of textures or Three.js.
 *
 * Dependency-free on purpose — the atlas builder, the material twins and the
 * unit tests all read the same plan, so "what is drawn" has exactly one answer.
 */

import {
    getFaceCount,
    resolveFaceValues,
    type DiceSetEntry,
    type GlyphSet,
} from './DiceSetFormat.js';

/** How a glyph is drawn, once the atlas gets hold of it. */
export type GlyphKind = 'text' | 'pips' | 'symbol';

export interface FaceGlyph {
    /** Natural face index, 1..faceCount. */
    face: number;
    /** The value the descriptor says this face shows. */
    value: number;
    kind: GlyphKind;
    /** Text to draw (`text`/`symbol`), or the pip count as a string (`pips`). */
    label: string;
    /** Underline rule for telling a 6 from a 9. */
    underline: boolean;
    /** Stable atlas cell key — identical glyphs share one cell. */
    key: string;
}

/** Fudge faces are the one glyph set that is not just "the number". */
const SYMBOL_LABELS: Record<number, string> = {
    [-1]: '−', // minus sign, not a hyphen
    0: '–', // en dash: a blank-ish Fudge face still reads as a mark
    1: '+',
};

/** Pips only exist for small positive counts; anything else falls back to text. */
const MAX_PIP_VALUE = 9;

export function makeGlyphKey(kind: GlyphKind, label: string, underline: boolean): string {
    return `${kind}:${label}${underline ? ':u' : ''}`;
}

function pickKind(glyphs: GlyphSet, value: number): GlyphKind {
    if (glyphs === 'symbols' && SYMBOL_LABELS[value] !== undefined) return 'symbol';
    if (glyphs === 'pips' && Number.isInteger(value) && value >= 1 && value <= MAX_PIP_VALUE)
        return 'pips';
    return 'text';
}

function labelFor(kind: GlyphKind, value: number): string {
    if (kind === 'symbol') return SYMBOL_LABELS[value] ?? String(value);
    return String(value);
}

/**
 * The glyph shown on each natural face, in face order.
 *
 * `numbering` decides the values, `faces.glyphs` decides how they are drawn, and
 * a glyph set that cannot express a value (pips for a 20, symbols for a 7) falls
 * back to numerals rather than dropping the marking.
 */
export function planFaceGlyphs(entry: DiceSetEntry): FaceGlyph[] {
    const values = resolveFaceValues(entry);
    const { glyphs, underlineSixNine } = entry.faces;

    return values.map((value, index) => {
        const kind = pickKind(glyphs, value);
        const label = labelFor(kind, value);
        const underline = underlineSixNine && kind === 'text' && (value === 6 || value === 9);
        return {
            face: index + 1,
            value,
            kind,
            label,
            underline,
            key: makeGlyphKey(kind, label, underline),
        };
    });
}

/** Distinct atlas cells a die entry needs, in first-use order. */
export function collectGlyphKeys(entry: DiceSetEntry): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const glyph of planFaceGlyphs(entry)) {
        if (seen.has(glyph.key)) continue;
        seen.add(glyph.key);
        out.push(glyph.key);
    }
    return out;
}

/**
 * Cache/identity key for everything that changes the *markings* of a die —
 * not its body colour. When this is unchanged the atlas and the per-face glyph
 * assignment can be reused as-is.
 */
export function faceMarkingSignature(entry: DiceSetEntry): string {
    const { style, glyphs, font, depth, underlineSixNine } = entry.faces;
    return [
        entry.shape,
        getFaceCount(entry),
        style,
        glyphs,
        font,
        depth,
        underlineSixNine ? 'u' : '-',
        planFaceGlyphs(entry)
            .map((g) => g.key)
            .join('|'),
    ].join('/');
}

/**
 * What the shipped hulls already have carved into them: numerals, in natural
 * order, in the default font — exactly `createDefault*Spec` for any shape.
 *
 * The parameter is kept because this is a property of the *asset*: the day a
 * hull ships with something else carved into it, this is where that is said.
 */
export function bakedGlyphSetFor(_shape: string): GlyphSet {
    return 'numerals';
}

/**
 * Whether the mesh's own relief can serve as this entry's markings.
 *
 * One descriptor, two glyph sources: when the set asks for precisely what the
 * GLB was authored with, the recessed geometry is the cheapest way to draw it —
 * and the marking *style* still comes from the descriptor, because engraved,
 * inlaid and painted are material parameters either way. Ask for anything else
 * (a dF sequence, numerals on a d6, another font) and the atlas takes over.
 */
export function canUseBakedMarkings(entry: DiceSetEntry, hasBakedMarkings: boolean): boolean {
    if (!hasBakedMarkings) return false;
    const { numbering, faces } = entry;
    if (numbering.sequence !== null) return false;
    if (numbering.start !== 1 || numbering.step !== 1) return false;
    if (faces.glyphs !== bakedGlyphSetFor(entry.shape)) return false;
    if (faces.font !== 'default') return false;
    if (faces.underlineSixNine) return false;
    return true;
}
