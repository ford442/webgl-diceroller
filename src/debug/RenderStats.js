/**
 * Live debug HUD.
 *
 * Builds a small DOM panel (gated behind `?debug` / `?debug-perf` by the caller)
 * that surfaces the numbers devs and power users need to understand why a scene
 * is heavy: renderer backend, draw calls / triangles, GPU resource counts, a
 * cheap live scene-graph summary, physics status + die count, frame scheduler
 * phase timings, culling, collision rate and audio activity.
 *
 * Works identically on the WebGL and WebGPU paths — everything is read from
 * `renderer.info`, the `FrameScheduler` stats, and lightweight accessors passed
 * in by the caller.
 *
 * Cost control: `update()` is called every frame so the smoothed FPS stays
 * responsive, but the (relatively expensive) DOM rebuild and scene-graph
 * traversal are throttled to fixed intervals so the panel never causes jank.
 */

const DOM_INTERVAL_MS = 200;     // ~5 Hz text refresh
const TRAVERSE_INTERVAL_MS = 500; // ~2 Hz scene-graph summary
const SLOW_FRAME_MS = 50;         // < 20 fps — log when debug-perf is on
const SLOW_FRAME_LOG_COOLDOWN_MS = 1000;

function compact(n) {
    if (n == null) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return `${n}`;
}

function ms(value) {
    return (value ?? 0).toFixed(1);
}

export function createRenderStats({
    renderer,
    scene,
    scheduler,
    cullingSystem = null,
    getRendererState = () => null,
    getPost = () => null,
    getShadow = () => null,
    getDice = () => null,
    getWasm = () => null,
    getAudio = () => null,
    getCollisionTotal = () => 0,
    getTierRenderStats = () => null,
    debugPerf = false,
    visible = true
} = {}) {
    const container = document.getElementById('canvas-container') || document.body;
    const el = document.createElement('div');
    el.id = 'render-stats-hud';
    Object.assign(el.style, {
        position: 'absolute',
        top: '10px',
        right: '360px',
        backgroundColor: 'rgba(0, 0, 0, 0.62)',
        color: '#d7f7d0',
        fontFamily: 'monospace',
        fontSize: '11px',
        lineHeight: '1.45',
        padding: '8px 10px',
        borderRadius: '6px',
        zIndex: '1100',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        minWidth: '210px',
        textShadow: '0 1px 1px rgba(0,0,0,0.8)'
    });
    el.style.display = visible ? 'block' : 'none';
    container.appendChild(el);

    let frameMsSmoothed = 16.7;
    let lastDom = 0;
    let lastTraverse = 0;
    let lastSlowLog = 0;

    // Cached scene-graph summary (refreshed on the traverse interval).
    let sceneSummary = { objects: 0, meshes: 0, lights: 0, visibleMeshes: 0 };

    // Collision-rate tracking (events/sec, derived from a running total).
    let lastCollisionTotal = getCollisionTotal();
    let lastCollisionSampleAt = performance.now();
    let collisionRate = 0;

    function refreshSceneSummary() {
        let objects = 0;
        let meshes = 0;
        let lights = 0;
        let visibleMeshes = 0;
        scene?.traverse((obj) => {
            objects++;
            if (obj.isMesh) {
                meshes++;
                if (obj.visible) visibleMeshes++;
            } else if (obj.isLight) {
                lights++;
            }
        });
        sceneSummary = { objects, meshes, lights, visibleMeshes };
    }

    function buildText() {
        const info = renderer?.info ?? {};
        const render = info.render ?? {};
        const memory = info.memory ?? {};
        const programs = info.programs?.length ?? 0;

        const state = getRendererState();
        const post = getPost();
        const shadow = getShadow();
        const dice = getDice();
        const wasm = getWasm();
        const audio = getAudio();

        const lines = [];
        lines.push('DICE ROLLER · DEBUG');
        lines.push(`fps ${(1000 / frameMsSmoothed).toFixed(0)}  (${frameMsSmoothed.toFixed(1)} ms)`);

        const backend = state?.rendererType ?? 'unknown';
        const fallbackSuffix = state?.fallbackReason ? ' (fallback)' : '';
        const contextSuffix = state?.contextStatus === 'lost' ? ' · CONTEXT LOST' : '';
        lines.push(`renderer ${backend}${fallbackSuffix}${contextSuffix}`);

        if (state?.pixelRatio != null) {
            const msaa = state.antialias ? 'msaa' : (state.usePostAA ? 'fxaa' : 'no-aa');
            const forced = state.pixelRatioForced ? ' forced' : '';
            lines.push(`pixelRatio ${state.pixelRatio.toFixed(2)} (dpr ${state.deviceDpr?.toFixed(2) ?? '?'}) ${msaa}${forced}`);
        }
        if (state?.isSoftwareRenderer) {
            lines.push('software WebGL · low-post');
        }

        const physicsLabel = wasm ? (wasm.active ? 'WASM' : (wasm.available ? 'WASM(idle)' : 'ammo')) : 'ammo';
        const diceLabel = dice
            ? `${dice.count} dice${dice.count ? (dice.settled ? ' · settled' : ' · moving') : ''}`
            : '';
        lines.push(`physics ${physicsLabel}  ${diceLabel}`.trimEnd());
        if (debugPerf && wasm?.worker) {
            const w = wasm.worker;
            const sab = w.usingSAB ? 'sab-cmd' : 'batch-cmd';
            lines.push(`worker ${sab}  ${w.msgsPerSecond.toFixed(0)} msg/s`);
        }

        lines.push(`draws ${render.calls ?? 0}  tris ${compact(render.triangles)}`);
        lines.push(`geom ${memory.geometries ?? 0}  tex ${memory.textures ?? 0}  prog ${programs}`);

        const tierStats = getTierRenderStats();
        if (tierStats) {
            const tiers = tierStats.getAllTiers?.() ?? {};
            const tierParts = [];
            for (const [tierId, entry] of Object.entries(tiers)) {
                const d = entry.delta;
                if (!d) continue;
                tierParts.push(`${tierId}:+${d.drawCalls}`);
            }
            if (tierParts.length) {
                lines.push(`tier Δdraws ${tierParts.join('  ')}`);
            }
            const totals = tierStats.getTotals?.();
            if (totals?.current) {
                lines.push(`scene ${totals.current.drawCalls} draws  ${compact(totals.current.triangles)} tris`);
            }
        }

        lines.push(`objects ${sceneSummary.objects}  meshes ${sceneSummary.visibleMeshes}/${sceneSummary.meshes}  lights ${sceneSummary.lights}`);

        if (cullingSystem) {
            const cs = cullingSystem.stats;
            lines.push(`cull ${cullingSystem.enabled ? `${cs.culled}/${cs.total} hidden` : 'off'}`);
        }
        if (shadow) {
            lines.push(`shadows ${shadow.autoUpdate ? 'dynamic' : 'static'}  refresh ${shadow.staticRefreshes ?? 0}`);
        }
        if (post) {
            const fxaa = post.fxaaEnabled ? ' +fxaa' : '';
            lines.push(`post ${post.quality}${post.bloomEnabled ? ' +bloom' : ''}${fxaa}${post.chromaticAberrationEnabled ? ' +ca' : ''}`);
        }

        const audioLabel = audio ? `  audio ${audio.played}` : '';
        lines.push(`collisions ${collisionRate.toFixed(0)}/s${audioLabel}`);

        const gameFeel = scheduler?.stats?.gameFeel;
        if (gameFeel) {
            lines.push(`feel px ${gameFeel.activeParticles}  blur ${gameFeel.motionBlurDice}  crit ${gameFeel.critCount}`);
        }

        if (debugPerf && scheduler?.stats?.phaseTimes) {
            const pt = scheduler.stats.phaseTimes;
            lines.push('— phases (ms) —');
            lines.push(`pre ${ms(pt.preStep)}  phys ${ms(pt.physicsStep)}  upd ${ms(pt.updates)}`);
            lines.push(`preR ${ms(pt.preRender)}  render ${ms(pt.render)}  postR ${ms(pt.postRender)}`);
            lines.push(`steps ${scheduler.stats.physicsSteps}`);
        }

        return lines.join('\n');
    }

    function update({ deltaTime = 0 } = {}) {
        // Cheap every-frame work: keep the smoothed frame time responsive.
        const frameMs = deltaTime * 1000;
        if (frameMs > 0) {
            frameMsSmoothed = frameMsSmoothed + (frameMs - frameMsSmoothed) * 0.1;
        }

        const now = performance.now();

        if (debugPerf && frameMs > SLOW_FRAME_MS && (now - lastSlowLog) > SLOW_FRAME_LOG_COOLDOWN_MS) {
            lastSlowLog = now;
            console.warn(`[RenderStats] Slow frame: ${frameMs.toFixed(1)}ms (${(1000 / frameMs).toFixed(0)} fps)`);
        }

        if (el.style.display === 'none') return;

        // Throttled collision-rate sample.
        if ((now - lastCollisionSampleAt) >= DOM_INTERVAL_MS) {
            const total = getCollisionTotal();
            const dt = (now - lastCollisionSampleAt) / 1000;
            collisionRate = dt > 0 ? (total - lastCollisionTotal) / dt : 0;
            lastCollisionTotal = total;
            lastCollisionSampleAt = now;
        }

        // Throttled scene-graph traversal.
        if ((now - lastTraverse) >= TRAVERSE_INTERVAL_MS) {
            lastTraverse = now;
            refreshSceneSummary();
        }

        // Throttled DOM rebuild.
        if ((now - lastDom) >= DOM_INTERVAL_MS) {
            lastDom = now;
            el.textContent = buildText();
        }
    }

    function setVisible(next) {
        el.style.display = next ? 'block' : 'none';
    }

    function toggle() {
        setVisible(el.style.display === 'none');
        return el.style.display !== 'none';
    }

    function dispose() {
        el.remove();
    }

    return { el, update, setVisible, toggle, dispose };
}
