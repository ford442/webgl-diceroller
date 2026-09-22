/**
 * How the Emscripten glue's default export is unwrapped.
 *
 * `dice_physics.js` is built with `MODULARIZE=1 -s EXPORT_ES6=1`, so its
 * default export is the module factory — but *where* that lands depends on who
 * imported it, and getting it wrong is silent: the bridge catches the throw and
 * falls back to a JS stub that simulates nothing. That is exactly what made
 * `verify:tower-drop-replay` fail (and `rollHeadless` quietly useless) under
 * tsx, which rewrites the ESM glue to CommonJS and buries the factory one level
 * deeper.
 */
import { describe, expect, it } from 'vitest';
import { resolveDicePhysicsFactory } from '../../src/core-engine/wasm/wasmArtifact.js';

const factory = () => Promise.resolve({});

describe('resolveDicePhysicsFactory', () => {
    it('finds the factory on a real ES namespace (browser, plain Node)', () => {
        expect(resolveDicePhysicsFactory({ default: factory })).toBe(factory);
    });

    it('finds it through the CJS interop double-default (tsx, ts-node)', () => {
        expect(resolveDicePhysicsFactory({ default: { default: factory } })).toBe(factory);
    });

    it('accepts a bare callable namespace', () => {
        expect(resolveDicePhysicsFactory(factory)).toBe(factory);
    });

    it('prefers the outer default when both levels are callable', () => {
        const outer = () => Promise.resolve({});
        Object.assign(outer, { default: factory });
        expect(resolveDicePhysicsFactory({ default: outer })).toBe(outer);
    });

    it('returns null rather than a non-callable, so the caller can throw', () => {
        expect(resolveDicePhysicsFactory({ default: { nope: 1 } })).toBeNull();
        expect(resolveDicePhysicsFactory({})).toBeNull();
        expect(resolveDicePhysicsFactory(undefined)).toBeNull();
        expect(resolveDicePhysicsFactory(null)).toBeNull();
    });
});
