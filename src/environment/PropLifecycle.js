import { isPaletteMaterial } from '../core/MaterialPalette.js';

function resolveRootObject(result) {
    if (!result) return null;
    if (result.isObject3D) return result;
    if (result.group?.isObject3D) return result.group;
    return null;
}

export function disposeObject3D(root) {
    if (!root?.isObject3D) return;

    root.parent?.remove(root);

    root.traverse((obj) => {
        if (!obj.isMesh) return;
        // Frees per-instance attribute buffers (instanceMatrix / instanceColor).
        if (obj.isInstancedMesh) obj.dispose?.();
        obj.geometry?.dispose?.();
        const material = obj.material;
        if (Array.isArray(material)) {
            material.forEach((mat) => {
                if (!isPaletteMaterial(mat)) mat?.dispose?.();
            });
        } else if (!isPaletteMaterial(material)) {
            material?.dispose?.();
        }
    });
}

export function disposePropSpawn(record) {
    if (!record) return;

    record.updateHandle?.dispose?.();
    record.disposers?.forEach((fn) => fn());

    const result = record.result;
    if (!result) return;

    const root = resolveRootObject(result);
    if (root) disposeObject3D(root);
    else if (result.isObject3D) disposeObject3D(result);

    if (Array.isArray(result.disposableRoots)) {
        for (const extra of result.disposableRoots) {
            disposeObject3D(extra);
        }
    }
}
