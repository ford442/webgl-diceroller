import { isWasmAvailable, isWasmInitialized } from '../wasm/PhysicsBridge.js';

const searchParams = new URLSearchParams(window.location.search);

export const isUsingWasmPhysics = () => isWasmInitialized() && isWasmAvailable();

/**
 * True when this session needs ammo.js rigid bodies for dice (fallback, dual validation,
 * or legacy ammo-drag). Default WASM sessions skip ammo dice bodies entirely.
 */
export const needsAmmoDiceBackend = () =>
    !isUsingWasmPhysics() || searchParams.has('dual-physics') || searchParams.has('ammo-drag');

/** @deprecated Use needsAmmoDiceBackend */
export const needsAmmoDiceBodies = needsAmmoDiceBackend;
