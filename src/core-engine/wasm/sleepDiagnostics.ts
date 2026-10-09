/**
 * Decoder for DicePhysicsEngine::buildSleepDiagnostics() — "why is it awake?"
 *
 * The engine packs one fixed-stride float record per die, then per dynamic
 * prop (layout documented in dice_physics_engine.hpp). This module turns that
 * into objects and a one-line summary so a settle timeout can say which body
 * is awake and what it is touching instead of just "Timeout exceeded".
 */

/** Must match DicePhysicsEngine::SLEEP_DIAG_MANIFOLDS / SLEEP_DIAG_STRIDE. */
export const SLEEP_DIAG_MANIFOLDS = 4;
export const SLEEP_DIAG_STRIDE = 13 + SLEEP_DIAG_MANIFOLDS * 4;

/** ManifoldKind in dice_contacts.hpp, by value. */
const MANIFOLD_KINDS = [
    'dieDie',
    'dieStatic',
    'dieTable',
    'dieWall',
    'dieContainer',
    'dieDynamic',
    'dynamicDynamic',
    'dynamicStatic',
    'dynamicTable',
    'dynamicWall',
    'dynamicContainer',
] as const;

/** Static material tags (applyStaticMaterial in dice_engine_collision_static.cpp). */
const MATERIAL_TAGS: Record<number, string> = {
    0: 'default',
    1: 'velvet',
    2: 'wood',
    3: 'metal',
    4: 'leather',
};

export interface SleepContact {
    kind: string;
    /** Die / dynamic / static user id; -1 for the analytic table, walls and container planes. */
    otherId: number;
    material: string | null;
    deepestSeparation: number;
}

export interface SleepDiagnostic {
    body: 'die' | 'dynamic';
    id: number;
    sleeping: boolean;
    kinematic: boolean;
    speed: number;
    /** |angular velocity| × bounding radius — surface speed from spin. */
    spinSpeed: number;
    sleepTimer: number;
    kineticEnergy: number;
    /** What the island sleep test compares against SLEEP_ENERGY_THRESHOLD. */
    islandEnergy: number;
    islandSize: number;
    manifolds: number;
    contactPoints: number;
    deepestSeparation: number;
    contacts: SleepContact[];
}

function round(value: number, digits = 4): number {
    const f = 10 ** digits;
    return Math.round(value * f) / f;
}

export function decodeSleepDiagnostics(
    buf: ArrayLike<number> | null | undefined,
    stride = SLEEP_DIAG_STRIDE
): SleepDiagnostic[] {
    if (!buf || buf.length < stride) return [];
    const out: SleepDiagnostic[] = [];
    for (let base = 0; base + stride <= buf.length; base += stride) {
        const at = (i: number) => Number(buf[base + i] ?? 0);
        const contacts: SleepContact[] = [];
        for (let k = 0; k < SLEEP_DIAG_MANIFOLDS; k++) {
            const slot = 13 + k * 4;
            const kind = at(slot);
            if (kind < 0) break;
            const tag = at(slot + 2);
            contacts.push({
                kind: MANIFOLD_KINDS[kind] ?? `kind${kind}`,
                otherId: at(slot + 1),
                material: tag >= 0 ? (MATERIAL_TAGS[tag] ?? `tag${tag}`) : null,
                deepestSeparation: round(at(slot + 3)),
            });
        }
        out.push({
            body: at(0) === 0 ? 'die' : 'dynamic',
            id: at(1),
            sleeping: at(2) === 1,
            kinematic: at(3) === 1,
            speed: round(at(4)),
            spinSpeed: round(at(5)),
            sleepTimer: round(at(6)),
            kineticEnergy: round(at(7)),
            islandEnergy: round(at(8)),
            islandSize: at(9),
            manifolds: at(10),
            contactPoints: at(11),
            deepestSeparation: round(at(12)),
            contacts,
        });
    }
    return out;
}

/** Bodies that keep the world from sleeping, most energetic island first. */
export function awakeBodies(diags: SleepDiagnostic[]): SleepDiagnostic[] {
    return diags
        .filter((d) => !d.sleeping && !d.kinematic)
        .sort((a, b) => b.islandEnergy - a.islandEnergy);
}

/** One line per awake body, for a test failure message or console.warn. */
export function summarizeSleepDiagnostics(diags: SleepDiagnostic[]): string {
    const awake = awakeBodies(diags);
    if (diags.length === 0) return 'no bodies in the engine';
    if (awake.length === 0) return `all ${diags.length} bodies asleep or kinematic`;
    return awake
        .map((d) => {
            const touching = d.contacts
                .map(
                    (c) =>
                        `${c.kind}#${c.otherId}${c.material ? `(${c.material})` : ''}@${c.deepestSeparation}`
                )
                .join(' ');
            return (
                `${d.body} ${d.id}: v=${d.speed} spin=${d.spinSpeed} islandKE=${d.islandEnergy}` +
                ` (n=${d.islandSize}) timer=${d.sleepTimer} pts=${d.contactPoints}` +
                (touching ? ` touching ${touching}` : ' touching nothing')
            );
        })
        .join('\n');
}
