import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import {
    CACHE_CLASSES,
    classify,
    parseCacheControl,
    wasmTypeError,
} from '../../scripts/lib/cachePolicy.mjs';

const byId = (id: string) => CACHE_CLASSES.find((c: { id: string }) => c.id === id);
const verdict = (id: string, header: string) => byId(id).check(parseCacheControl(header));

describe('cache policy classes', () => {
    it('classifies the deploy by path', () => {
        expect(classify('index.html')?.id).toBe('shell');
        expect(classify('/')?.id).toBe('shell');
        expect(classify('sw.js')?.id).toBe('shell');
        expect(classify('workbox-835c8c05.js')?.id).toBe('shell');
        expect(classify('build-info.json')?.id).toBe('build-info');
        expect(classify('assets/index-CikONlGA.js')?.id).toBe('hashed');
        expect(classify('assets/three.webgpu-BQfvWCId.js')?.id).toBe('hashed');
        expect(classify('wasm/dice_physics.wasm')?.id).toBe('wasm');
        expect(classify('wasm-scalar/dice_physics.js')?.id).toBe('wasm');
        expect(classify('images/table_diff.ktx2')?.id).toBe('static');
        expect(classify('draco/draco_decoder.wasm')?.id).toBe('static');
    });

    it('the shell must revalidate; a long max-age fails', () => {
        expect(verdict('shell', 'no-cache')).toBeNull();
        expect(verdict('shell', 'no-store')).toBeNull();
        expect(verdict('shell', 'public, max-age=0, must-revalidate')).toBeNull();
        expect(verdict('shell', 'public, max-age=3600')).not.toBeNull();
        expect(verdict('shell', '')).not.toBeNull();
    });

    it('hashed bundles must be immutable for a year', () => {
        expect(verdict('hashed', 'public, max-age=31536000, immutable')).toBeNull();
        expect(verdict('hashed', 'public, max-age=31536000')).toMatch(/immutable/);
        expect(verdict('hashed', 'public, max-age=3600, immutable')).toMatch(/max-age/);
        expect(verdict('hashed', '')).not.toBeNull();
    });

    it('un-hashed engine files revalidate and are never immutable', () => {
        expect(verdict('wasm', 'no-cache')).toBeNull();
        expect(verdict('wasm', 'public, max-age=31536000, immutable')).not.toBeNull();
    });

    it('un-hashed static files may be cached but not immutable', () => {
        expect(
            verdict('static', 'public, max-age=86400, stale-while-revalidate=604800')
        ).toBeNull();
        expect(verdict('static', 'public, max-age=31536000, immutable')).toMatch(/immutable/);
        expect(verdict('static', '')).not.toBeNull();
    });

    it('wasm needs its MIME type', () => {
        expect(wasmTypeError('application/wasm')).toBeNull();
        expect(wasmTypeError('application/octet-stream')).not.toBeNull();
        expect(wasmTypeError(null)).not.toBeNull();
    });
});
