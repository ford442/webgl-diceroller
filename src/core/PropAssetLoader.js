import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

let gltfLoader = null;
let dracoLoader = null;
let objLoader = null;

export function initPropAssetLoader() {
    if (gltfLoader) return { gltfLoader, dracoLoader, objLoader };

    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('./draco/');

    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    objLoader = new OBJLoader();
    return { gltfLoader, dracoLoader, objLoader };
}

/**
 * Load a Draco-compressed prop GLB. Falls back to legacy OBJ when the GLB is
 * missing or fails to decode (dev without running convert:props).
 */
export async function loadPropMesh(glbUrl, { fallbackObjUrl = null } = {}) {
    initPropAssetLoader();

    try {
        const gltf = await gltfLoader.loadAsync(glbUrl);
        return gltf.scene;
    } catch (glbError) {
        if (!fallbackObjUrl) throw glbError;
        console.warn(`[PropAssetLoader] GLB failed (${glbUrl}), falling back to OBJ:`, glbError.message);
        return objLoader.loadAsync(fallbackObjUrl);
    }
}

export function disposePropAssetLoader() {
    dracoLoader?.dispose();
    gltfLoader = null;
    dracoLoader = null;
    objLoader = null;
}
