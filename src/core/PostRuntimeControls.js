/**
 * Runtime knobs for the post pipeline without rebuilding composers or TSL graphs.
 */

/**
 * @param {object} options
 * @param {import('../types/app').ComposerLike | null | undefined} options.composer
 * @param {Record<string, unknown>} [options.postPasses]
 * @param {import('../types/app').PostConfig} [options.postConfig]
 */
export function createPostRuntimeControls({ composer, postPasses = {}, postConfig = {} }) {
    const bloomPass = /** @type {{ enabled?: boolean; strength?: number } | null} */ (
        postPasses.bloomPass ?? null
    );
    const webgpuControls =
        /** @type {{ setBloomBlend?: (v: number) => void; setChromaticIntensity?: (v: number) => void } | null} */ (
            composer?.type === 'webgpu-post' ? composer : null
        );

    const baselineBloomStrength =
        bloomPass?.strength ?? (postConfig.quality === 'low' ? 0.35 : 0.6);
    const baselineBloomBlend = postConfig.bloomEnabled ? 1 : 0;
    const baselineChromatic = postConfig.chromaticAberrationEnabled ? 0.2 : 0;

    let bloomBlend = baselineBloomBlend;
    let chromaticIntensity = baselineChromatic;

    function applyBloomBlend() {
        if (webgpuControls?.setBloomBlend) {
            webgpuControls.setBloomBlend(bloomBlend);
            return;
        }
        if (!bloomPass) return;
        bloomPass.enabled = bloomBlend > 0;
        bloomPass.strength = baselineBloomStrength * bloomBlend;
    }

    function applyChromaticIntensity() {
        if (webgpuControls?.setChromaticIntensity) {
            webgpuControls.setChromaticIntensity(chromaticIntensity);
        }
    }

    function setBloomBlend(value) {
        bloomBlend = Math.max(0, Math.min(1, value));
        applyBloomBlend();
    }

    function setChromaticIntensity(value) {
        chromaticIntensity = Math.max(0, Math.min(1, value));
        applyChromaticIntensity();
    }

    function restoreBaseline() {
        bloomBlend = baselineBloomBlend;
        chromaticIntensity = baselineChromatic;
        applyBloomBlend();
        applyChromaticIntensity();
    }

    applyBloomBlend();
    applyChromaticIntensity();

    return {
        setBloomBlend,
        setChromaticIntensity,
        getBloomBlend: () => bloomBlend,
        getChromaticIntensity: () => chromaticIntensity,
        restoreBaseline,
        getBaselineBloomBlend: () => baselineBloomBlend,
        getBaselineChromaticIntensity: () => baselineChromatic,
    };
}
