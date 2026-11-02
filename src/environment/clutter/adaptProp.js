import { toCurrentTabletopY } from '../../core/SceneMetrics.js';
import { resolvePlacement } from './ClutterPlacement.js';
import { factoryNameOf, getPropScope, withPropScope } from '../propRng.js';

/**
 * Adapt a named prop factory to the clutter-registry calling convention.
 *
 * The two paths differ only in how a prop is *placed*, not in what it is:
 *
 * - `PropRegistry` / `tierDefinitions` call `(scene, physicsWorld, position,
 *   rotationY)` with an authored legacy-tabletop position.
 * - `RandomClutter` calls `(scene, physicsWorld, options)` and expects the
 *   factory to resolve its own seeded slot and to hand its root back through
 *   `options.track` so the scatter merge pass and the culling system see it.
 *
 * Wrapping the named module here is what lets one geometry + one collider spec
 * serve both, instead of the clutter/* fork that used to shadow them.
 *
 * The factory runs under the same kind of prop scope the tier path opens
 * (`spawnProp`): `RandomClutter` supplies the layout seed and the scatter slot,
 * and this wrapper names the prop after its factory, so the group is `Mug` (not
 * a clutter-only alias) and its RNG stream is the one `createProp` claims on
 * either path.
 *
 * @param {(scene: any, physicsWorld: any, position: any, rotationY: number, options?: object) => any} factory
 * @param {{
 *   x: number,
 *   z: number,
 *   y?: number,
 *   scale?: number,
 *   rotationY?: number | null,
 *   placed?: boolean,
 * }} defaults Fallback pose used when the registry supplies no slot. `y` is a
 *   legacy tabletop coordinate (matching `tierDefinitions`), converted through
 *   `toCurrentTabletopY`. `placed: false` pins the prop (see `dmScreen`).
 */
export function asClutter(
    factory,
    { x, z, y = -2.75, scale = 1, rotationY = null, placed = true }
) {
    const factoryName = factoryNameOf(factory);

    return function createAdaptedClutter(scene, physicsWorld, options = {}) {
        const placement = placed
            ? resolvePlacement(options, { x, z })
            : { x, z, rotationY: rotationY ?? 0 };

        const outer = getPropScope();
        const result = withPropScope(
            {
                layoutSeed: outer?.layoutSeed ?? 0,
                key: outer?.key ?? factoryName,
                name: factoryName,
                slot: outer?.slot ?? 0,
            },
            () =>
                factory(
                    scene,
                    physicsWorld,
                    toCurrentTabletopY({ x: placement.x, y, z: placement.z }),
                    rotationY ?? placement.rotationY,
                    { scale }
                )
        );

        const root = result?.group ?? (result?.isObject3D ? result : null);
        if (root?.isObject3D) options.track?.(root);

        return result;
    };
}
