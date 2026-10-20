/**
 * The physics worker learns the app's public root from the page (#subdir
 * deploys): resolving BASE_URL from the worker's own script URL sent
 * `wasm/dice_physics.js` to the host root and 404'd under /dice-roller/.
 */
import { describe, expect, it } from 'vitest';
import { fetchAssetSource } from 'dice-core/assets/AssetSource';
import { decodeWorkerBootName, encodeWorkerBootName } from 'dice-core/wasm/workerBoot';

describe('worker boot name', () => {
    it('round-trips the artifact dir and the public root', () => {
        const name = encodeWorkerBootName({
            dir: 'wasm-scalar',
            publicBase: 'https://test.1ink.us/dice-roller/',
        });
        expect(decodeWorkerBootName(name)).toEqual({
            dir: 'wasm-scalar',
            publicBase: 'https://test.1ink.us/dice-roller/',
        });
    });

    it('resolves worker artifacts under the subdirectory, not the host root', () => {
        const { publicBase } = decodeWorkerBootName(
            encodeWorkerBootName({ dir: 'wasm', publicBase: 'https://test.1ink.us/dice-roller/' })
        );
        expect(fetchAssetSource(publicBase).url('wasm/dice_physics.js')).toBe(
            'https://test.1ink.us/dice-roller/wasm/dice_physics.js'
        );
    });

    it('accepts the bare artifact-dir name and ignores junk', () => {
        expect(decodeWorkerBootName('wasm')).toEqual({ dir: 'wasm' });
        expect(decodeWorkerBootName('')).toEqual({});
        expect(decodeWorkerBootName(undefined)).toEqual({});
        expect(decodeWorkerBootName('not json')).toEqual({});
        expect(decodeWorkerBootName('{"dir":"elsewhere","publicBase":7}')).toEqual({});
    });
});
