import * as THREE from 'three';
import { makeGlyphKey } from './DiceFaceGlyphs.js';

/**
 * Signed-distance glyph atlas for dice faces, built at runtime.
 *
 * Face markings used to be triangles inside the Draco GLB: changing numerals to
 * pips, or a 6 to a Fudge minus, meant a new mesh. Here each distinct glyph the
 * descriptor asks for is rasterised once into a cell of one texture, converted to
 * a signed distance field, and sampled by the die material — so `FaceMarkingSpec`
 * can change every frame without touching an asset.
 *
 * The distance field (rather than plain coverage) is what lets one texture serve
 * a die filling the screen and a die tumbling in the distance, and it gives the
 * material a gradient to push the surface normal along for engraved/inlaid.
 *
 * Headless-safe: with no canvas to draw on, `buildGlyphAtlas` returns `null` and
 * the caller renders an unmarked die rather than throwing.
 */

/** Atlas cell edge, in texels, before padding. */
const CELL_SIZE = 64;
/** Rasterisation supersample — the SDF is computed at this resolution, then boxed down. */
const SUPERSAMPLE = 4;
/** Distance range the field is normalised over, in final-resolution texels. */
const SPREAD = 8;

/** `font` in a `FaceMarkingSpec` is an opaque key; this is where it stops being one. */
export const GLYPH_FONT_STACKS = {
    default: '"Trebuchet MS", "Segoe UI", Tahoma, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"SF Mono", "Consolas", "Liberation Mono", monospace',
    display: '"Impact", "Haettenschweiler", "Arial Black", sans-serif',
};

export function resolveFontStack(font) {
    return GLYPH_FONT_STACKS[font] ?? GLYPH_FONT_STACKS.default;
}

/** Pip layouts, in unit-square coordinates, for 1..9. */
const PIP_LAYOUTS = {
    1: [[0.5, 0.5]],
    2: [
        [0.28, 0.28],
        [0.72, 0.72],
    ],
    3: [
        [0.26, 0.26],
        [0.5, 0.5],
        [0.74, 0.74],
    ],
    4: [
        [0.28, 0.28],
        [0.72, 0.28],
        [0.28, 0.72],
        [0.72, 0.72],
    ],
    5: [
        [0.27, 0.27],
        [0.73, 0.27],
        [0.5, 0.5],
        [0.27, 0.73],
        [0.73, 0.73],
    ],
    6: [
        [0.28, 0.24],
        [0.72, 0.24],
        [0.28, 0.5],
        [0.72, 0.5],
        [0.28, 0.76],
        [0.72, 0.76],
    ],
    7: [
        [0.28, 0.22],
        [0.72, 0.22],
        [0.28, 0.5],
        [0.5, 0.5],
        [0.72, 0.5],
        [0.28, 0.78],
        [0.72, 0.78],
    ],
    8: [
        [0.28, 0.2],
        [0.72, 0.2],
        [0.28, 0.4],
        [0.72, 0.4],
        [0.28, 0.6],
        [0.72, 0.6],
        [0.28, 0.8],
        [0.72, 0.8],
    ],
    9: [
        [0.26, 0.24],
        [0.5, 0.24],
        [0.74, 0.24],
        [0.26, 0.5],
        [0.5, 0.5],
        [0.74, 0.5],
        [0.26, 0.76],
        [0.5, 0.76],
        [0.74, 0.76],
    ],
};

function createCanvas(width, height) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/** `text:12:u` → `{ kind: 'text', label: '12', underline: true }` */
export function parseGlyphKey(key) {
    const [kind, label, flag] = String(key).split(':');
    return { kind, label: label ?? '', underline: flag === 'u' };
}

function drawPips(ctx, label, size) {
    const layout = PIP_LAYOUTS[Number.parseInt(label, 10)];
    if (!layout) return;
    const radius = size * (layout.length > 6 ? 0.075 : 0.095);
    ctx.fillStyle = '#fff';
    for (const [x, y] of layout) {
        ctx.beginPath();
        ctx.arc(x * size, y * size, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawText(ctx, label, size, fontStack, underline) {
    // Long labels (a 100 face) shrink so they stay inside the face island.
    const scale = label.length >= 3 ? 0.42 : label.length === 2 ? 0.55 : 0.68;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(size * scale)}px ${fontStack}`;
    ctx.fillText(label, size * 0.5, size * 0.52);

    if (!underline) return;
    const metrics = ctx.measureText(label);
    const width = Math.max(metrics.width, size * 0.2) * 0.9;
    const barHeight = Math.max(2, size * 0.055);
    ctx.fillRect(size * 0.5 - width / 2, size * 0.78, width, barHeight);
}

/**
 * Exact 1D squared euclidean distance transform (Felzenszwalb & Huttenlocher).
 * Runs per row then per column to give the 2D transform in linear time.
 */
function edt1d(f, out, n, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;

    for (let q = 1; q < n; q++) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
            k--;
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
    }

    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        const d = q - v[k];
        out[q] = d * d + f[v[k]];
    }
}

function distanceTransform(mask, width, height) {
    const dist = new Float64Array(width * height);
    const f = new Float64Array(Math.max(width, height));
    const row = new Float64Array(Math.max(width, height));
    const v = new Int32Array(Math.max(width, height));
    const z = new Float64Array(Math.max(width, height) + 1);

    for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 0 : 1e20;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) f[x] = dist[y * width + x];
        edt1d(f, row, width, v, z);
        for (let x = 0; x < width; x++) dist[y * width + x] = row[x];
    }
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) f[y] = dist[y * width + x];
        edt1d(f, row, height, v, z);
        for (let y = 0; y < height; y++) dist[y * width + x] = row[y];
    }

    for (let i = 0; i < dist.length; i++) dist[i] = Math.sqrt(dist[i]);
    return dist;
}

/**
 * Signed distance, in final-resolution texels, positive inside the glyph,
 * encoded to 0..255 with 128 sitting exactly on the outline.
 */
function signedFieldFromCoverage(coverage, width, height) {
    const inside = new Uint8Array(width * height);
    const outside = new Uint8Array(width * height);
    for (let i = 0; i < coverage.length; i++) {
        if (coverage[i] > 127) inside[i] = 1;
        else outside[i] = 1;
    }

    const toOutside = distanceTransform(outside, width, height);
    const toInside = distanceTransform(inside, width, height);

    const field = new Uint8Array(width * height);
    for (let i = 0; i < field.length; i++) {
        const signed = (inside[i] ? toOutside[i] : -toInside[i]) / SUPERSAMPLE;
        const encoded = Math.round(128 + (signed / SPREAD) * 127);
        field[i] = Math.min(255, Math.max(0, encoded));
    }
    return field;
}

/** Box-filter the supersampled field down to the cell resolution. */
function downsample(field, width, height, factor) {
    const outW = Math.floor(width / factor);
    const outH = Math.floor(height / factor);
    const out = new Uint8Array(outW * outH);
    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
            let sum = 0;
            for (let sy = 0; sy < factor; sy++) {
                for (let sx = 0; sx < factor; sx++) {
                    sum += field[(y * factor + sy) * width + x * factor + sx];
                }
            }
            out[y * outW + x] = Math.round(sum / (factor * factor));
        }
    }
    return { data: out, width: outW, height: outH };
}

function rasterizeGlyph(key, fontStack) {
    const size = CELL_SIZE * SUPERSAMPLE;
    const canvas = createCanvas(size, size);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);
    const { kind, label, underline } = parseGlyphKey(key);
    if (kind === 'pips') drawPips(ctx, label, size);
    else drawText(ctx, label, size, fontStack, underline);

    const image = ctx.getImageData(0, 0, size, size).data;
    const coverage = new Uint8Array(size * size);
    for (let i = 0; i < coverage.length; i++) coverage[i] = image[i * 4 + 3];

    const field = signedFieldFromCoverage(coverage, size, size);
    return downsample(field, size, size, SUPERSAMPLE);
}

/**
 * Build one atlas covering every requested glyph.
 *
 * @param {string[]} glyphKeys distinct keys from `collectGlyphKeys`
 * @param {{ font?: string }} [options]
 * @returns {{ texture: THREE.DataTexture, cells: Record<string, THREE.Vector4>, columns: number, dispose: () => void } | null}
 */
export function buildGlyphAtlas(glyphKeys, options = {}) {
    const keys = [...new Set(glyphKeys)].filter(Boolean);
    if (!keys.length) return null;

    const fontStack = resolveFontStack(options.font);
    const columns = Math.max(1, Math.ceil(Math.sqrt(keys.length)));
    const rows = Math.ceil(keys.length / columns);
    const width = columns * CELL_SIZE;
    const height = rows * CELL_SIZE;

    // 128 is the outline: an unwritten cell reads as "entirely outside the glyph".
    const data = new Uint8Array(width * height * 4);

    /** @type {Record<string, THREE.Vector4>} */
    const cells = {};
    let wrote = false;

    keys.forEach((key, index) => {
        const cellX = (index % columns) * CELL_SIZE;
        const cellY = Math.floor(index / columns) * CELL_SIZE;
        const glyph = rasterizeGlyph(key, fontStack);
        if (glyph) {
            wrote = true;
            for (let y = 0; y < CELL_SIZE; y++) {
                for (let x = 0; x < CELL_SIZE; x++) {
                    const value = glyph.data[y * glyph.width + x];
                    const offset = ((cellY + y) * width + cellX + x) * 4;
                    data[offset] = value;
                    data[offset + 1] = value;
                    data[offset + 2] = value;
                    data[offset + 3] = 255;
                }
            }
        }
        cells[key] = new THREE.Vector4(
            cellX / width,
            cellY / height,
            CELL_SIZE / width,
            CELL_SIZE / height
        );
    });

    if (!wrote) return null;

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    return {
        texture,
        cells,
        columns,
        dispose: () => texture.dispose(),
    };
}

/** Handy for warming the atlas: every glyph a plain numeral die could need. */
export function numeralGlyphKeys(maxValue) {
    const keys = [];
    for (let value = 1; value <= maxValue; value++)
        keys.push(makeGlyphKey('text', String(value), false));
    return keys;
}

export { CELL_SIZE as GLYPH_CELL_SIZE, SPREAD as GLYPH_SDF_SPREAD };
