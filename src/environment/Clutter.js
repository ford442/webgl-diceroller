import { createRandomClutter } from './RandomClutter.js';

/** Back-compat entry used by PropRegistry tier0. */
export function createClutter(scene, physicsWorld, options = {}) {
    return createRandomClutter(scene, physicsWorld, options);
}

export { createRandomClutter, CLUTTER_REGISTRY } from './RandomClutter.js';
