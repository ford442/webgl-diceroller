export const SHADOW_DISABLED_PROP_NAMES = new Set([
    'Chalk',
    'Dart',
    'Bell',
    'MysticTome',
    'Pencil',
    'Bone',
    'Key',
    'CoinPouch',
    'PocketFlask',
    'Compass',
    'WaxSeal',
    'PocketWatch',
    'Dagger',
    'PlayingCards',
    'DragonScale',
    'CharacterSheet',
    'BountyPoster',
    'CheeseWheel',
    'Runestones',
    'Gemstones',
    'WritingSet',
    'SmokingPipe',
    'Crown',
    'Chalice',
    'Miniature',
    'Scroll',
    'Coin',
    'Amulet',
    'Abacus',
    'Padlock',
    'Spectacles',
    'Lockpicks',
    'LeatherJournal',
    'MagnifyingGlass',
    'Rope',
    'Candelabra',
    'Waterskin',
    'Astrolabe',
    'Sundial',
    'Flute',
    'Apple',
    'WoodenSpoon',
    'Warhammer',
    'BreadLoaf',
]);

export function resolveRootObject(result) {
    if (!result) return null;
    if (result.isObject3D) return result;
    if (result.group?.isObject3D) return result.group;
    return null;
}

export function applyShadowPolicyToResult(result, enabled) {
    const root = resolveRootObject(result);
    if (!root) return;

    root.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = enabled;
        if (!enabled) child.receiveShadow = false;
    });
}

// Shadow LOD (bonus): props whose root sits far from the table centre contribute
// little to what the camera sees, so we statically drop their shadow casting
// (receiving is kept so they still read as lit). Static + distance-based, applied
// once at spawn — no per-frame shadow-map churn.
const FAR_SHADOW_DISTANCE = 26;

export function applyFarShadowLOD(result) {
    const root = resolveRootObject(result);
    if (!root) return;
    const dist = Math.hypot(root.position.x, root.position.z);
    if (dist <= FAR_SHADOW_DISTANCE) return;
    root.traverse((child) => {
        if (child.isMesh) child.castShadow = false;
    });
}
