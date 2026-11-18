import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { ComposerLike, RendererState } from '../types/app';
import { CONTEXT_PROFILES, resolveProfileAntialias } from './ContextProfile.js';

const DEFAULT_PIXEL_RATIO_CAP = 2;
const FRAME_BUDGET_MS = 32; // ~30 fps — step down when sustained above this
const SLOW_FRAME_STREAK = 90; // ~1.5 s of slow frames before stepping down

export interface PixelRatioConfig {
    pixelRatio: number;
    forced: boolean;
    cap: number;
    deviceDpr: number;
}

/**
 * Resolve the render pixel ratio from URL flags and device DPR.
 * `?pr=1` forces 1.0 (MSAA path); `?pr=N` caps at N (clamped to [0.5, 3]).
 */
export function resolvePixelRatioConfig(
    searchParams: URLSearchParams = new URLSearchParams(window.location.search)
): PixelRatioConfig {
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (searchParams.has('pr')) {
        const forced = Number.parseFloat(searchParams.get('pr') ?? '');
        if (Number.isFinite(forced) && forced > 0) {
            const clamped = Math.min(Math.max(forced, 0.5), 3);
            return {
                pixelRatio: clamped,
                forced: true,
                cap: clamped,
                deviceDpr,
            };
        }
    }

    const cap = Math.min(deviceDpr, DEFAULT_PIXEL_RATIO_CAP);
    return {
        pixelRatio: cap,
        forced: false,
        cap,
        deviceDpr,
    };
}

/** MSAA is cheap at DPR 1; at higher DPR rely on post FXAA instead (the desktop profile rule). */
export function resolveAntialias(pixelRatio: number): boolean {
    return resolveProfileAntialias(CONTEXT_PROFILES.desktop, pixelRatio);
}

export function applyRendererSize(
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    width: number,
    height: number,
    pixelRatio: number
): void {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
}

/** Keep WebGL EffectComposer render targets aligned with renderer DPR. */
export function syncComposerPixelRatio(
    composer: ComposerLike | EffectComposer | null | undefined,
    width: number,
    height: number,
    pixelRatio: number
): void {
    if (!composer) return;
    if (typeof composer.setPixelRatio === 'function') {
        composer.setPixelRatio(pixelRatio);
        return;
    }
    composer.setSize?.(width, height);
}

export interface PixelRatioMonitorOptions {
    onPixelRatioChange?: (ratio: number) => void;
    debugPerf?: boolean;
}

export interface PixelRatioMonitor {
    update: (frame?: { deltaTime?: number }) => void;
    readonly steppedDown: boolean;
}

/**
 * Lightweight frame-time monitor that steps pixel ratio down when sustained
 * frame times exceed the budget. Disabled when `?pr=` forces a ratio.
 */
export function createPixelRatioMonitor(
    rendererState: RendererState,
    { onPixelRatioChange, debugPerf = false }: PixelRatioMonitorOptions = {}
): PixelRatioMonitor {
    let frameMsSmoothed = 16.7;
    let slowFrameStreak = 0;
    let steppedDown = false;

    function update({ deltaTime = 0 }: { deltaTime?: number } = {}): void {
        if (rendererState.pixelRatioForced || (rendererState.pixelRatio ?? 1) <= 1) {
            return;
        }

        const frameMs = deltaTime * 1000;
        if (frameMs <= 0) return;

        frameMsSmoothed += (frameMs - frameMsSmoothed) * 0.08;

        if (frameMsSmoothed > FRAME_BUDGET_MS) {
            slowFrameStreak += 1;
        } else {
            slowFrameStreak = Math.max(0, slowFrameStreak - 2);
        }

        if (slowFrameStreak < SLOW_FRAME_STREAK) return;

        slowFrameStreak = 0;
        const current = rendererState.pixelRatio ?? 1;
        const next = current <= 1.25 ? 1 : Math.max(1, Math.round((current - 0.5) * 2) / 2);

        if (next >= current) return;

        steppedDown = true;
        rendererState.pixelRatio = next;
        rendererState.usePostAA = !rendererState.antialias && next > 1;
        onPixelRatioChange?.(next);

        if (debugPerf) {
            console.info(
                `[RendererFactory] Pixel ratio stepped down to ${next} (smoothed ${frameMsSmoothed.toFixed(1)} ms)`
            );
        }
    }

    return {
        update,
        get steppedDown() {
            return steppedDown;
        },
    };
}
