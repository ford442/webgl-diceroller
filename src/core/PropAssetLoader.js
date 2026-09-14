import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { publicAssetUrl } from './publicAssetUrl.js';

let gltfLoader = null;
let dracoLoader = null;

export function initPropAssetLoader() {
    if (gltfLoader) return { gltfLoader, dracoLoader };

    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(publicAssetUrl('draco/'));

    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    return { gltfLoader, dracoLoader };
}

/** Load a Draco-compressed prop GLB. */
export async function loadPropMesh(glbUrl) {
    initPropAssetLoader();
    const gltf = await gltfLoader.loadAsync(glbUrl);
    return gltf.scene;
}

export function disposePropAssetLoader() {
    dracoLoader?.dispose();
    gltfLoader = null;
    dracoLoader = null;
}
