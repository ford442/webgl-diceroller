import { isWasmAvailable, isWasmInitialized } from '../wasm/PhysicsBridge.js';

export const isUsingWasmPhysics = () => isWasmInitialized() && isWasmAvailable();

/**
 * True when this session needs ammo.js rigid bodies for dice. That is only the
 * case when the WASM engine is unavailable — either because `?no-wasm` was set
 * or because `public/wasm/` artifacts are missing. Every other configuration
 * (including the default) runs dice entirely on the WASM engine and never
 * creates an ammo body for a die.
 */
export const needsAmmoDiceBackend = () => !isUsingWasmPhysics();
