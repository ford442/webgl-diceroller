import { describe, expect, it } from 'vitest';
import {
    WEBGPU_TEXTURE_COMPRESSION_FEATURES,
    WEBGPU_TIMESTAMP_QUERY_FEATURE,
    getWebGpuRequiredFeatures,
} from '../../src/core/WebGpuDevice.js';

const features = (...names: string[]) => new Set(names);

describe('getWebGpuRequiredFeatures', () => {
    it('requests texture compression the adapter reports, so KTX2Loader can pick a GPU format', () => {
        // Without these on the device, KTX2Loader transcodes to plain RGBA and
        // Three's WebGPU upload throws "reading 'width'" on the first draw.
        const got = getWebGpuRequiredFeatures(features('texture-compression-bc'), {
            wantTimestampQuery: false,
        });
        expect(got).toEqual(['texture-compression-bc']);
    });

    it('requests every compression family the adapter has', () => {
        const got = getWebGpuRequiredFeatures(features(...WEBGPU_TEXTURE_COMPRESSION_FEATURES), {
            wantTimestampQuery: false,
        });
        expect(got).toEqual([...WEBGPU_TEXTURE_COMPRESSION_FEATURES]);
    });

    it('never requests a feature the adapter lacks (requestDevice would reject)', () => {
        expect(getWebGpuRequiredFeatures(features(), { wantTimestampQuery: true })).toEqual([]);
    });

    it('does not request unrelated adapter features', () => {
        const got = getWebGpuRequiredFeatures(
            features('float32-filterable', 'shader-f16', 'texture-compression-bc'),
            { wantTimestampQuery: false }
        );
        expect(got).toEqual(['texture-compression-bc']);
    });

    it('adds timestamp-query only when asked for and supported', () => {
        const adapter = features('texture-compression-bc', WEBGPU_TIMESTAMP_QUERY_FEATURE);
        expect(getWebGpuRequiredFeatures(adapter, { wantTimestampQuery: false })).not.toContain(
            WEBGPU_TIMESTAMP_QUERY_FEATURE
        );
        expect(getWebGpuRequiredFeatures(adapter, { wantTimestampQuery: true })).toContain(
            WEBGPU_TIMESTAMP_QUERY_FEATURE
        );
    });
});
