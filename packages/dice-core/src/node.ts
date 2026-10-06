/**
 * Node entry point (`dice-core/node`): everything in the browser-safe index
 * plus the headless roller and its filesystem helpers.
 */
export * from './index.js';
export { defaultPublicDir, fsAssetSource, wasmArtifactsPresent } from './assets/fsAssetSource.js';
export {
    rollHeadless,
    type HeadlessRollResult,
    type HeadlessRollTrace,
    type HeadlessDieResult,
    type RollHeadlessOptions,
} from './rollHeadless.js';
