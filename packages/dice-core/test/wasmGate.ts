/**
 * WASM-dependent tests skip on a laptop without `npm run build:wasm`, and fail
 * — never skip — under CI, where the unit-wasm job downloads the artifacts. A
 * job that forgot to download them must go red, not report green having run
 * nothing (the hole that let rollHeadless ship broken in Node).
 */
import { describe, it } from 'vitest';
import { wasmArtifactsPresent } from 'dice-core';

export const hasWasm = wasmArtifactsPresent();

/** CI (any truthy $CI) treats a missing artifact as an error. */
export const wasmRequired = Boolean(process.env.CI);

/** `describe` for tests that need the compiled engine. */
export function describeWasm(name: string, body: () => void): void {
    if (hasWasm) {
        describe(name, body);
    } else if (wasmRequired) {
        describe(name, () => {
            it('has the compiled WASM engine', () => {
                throw new Error(
                    'public/wasm artifacts missing under $CI — the job must download ' +
                        'wasm-artifacts (or run npm run build:wasm) before these tests.'
                );
            });
        });
    } else {
        describe.skip(`${name} (no public/wasm — run npm run build:wasm)`, body);
    }
}
