/**
 * Node entry point (`dice-core/node`): everything in the browser-safe index
 * plus the headless roller and its filesystem helpers.
 */
export * from './index.js';
export {
    rollHeadless,
    wasmArtifactsPresent,
    defaultPublicDir,
    createNodeAssetUrl,
    type HeadlessRollResult,
    type HeadlessRollTrace,
    type HeadlessDieResult,
    type RollHeadlessOptions,
} from './rollHeadless.js';
