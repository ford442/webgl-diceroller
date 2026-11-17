/**
 * A scene document: the data that says where one dice table is set.
 *
 * The catalogue of prop factories is shared by every scene (`PROP_FACTORIES`).
 * What a scene owns is the list that places them — which factory, which tier,
 * where — plus the physics numbers and the lighting preset of the room. Nothing
 * in here imports Three or the DOM, so a document can be validated, hashed and
 * compared in Node.
 *
 * What is *not* in a document: geometry (a factory builds it), behaviour (named
 * hooks in `propRegistry/propHooks.js` wire `update` / `interact` / controllers
 * to a factory), and the layout seed (`TableLayoutConfig` scatters clutter and
 * picks the decor subset inside the slots the document declares).
 */

/**
 * 0 core (shell, table, clutter) · 1 furniture / ambience · 2 tabletop items
 * around the dice zone · 3 decorative extras. Tiers 2 and 3 together are the
 * decor pool: a prop with `randomPool` is drawn from the layout seed, one
 * without is always spawned.
 */
export type SceneTier = 0 | 1 | 2 | 3;

export interface SceneVec3 {
    x: number;
    y: number;
    z: number;
}

export interface SceneProp {
    /** Key into `PROP_FACTORIES` (`Mug`, `Chair`, …). */
    factory: string;
    tier: SceneTier;
    /**
     * Unique name of this placement, defaulting to `factory`. Only needed when
     * a factory appears twice (`ChairRight`). It keys the prop's RNG stream, so
     * renaming one changes that prop's seeded scatter.
     */
    id?: string;
    /**
     * Where the factory puts it. Legacy tabletop heights (`y` in (-3.25, -1.5))
     * are lifted to the current table surface at spawn, as before. Omit for a
     * prop that places itself (the room shell, or a seeded scatter).
     */
    position?: SceneVec3;
    rotationY?: number;
    /**
     * Passed to the factory as `{ scale }`. Only factories that accept the
     * kit's `scale` option honour it; the validator cannot know which.
     */
    scale?: number;
    /** Tier 2/3 only: may be dropped by the layout seed's decor draw. */
    randomPool?: boolean;
    /** `false` keeps the prop out of frustum culling (room shell, atmosphere). */
    cull?: boolean;
}

/**
 * What `engine.init` is given. The tavern's values are `dice-core`'s
 * `PHYSICS_*` constants — the same numbers `rollHeadless` and the seeded
 * throw parameters assume — so a scene that changes them is a different
 * simulation from the headless core's until that core reads the document too.
 */
export interface SceneTable {
    /** Physics table plane height handed to the engine (legacy `-2.75`). */
    y: number;
    halfW: number;
    halfD: number;
}

export interface SceneDocument {
    id: string;
    /** Shown in the loading text ("Building <label> environment..."). */
    label: string;
    gravity: number;
    table: SceneTable;
    /** A `LightingPresets` id. */
    lighting: string;
    props: readonly SceneProp[];
}

/** The id a scene entry is registered, named and seeded under. */
export const propId = (prop: SceneProp): string => prop.id ?? prop.factory;

export const SCENE_TIERS: readonly SceneTier[] = [0, 1, 2, 3];

export interface SceneValidationOptions {
    /** Names `PROP_FACTORIES` exposes; omit to skip the factory check. */
    factories?: ReadonlySet<string> | null;
    /** Lighting preset ids; omit to skip the lighting check. */
    lightingIds?: ReadonlySet<string> | null;
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/**
 * Every way a document would build a broken table, as readable lines. Empty
 * means the document is loadable. Pure: it never throws on a malformed input.
 */
export function validateSceneDocument(
    doc: SceneDocument,
    options: SceneValidationOptions = {}
): string[] {
    const errors: string[] = [];
    const where = `scene "${doc?.id ?? '?'}"`;

    if (typeof doc?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(doc.id)) {
        errors.push(`${where}: id must be lowercase kebab-case`);
    }
    if (typeof doc?.label !== 'string' || !doc.label.trim()) {
        errors.push(`${where}: label is required`);
    }
    if (!isFiniteNumber(doc?.gravity) || doc.gravity >= 0) {
        errors.push(`${where}: gravity must be a finite negative number`);
    }
    const table = doc?.table;
    if (!table || !isFiniteNumber(table.y)) errors.push(`${where}: table.y must be finite`);
    if (!table || !isFiniteNumber(table.halfW) || table.halfW <= 0) {
        errors.push(`${where}: table.halfW must be a positive number`);
    }
    if (!table || !isFiniteNumber(table.halfD) || table.halfD <= 0) {
        errors.push(`${where}: table.halfD must be a positive number`);
    }
    if (options.lightingIds && !options.lightingIds.has(doc?.lighting)) {
        errors.push(`${where}: unknown lighting preset "${doc?.lighting}"`);
    }

    const props = Array.isArray(doc?.props) ? doc.props : [];
    if (!Array.isArray(doc?.props) || props.length === 0) {
        errors.push(`${where}: props must be a non-empty array`);
    }

    const seen = new Set<string>();
    let tables = 0;
    for (const [index, prop] of props.entries()) {
        const id = propId(prop);
        const at = `${where} props[${index}] "${id}"`;
        if (typeof prop.factory !== 'string' || !prop.factory) {
            errors.push(`${at}: factory is required`);
            continue;
        }
        if (prop.factory === 'Table') tables++;
        if (options.factories && !options.factories.has(prop.factory)) {
            errors.push(`${at}: no prop factory named "${prop.factory}"`);
        }
        if (seen.has(id)) errors.push(`${at}: duplicate id (give one of them an explicit "id")`);
        seen.add(id);
        if (!SCENE_TIERS.includes(prop.tier)) errors.push(`${at}: tier must be 0, 1, 2 or 3`);
        if (prop.randomPool && prop.tier < 2) {
            errors.push(`${at}: randomPool only applies to tiers 2 and 3`);
        }
        const p = prop.position;
        if (p && !(isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z))) {
            errors.push(`${at}: position must be finite {x, y, z}`);
        }
        if (prop.rotationY !== undefined && !isFiniteNumber(prop.rotationY)) {
            errors.push(`${at}: rotationY must be finite`);
        }
        if (prop.scale !== undefined && !(isFiniteNumber(prop.scale) && prop.scale > 0)) {
            errors.push(`${at}: scale must be a positive number`);
        }
    }
    // The engine's table bounds come from the document, but the rim colliders
    // come from the Table factory: a scene without one has nothing to roll on.
    if (tables !== 1) errors.push(`${where}: needs exactly one "Table" prop (found ${tables})`);

    return errors;
}
