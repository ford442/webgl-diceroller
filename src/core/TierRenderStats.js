/**
 * Scene-graph draw-call / triangle accounting per loading tier.
 *
 * Snapshots before and after each tier spawn so RenderStats can show the
 * marginal cost of tier0–tier3 without relying on renderer.info (which resets
 * every frame).
 */

function countMeshStats(scene) {
    let meshes = 0;
    let visibleMeshes = 0;
    let drawCalls = 0;
    let triangles = 0;
    let instancedMeshes = 0;

    scene?.traverse((obj) => {
        if (obj.isMesh) {
            meshes++;
            if (!obj.visible) return;
            visibleMeshes++;

            if (obj.isInstancedMesh) {
                instancedMeshes++;
                drawCalls += 1;
                const geo = obj.geometry;
                const instanceCount = obj.count ?? 1;
                let trisPerInstance = 0;
                if (geo?.index) trisPerInstance = geo.index.count / 3;
                else if (geo?.attributes?.position) trisPerInstance = geo.attributes.position.count / 3;
                triangles += trisPerInstance * instanceCount;
                return;
            }

            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            drawCalls += materials.filter(Boolean).length;

            const geo = obj.geometry;
            if (!geo) return;
            if (geo.index) {
                triangles += geo.index.count / 3;
            } else if (geo.attributes?.position) {
                triangles += geo.attributes.position.count / 3;
            }
        }
    });

    return { meshes, visibleMeshes, drawCalls, triangles, instancedMeshes };
}

function diffStats(after, before) {
    return {
        meshes: after.meshes - before.meshes,
        visibleMeshes: after.visibleMeshes - before.visibleMeshes,
        drawCalls: after.drawCalls - before.drawCalls,
        triangles: after.triangles - before.triangles,
        instancedMeshes: after.instancedMeshes - before.instancedMeshes
    };
}

export function createTierRenderStats(scene) {
    /** @type {Record<string, { before: object, after?: object, delta?: object }>} */
    const tiers = {};
    let baseline = countMeshStats(scene);

    return {
        snapshotBefore(tierId) {
            tiers[tierId] = { before: countMeshStats(scene) };
        },

        snapshotAfter(tierId) {
            const entry = tiers[tierId];
            if (!entry) return null;
            const after = countMeshStats(scene);
            entry.after = after;
            entry.delta = diffStats(after, entry.before);
            return entry.delta;
        },

        getTier(tierId) {
            return tiers[tierId] ?? null;
        },

        getAllTiers() {
            return { ...tiers };
        },

        getTotals() {
            const current = countMeshStats(scene);
            return {
                baseline,
                current,
                delta: diffStats(current, baseline)
            };
        },

        formatSummary() {
            const lines = [];
            for (const [tierId, entry] of Object.entries(tiers)) {
                const d = entry.delta;
                if (!d) continue;
                lines.push(
                    `${tierId}: +${d.drawCalls} draws  +${Math.round(d.triangles)} tris  (+${d.meshes} meshes)`
                );
            }
            const totals = this.getTotals();
            lines.push(
                `total: ${totals.current.drawCalls} draws  ${Math.round(totals.current.triangles)} tris`
            );
            return lines.join('\n');
        }
    };
}
