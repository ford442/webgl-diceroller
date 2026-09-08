import { setDieWasmKinematic, findSpawnedDieByPhysicsId } from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { findDiceInLocalBox } from './PropDiceRegion.js';

/**
 * @typedef {Object} DiceTrayControllerDeps
 * @property {ReturnType<import('../environment/DiceTray.js').createDiceTray>} trayProp
 * @property {(message: string) => void} [onFeedback]
 */

/**
 * @param {DiceTrayControllerDeps} deps
 */
export function createDiceTrayController(deps) {
    const { trayProp, onFeedback } = deps;
    const trayGroup = trayProp.group;
    const halfExtents = trayProp.halfExtents;
    const highlightMesh = trayGroup.getObjectByName('trayLockHighlight') ?? null;

    /** @type {Set<number>} */
    const lockedWasmIds = new Set();

    const setHighlightVisible = (visible) => {
        if (highlightMesh) highlightMesh.visible = visible;
    };

    const lock = () => {
        if (!isWasmAvailable()) {
            onFeedback?.('Dice tray lock requires WASM physics');
            return 0;
        }
        const dice = findDiceInLocalBox(trayGroup, { halfExtents });
        if (dice.length === 0) {
            onFeedback?.('No dice in the tray to lock');
            return 0;
        }
        dice.forEach((die) => {
            setDieWasmKinematic(die.mesh, true);
            lockedWasmIds.add(die.wasmId);
        });
        setHighlightVisible(true);
        return dice.length;
    };

    const unlock = () => {
        lockedWasmIds.forEach((wasmId) => {
            const die = findSpawnedDieByPhysicsId(wasmId);
            if (die) setDieWasmKinematic(die.mesh, false);
        });
        lockedWasmIds.clear();
        setHighlightVisible(false);
    };

    const trigger = () => {
        if (lockedWasmIds.size > 0) unlock();
        else lock();
    };

    return {
        lock,
        unlock,
        trigger,
        getState: () => ({
            available: isWasmAvailable(),
            locked: lockedWasmIds.size > 0,
            lockedCount: lockedWasmIds.size,
        }),
    };
}

let activeController = null;

export function registerDiceTrayController(controller) {
    activeController = controller;
}

export function getDiceTrayController() {
    return activeController;
}
