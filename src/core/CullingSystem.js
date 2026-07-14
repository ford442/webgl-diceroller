import * as THREE from 'three';

/**
 * Names of prop roots that must never be frustum-culled. These are interactive
 * or gameplay-critical objects where an off-screen frame should not pop them out
 * of the scene graph (and which the camera focus state machine may snap to).
 *
 * Dice meshes are added to the scene directly (not registered here) and so are
 * never culled by this system.
 */
const NEVER_CULL_NAMES = new Set([
    'SkullProp',   // Skull (interactive)
    'Gong',        // Gong (interactive)
    'BilliardLamp' // Hanging lamp (interactive, also the key light source)
]);

function subtreeHasLight(root) {
    let found = false;
    root.traverse((child) => {
        if (child.isLight) found = true;
    });
    return found;
}

/**
 * Group-level frustum culling pass.
 *
 * Three.js already frustum-culls individual meshes at draw time, but it still
 * walks the entire scene graph each frame (updating world matrices and testing
 * every mesh). By toggling `.visible` on whole prop roots we let the renderer
 * skip those subtrees during `projectObject`, cutting scene-traversal cost when
 * the camera is in a normal, table-focused position and most background clutter
 * is off-screen.
 *
 * Frustum-only: a prop is hidden purely based on whether its (padded) bounding
 * sphere intersects the camera frustum. No distance-based LOD, so there is no
 * popping for anything the camera is actually looking at.
 */
export class CullingSystem {
    constructor({ enabled = true } = {}) {
        this.enabled = enabled;
        /** @type {{ root: THREE.Object3D, sphere: THREE.Sphere, important: boolean, ready: boolean }[]} */
        this.entries = [];
        this.byRoot = new Map();
        this.frustum = new THREE.Frustum();
        this.projScreenMatrix = new THREE.Matrix4();
        this._box = new THREE.Box3();
        this.stats = { total: 0, visible: 0, culled: 0, enabled };
    }

    /**
     * Register a prop root for culling. Roots named in NEVER_CULL_NAMES (or passed
     * `important: true`) are kept always-visible. The bounding sphere is computed
     * lazily on the first cull frame so callers don't need world matrices ready.
     */
    register(root, { important } = {}) {
        if (!root || !root.isObject3D || this.byRoot.has(root)) return null;
        // A subtree that owns a light must never be hidden: toggling `.visible`
        // would also remove the light's contribution to on-screen objects.
        const isImportant = important === true
            || NEVER_CULL_NAMES.has(root.name)
            || subtreeHasLight(root);
        const entry = { root, sphere: new THREE.Sphere(), important: isImportant, ready: false };
        this.entries.push(entry);
        this.byRoot.set(root, entry);
        return entry;
    }

    unregister(root) {
        const entry = this.byRoot.get(root);
        if (!entry) return;
        this.byRoot.delete(root);
        const index = this.entries.indexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
        // Leave the object visible when it stops being managed.
        if (root) root.visible = true;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.stats.enabled = enabled;
        if (!enabled) {
            for (const entry of this.entries) entry.root.visible = true;
        }
    }

    _ensureSphere(entry) {
        entry.root.updateWorldMatrix(true, true);
        this._box.setFromObject(entry.root);
        if (this._box.isEmpty()) {
            // InstancedMesh roots may need an explicit bounds pass before culling.
            entry.root.traverse((child) => {
                if (child.isInstancedMesh && child.geometry && !child.geometry.boundingSphere) {
                    child.geometry.computeBoundingSphere();
                }
            });
            this._box.setFromObject(entry.root);
        }
        if (this._box.isEmpty()) {
            entry.ready = false;
            return;
        }
        this._box.getBoundingSphere(entry.sphere);
        // Pad the radius so small per-frame animation (bobbing candles, gentle
        // spins) never clips the sphere out of view a frame early.
        entry.sphere.radius *= 1.2;
        entry.ready = true;
    }

    /** Recompute the bounding sphere after static mesh merges or instancing updates. */
    refreshSphere(root) {
        const entry = this.byRoot.get(root);
        if (!entry) return;
        entry.ready = false;
        this._ensureSphere(entry);
    }

    /**
     * Run the cull. Call once per frame in `preRender`, after the camera has been
     * updated for this frame.
     */
    update(camera) {
        this.stats.total = this.entries.length;

        if (!this.enabled) {
            this.stats.visible = this.entries.length;
            this.stats.culled = 0;
            return;
        }

        camera.updateMatrixWorld();
        this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

        let visible = 0;
        let culled = 0;
        for (const entry of this.entries) {
            if (entry.important) {
                entry.root.visible = true;
                visible++;
                continue;
            }
            if (!entry.ready) this._ensureSphere(entry);
            // Props with no renderable geometry yet stay visible (fail-open).
            const inView = !entry.ready || this.frustum.intersectsSphere(entry.sphere);
            entry.root.visible = inView;
            if (inView) visible++;
            else culled++;
        }

        this.stats.visible = visible;
        this.stats.culled = culled;
    }
}

export const createCullingSystem = (options) => new CullingSystem(options);
