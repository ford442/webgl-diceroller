import { unregisterInteractiveObject } from '../../interaction.js';
import { disposePropSpawn } from '../PropLifecycle.js';
import { mergePropRecord } from '../../core/StaticPropMerger.js';
import { getPropFactory } from './factories.js';
import { resolveEntryPosition } from './entryHelpers.js';
import {
    SHADOW_DISABLED_PROP_NAMES,
    resolveRootObject,
    applyShadowPolicyToResult,
    applyFarShadowLOD,
} from './shadowPolicy.js';
import { INTERACTIVE_NAMES } from './propIndex.js';
import { selectDecorPoolEntries } from './randomPool.js';

// Test/debug hook: `?forceProps=Flute,PlayingCards` guarantees those randomPool
// props spawn regardless of seed, so e2e tests can target their interactions
// deterministically. Has no effect on normal play.
function getForcedProps() {
    try {
        const raw = new URLSearchParams(window.location.search).get('forceProps');
        return raw
            ? new Set(
                  raw
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
              )
            : null;
    } catch {
        return null;
    }
}

/** @param {{seed?: number, theme?: string}} [options] */
export async function spawnTierWithRandomPool(entries, maxRandom, context, options = {}) {
    const { seed, theme } = options;
    const always = entries.filter((entry) => !entry.randomPool);
    const selected = selectDecorPoolEntries(entries, maxRandom, {
        seed: seed ?? context.layoutConfig?.seed,
        theme: theme ?? context.layoutConfig?.theme,
    });

    const forced = getForcedProps();
    if (forced) {
        const isSelected = (entry) => selected.includes(entry);
        for (const entry of entries) {
            if (!entry.randomPool) continue;
            const name = entry.factoryName || entry.name;
            if ((forced.has(name) || forced.has(entry.name)) && !isSelected(entry)) {
                selected.push(entry);
            }
        }
    }

    const records = [];

    for (const entry of always) {
        await spawnProp(entry, context);
    }

    for (const entry of selected) {
        const record = await spawnProp(entry, context);
        records.push(record);
    }

    return records;
}

export async function spawnProp(entry, context) {
    const factoryName = entry.factoryName || entry.name;
    let result;
    let updateHandle = null;
    const previousRegisterUpdate = context.registerUpdate;

    context.registerUpdate = (name, update, priority = 0) => {
        if (!update) return null;
        updateHandle = previousRegisterUpdate(name, update, priority);
        return updateHandle;
    };

    if (entry.call) {
        result = await entry.call(context);
    } else if (entry.position) {
        result = await getPropFactory(factoryName)(
            context.scene,
            context.physicsWorld,
            resolveEntryPosition(entry),
            entry.rotation ?? 0
        );
    } else {
        result = await getPropFactory(factoryName)(context.scene, context.physicsWorld);
    }

    if (entry.afterCreate) {
        entry.afterCreate(result, context);
    }

    context.registerUpdate = previousRegisterUpdate;

    if (entry.shadow === 'off' || SHADOW_DISABLED_PROP_NAMES.has(factoryName)) {
        applyShadowPolicyToResult(result, false);
    } else if (entry.shadow !== 'on') {
        applyFarShadowLOD(result);
    }

    const root = resolveRootObject(result);
    if (root && context.cullingSystem && entry.cull !== false) {
        context.cullingSystem.register(root, { important: entry.important === true });
    }

    const canStaticMerge =
        entry.staticMerge !== false && !updateHandle && !INTERACTIVE_NAMES.has(factoryName);
    let mergeStats = null;
    if (canStaticMerge) {
        mergeStats = mergePropRecord({ result, updateHandle });
        if (mergeStats.merged && context.cullingSystem && root) {
            context.cullingSystem.refreshSphere(root);
        }
    }

    const disposers = typeof result?.dispose === 'function' ? [result.dispose] : undefined;
    return { entry, result, updateHandle, disposers, mergeStats };
}

export function despawnProp(record, context) {
    const root = resolveRootObject(record?.result);
    if (root) {
        context.cullingSystem?.unregister(root);
        // Drop any raycast interaction registered against this prop's root so a
        // re-rolled layout doesn't leave stale clickable entries behind.
        unregisterInteractiveObject(root);
    }
    disposePropSpawn(record, context.physicsWorld);
}
