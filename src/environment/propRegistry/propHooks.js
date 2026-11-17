/**
 * Named hooks for the props whose spawn is more than "a factory at a pose".
 *
 * A scene document (`src/scenes/`) says *where* a factory sits; this table says
 * what the app does with the result — start its `update`, register its click
 * handler and `interactables` entry, publish it to the controllers. Keyed by
 * **factory name**, so a prop gets the same behaviour in every scene that
 * places it and a document never carries a branch.
 *
 *  - `create(ctx, entry)` replaces the default factory call for a prop that is
 *    built differently (the table registers physics bounds, the lamp is hung
 *    from the ceiling, the bell takes a position, not a pose). `entry` is the
 *    compiled document entry, so a hook reads its pose from the document.
 *  - `afterCreate(result, ctx, entry)` runs after the prop exists.
 *
 * `ctx` is the spawn context (`LoadingTiers` / `RandomLayout`): `scene`,
 * `callbacks`, `state` (what `loadTiers` returns), `registerUpdate`, …
 */
import { registerInteractiveObject } from '../../interaction.js';
import { registerInteractable } from '../../interactables/InteractableRegistry.js';
import { toCurrentTabletopY } from '../../core/SceneMetrics.js';
import { createWasmTableBounds, isWasmAvailable } from '../../wasm/PhysicsBridge.js';
import { getPropFactory } from './factories.js';

/** `afterCreate` for the many props whose only wiring is a per-frame update. */
const updates = (label) => (result, ctx) =>
    result?.update && ctx.registerUpdate(label, result.update);

/** @type {Record<string, { create?: (ctx: any, entry: any) => any, afterCreate?: (result: any, ctx: any, entry: any) => void }>} */
export const PROP_HOOKS = {
    TavernWalls: {
        afterCreate: (result, ctx) => {
            if (result?.fireplaceLight) ctx.state.fireplaceLight = result.fireplaceLight;
            if (result?.update) ctx.registerUpdate('walls', result.update);
        },
    },
    Table: {
        create: (ctx) => {
            const tableConfig = getPropFactory('Table')(ctx.scene);
            if (isWasmAvailable()) {
                createWasmTableBounds(tableConfig);
            }
            return tableConfig;
        },
    },
    Clutter: {
        create: (ctx) =>
            getPropFactory('Clutter')(ctx.scene, ctx.physicsWorld, ctx.clutterOptions ?? {}),
        afterCreate: (result, ctx) => {
            ctx.state.clutterResult = result;
            if (result?.flamePosition) ctx.callbacks.setCandleFlamePos?.(result.flamePosition);
        },
    },
    Chest: { afterCreate: updates('chest') },
    Lamp: {
        // Hung from the ceiling at the document's position, not stood on the table.
        create: async (ctx, entry) => {
            const result = await getPropFactory('Lamp')();
            const { x, y, z } = entry.position;
            ctx.scene.add(result.group);
            result.group.position.set(x, y, z);
            return result;
        },
        afterCreate: (result, ctx) => {
            registerInteractiveObject(result.group, result.toggle);
            registerInteractable('lamp', { trigger: result.toggle });
            ctx.state.lampData = result;
            ctx.callbacks.setLampData?.(result);
            ctx.registerUpdate('lamp', result.update);
        },
    },
    FloatingCandles: { afterCreate: updates('floatingCandles') },
    Runecircle: { afterCreate: updates('runecircle') },
    DiceTower: {
        afterCreate: (result, ctx) => {
            if (!result) return;
            ctx.state.diceTowerProp = result;
            registerInteractiveObject(result.group, () => {
                ctx.callbacks.onDiceTowerInteract?.();
            });
            registerInteractable('diceTower', {
                trigger: () => ctx.callbacks.onDiceTowerInteract?.(),
                // `options` carries an explicit seed when a share link or
                // a room replay is reproducing a drop.
                drop: (idsOrAll, options) =>
                    ctx.callbacks.getDiceTowerController?.()?.dropDice(idsOrAll, options),
                getState: () =>
                    ctx.callbacks.getDiceTowerController?.()?.getState() ?? {
                        available: false,
                    },
            });
        },
    },
    DiceTray: {
        afterCreate: (result, ctx) => {
            if (!result) return;
            ctx.state.diceTrayProp = result;
            registerInteractiveObject(result.group, () => {
                ctx.callbacks.onDiceTrayInteract?.();
            });
            registerInteractable('diceTray', {
                trigger: () => ctx.callbacks.onDiceTrayInteract?.(),
                lock: () => ctx.callbacks.getDiceTrayController?.()?.lock(),
                unlock: () => ctx.callbacks.getDiceTrayController?.()?.unlock(),
                getState: () =>
                    ctx.callbacks.getDiceTrayController?.()?.getState() ?? { available: false },
            });
        },
    },
    DiceJail: {
        afterCreate: (result, ctx) => {
            if (!result) return;
            ctx.state.diceJailProp = result;
            registerInteractiveObject(result.group, () => {
                ctx.callbacks.onDiceJailInteract?.();
            });
            registerInteractable('diceJail', {
                trigger: () => ctx.callbacks.onDiceJailInteract?.(),
                hold: (idsOrNearby) => ctx.callbacks.getDiceJailController?.()?.hold(idsOrNearby),
                release: (ids) => ctx.callbacks.getDiceJailController?.()?.release(ids),
                getState: () =>
                    ctx.callbacks.getDiceJailController?.()?.getState() ?? { available: false },
            });
        },
    },
    DiceCup: {
        afterCreate: (result, ctx) => {
            if (!result) return;
            ctx.state.diceCupProp = result;
            registerInteractiveObject(result.group, () => {
                ctx.callbacks.onDiceCupInteract?.();
            });
            registerInteractable('diceCup', {
                trigger: () => ctx.callbacks.onDiceCupInteract?.(),
                getState: () => ({
                    ...result.getState(),
                    ...(ctx.callbacks.getDiceCupState?.() ?? {}),
                }),
            });
        },
    },
    Bell: {
        // The bell factory takes a table position, not a pose.
        create: (ctx, entry) =>
            getPropFactory('Bell')(ctx.scene, toCurrentTabletopY(entry.position)),
        afterCreate: (result, ctx) => {
            if (result?.interact) {
                registerInteractiveObject(result.group, result.interact);
                registerInteractable('bell', { trigger: result.interact });
            }
            if (result?.update) ctx.registerUpdate('bell', result.update);
        },
    },
    Skull: {
        afterCreate: (result) => {
            if (!result?.toggleGlow) return;
            registerInteractiveObject(result.group, result.toggleGlow);
            registerInteractable('skull', { trigger: result.toggleGlow });
        },
    },
    MerchantScale: { afterCreate: updates('scale') },
    Lantern: { afterCreate: updates('lantern') },
    // No `dynamic: true` here — spawn.js derives it from the collider spec's own
    // `dynamic: true` via `userData.isDynamicProp`.
    Mug: { afterCreate: updates('mug') },
    MeltingCandle: { afterCreate: updates('meltingCandle') },
    Tankard: { afterCreate: updates('tankard') },
    CharacterSheet: {
        afterCreate: (result, ctx) => {
            if (result) ctx.state.characterSheetProp = result;
        },
    },
    Candelabra: { afterCreate: updates('candelabra') },
    SmokingPipe: { afterCreate: updates('pipe') },
    Gemstones: { afterCreate: updates('gems') },
    WritingSet: { afterCreate: updates('writing') },
    Gong: {
        afterCreate: (result, ctx) => {
            if (!result) return;
            registerInteractiveObject(result.group, result.interact);
            registerInteractable('gong', { trigger: result.interact });
            ctx.state.gongData = result;
            ctx.callbacks.setGongData?.(result);
            ctx.registerUpdate('gong', result.update);
        },
    },
    MysticOrb: {
        afterCreate: (result, ctx) => {
            if (!result) return;
            registerInteractiveObject(result.group, result.interact);
            registerInteractable('mysticOrb', { trigger: result.interact });
            ctx.registerUpdate('mysticOrb', result.update);
        },
    },
    PlayingCards: {
        afterCreate: (result) =>
            result?.interact && registerInteractiveObject(result.group, result.interact),
    },
    Astrolabe: { afterCreate: updates('astrolabe') },
    Flute: {
        afterCreate: (result) =>
            result?.interact && registerInteractiveObject(result.group, result.interact),
    },
    Cauldron: {
        afterCreate: (result, ctx) => {
            if (result?.interact) {
                registerInteractiveObject(result.group, result.interact);
                registerInteractable('cauldron', { trigger: result.interact });
            }
            if (result?.update) ctx.registerUpdate('cauldron', result.update);
        },
    },
};
