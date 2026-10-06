/**
 * Synthesised tavern audio: dice collisions, prop-impact accents, a subtle
 * ambient room bed and the flute hook. Everything is generated in code — no
 * external audio assets are downloaded.
 *
 * This module is the main-thread façade. Synthesis runs in an AudioWorklet
 * (`worklet/TavernProcessor.ts` around the pure `worklet/tavernDsp.ts` engine):
 * the façade only filters events (energy floor, per-pair cooldown), picks a
 * spatial slot and posts a small message. The node graph is built once:
 *
 *   worklet ─┬─ out 0 (stereo: ambient, flute, non-positional) ─────────┐
 *            └─ out 1..N (mono) → HRTF PannerNode slot ×N (hrtf mode) ──┤
 *                                                                        ▼
 *                    mix ─┬─────────────────────────────── dry ─→ master → destination
 *                         └→ send → ConvolverNode (generated room IR) ─↗
 *
 * Pan modes: `hrtf` (desktop default) routes each voice through a
 * pre-allocated HRTF `PannerNode` following the camera `AudioListener`;
 * `stereo` (mobile/xr quality profiles, `?audio-pan=stereo`, and the
 * fallback) pans inside the engine from listener messages, so no panner runs.
 *
 * When `AudioWorklet` is missing (insecure context, very old Safari) or fails
 * to load, the same engine runs in a `ScriptProcessorNode` on the main thread
 * (`?audio-fallback` forces this) — degraded, but still fixed-size and silent
 * on failure rather than throwing.
 */
import * as THREE from 'three';
import tavernProcessorUrl from './worklet/TavernProcessor.ts?worker&url';
import { generateRoomImpulse } from './roomImpulse.js';
import { getDeviceSession } from '../core/DeviceSession.js';
import { TAVERN_PROCESSOR_NAME, VOICE_HOLD_SECONDS } from './worklet/protocol.js';
import type { EngineStats, PanMode, TavernMessage } from './worklet/tavernDsp.js';

const DEFAULTS = {
    maxVoices: 6,
    /** `maxVoices` under the mobile / xr quality profiles. */
    lowCostMaxVoices: 4,
    cooldownMs: 45,
    energyForMaxVolume: 50,
    minAudibleEnergy: 0.18,
    masterScale: 0.3,
    defaultVolume: 0.6,
    reverbSend: 0.22,
    lampJiggleRadius: 6,
    lampJiggleMinSpeed: 3.5,
};

const STORAGE_VOLUME = 'tavernAudio.volume';
const STORAGE_MUTED = 'tavernAudio.muted';

const LOW_COST_PROFILES = new Set(['mobile', 'xr']);

type SynthKind = 'pending' | 'worklet' | 'script-processor' | 'none';

function clamp(value: any, min: any, max: any) {
    return Math.min(max, Math.max(min, value));
}

function readStoredVolume(fallback: any) {
    try {
        const raw = localStorage.getItem(STORAGE_VOLUME);
        if (raw == null) return fallback;
        const v = parseFloat(raw);
        return Number.isFinite(v) ? clamp(v, 0, 1) : fallback;
    } catch {
        return fallback;
    }
}

function readStoredMuted() {
    try {
        return localStorage.getItem(STORAGE_MUTED) === '1';
    } catch {
        return false;
    }
}

function searchParams() {
    try {
        return new URLSearchParams(window.location.search);
    } catch {
        return new URLSearchParams();
    }
}

let activeInstance: any = null;

/** Play a one-off prop-impact accent (gong, skull, lamp, heavy drops). */
export const playPropImpact = (opts: any) => activeInstance?.playImpact(opts);

/** Adjust ambient loudness multiplier (e.g. louder in FPS/pointer-lock mode). */
export const setAmbientIntensity = (value: any) => activeInstance?.setAmbientIntensity(value);

/** Play a short flute melody (defaults to a pleasant built-in phrase). */
export const playFluteMelody = (notes: any) => activeInstance?.playMelody(notes);

function collisionPairKey(idA: any, idB: any) {
    const a = idA < 0 ? 'table' : idA;
    const b = idB < 0 ? 'table' : idB;
    return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

export function selectVoice(event: any) {
    const a = event.surface ?? 'die';
    const b = event.otherSurface ?? (event.idB === -1 ? 'velvet' : 'die');
    if (a === 'metal' || b === 'metal') return 'metal';
    if (a === 'glass' || b === 'glass') return 'glass';
    if (a === 'velvet' || b === 'velvet') return 'velvet';
    if (a === 'table' || b === 'table' || a === 'wood' || b === 'wood') return 'wood';
    if (a === 'leather' || b === 'leather') return 'leather';
    return 'clack';
}

export function createDiceCollisionAudio(options: any = {}) {
    const { contextOptions = getDeviceSession().audio, ...overrides } = options;
    const config = { ...DEFAULTS, ...overrides };
    const params = searchParams();
    const isTest = params.has('test');

    let audioContext: any = null;
    let masterGain: any = null;
    let mixBus: any = null;
    let reverbSend: any = null;
    let convolver: any = null;
    let playedCount = 0;

    let synth: SynthKind = 'none';
    let panMode: PanMode = 'hrtf';
    let post: ((msg: TavernMessage) => void) | null = null;
    let panners: any[] = [];
    let workletStats: EngineStats | null = null;
    let lastError: string | null = null;

    /** Estimated audio-clock end time of each voice started (main-side cap + slot pick). */
    let voiceEnds: number[] = [];
    let slotFreeAt: number[] = [];

    const pairCooldowns = new Map();

    let userVolume = readStoredVolume(config.defaultVolume);
    let muted = readStoredMuted();

    let ambientStarted = false;
    let ambientIntensity = 0.5;

    let qualityProfileId: string | null = null;
    let maxVoices = config.maxVoices;
    const reverbEnabled = !params.has('no-reverb');

    let lampData: any = null;
    const _listenerForward = new THREE.Vector3();
    const _listenerUp = new THREE.Vector3();
    const _lampPos = new THREE.Vector3();
    const _lastListener = new Float64Array(9).fill(NaN);

    function effectiveGain() {
        return (muted ? 0 : userVolume) * config.masterScale;
    }

    function isLowCost() {
        return qualityProfileId != null && LOW_COST_PROFILES.has(qualityProfileId);
    }

    function choosePanMode(): PanMode {
        const forced = params.get('audio-pan');
        if (forced === 'stereo' || forced === 'hrtf') return forced;
        return isLowCost() ? 'stereo' : 'hrtf';
    }

    /**
     * Ask for the session's options (48 kHz, `interactive`). A browser that
     * rejects the rate (NotSupportedError) or the options bag entirely (old
     * `webkitAudioContext`) gets progressively plainer requests. Everything
     * downstream — worklet `processorOptions.sampleRate`, the biquads, and
     * `generateRoomImpulse` — reads `audioContext.sampleRate`, so a fallback
     * rate stays self-consistent; it just isn't the 48 kHz `?test` captures pin.
     */
    function createAudioContext(Ctx: any) {
        const attempts = [
            { latencyHint: contextOptions.latencyHint, sampleRate: contextOptions.sampleRate },
            { latencyHint: contextOptions.latencyHint },
            undefined,
        ];
        for (const attempt of attempts) {
            try {
                return attempt ? new Ctx(attempt) : new Ctx();
            } catch (err) {
                lastError = String(err);
            }
        }
        return null;
    }

    function ensureContext() {
        if (audioContext) return audioContext;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;

        audioContext = createAudioContext(Ctx);
        if (!audioContext) return null;
        masterGain = audioContext.createGain();
        masterGain.gain.value = effectiveGain();
        masterGain.connect(audioContext.destination);

        mixBus = audioContext.createGain();
        mixBus.connect(masterGain);
        applyReverb();

        synth = 'pending';
        void initSynth();
        return audioContext;
    }

    /** Build (lazily) or mute the convolution send for the current profile. */
    function applyReverb() {
        if (!audioContext || !mixBus) return;
        const want = reverbEnabled && !isLowCost();
        if (want && !convolver) {
            try {
                const [left, right] = generateRoomImpulse(audioContext.sampleRate);
                const buffer = audioContext.createBuffer(2, left.length, audioContext.sampleRate);
                buffer.copyToChannel(left, 0);
                buffer.copyToChannel(right, 1);
                convolver = audioContext.createConvolver();
                convolver.buffer = buffer;
                reverbSend = audioContext.createGain();
                reverbSend.gain.value = 0;
                mixBus.connect(reverbSend);
                reverbSend.connect(convolver);
                convolver.connect(masterGain);
            } catch (err) {
                lastError = String(err);
                convolver = null;
                reverbSend = null;
                return;
            }
        }
        if (reverbSend) {
            reverbSend.gain.setTargetAtTime(
                want ? config.reverbSend : 0,
                audioContext.currentTime,
                0.05
            );
        }
    }

    function engineOptions(slots: number) {
        return {
            sampleRate: audioContext.sampleRate,
            panMode,
            slots,
            maxVoices,
            energyForMaxVolume: config.energyForMaxVolume,
            // Deterministic noise/jitter under ?test so captures are repeatable.
            seed: isTest ? 0x5eed : (Math.random() * 0xffffffff) >>> 0,
        };
    }

    function onSynthReady() {
        post?.({ type: 'ambient', intensity: ambientIntensity });
        if (ambientStarted) post?.({ type: 'ambient', on: true });
        _lastListener.fill(NaN);
    }

    async function initWorklet(): Promise<boolean> {
        const ctx = audioContext;
        if (!ctx.audioWorklet || typeof window.AudioWorkletNode !== 'function') return false;
        await ctx.audioWorklet.addModule(tavernProcessorUrl);

        panMode = choosePanMode();
        const slots = panMode === 'hrtf' ? config.maxVoices : 0;
        const created: any[] = [];
        if (slots > 0) {
            try {
                for (let i = 0; i < slots; i++) {
                    const p = ctx.createPanner();
                    p.panningModel = 'HRTF';
                    p.distanceModel = 'inverse';
                    p.refDistance = 1.5;
                    p.maxDistance = 22;
                    p.rolloffFactor = 1.2;
                    created.push(p);
                }
            } catch (err) {
                // HRTF panners unavailable: pan in the engine instead.
                console.warn('[Audio] HRTF panners unavailable, using stereo pan.', err);
                for (const p of created) p.disconnect?.();
                created.length = 0;
                panMode = 'stereo';
            }
        }
        const outputs = 1 + created.length;
        const node = new window.AudioWorkletNode(ctx, TAVERN_PROCESSOR_NAME, {
            numberOfInputs: 0,
            numberOfOutputs: outputs,
            outputChannelCount: [2, ...created.map(() => 1)],
            processorOptions: engineOptions(created.length),
        });
        node.port.onmessage = (e: MessageEvent) => {
            if (e.data?.type === 'stats') workletStats = e.data.stats;
        };
        node.onprocessorerror = () => {
            lastError = 'processorerror';
            synth = 'none';
            post = null;
        };
        node.connect(mixBus, 0);
        created.forEach((p, i) => {
            node.connect(p, i + 1);
            p.connect(mixBus);
        });
        panners = created;
        slotFreeAt = created.map(() => 0);
        post = (msg) => node.port.postMessage(msg);
        synth = 'worklet';
        return true;
    }

    async function initScriptProcessor(): Promise<boolean> {
        const ctx = audioContext;
        if (typeof ctx.createScriptProcessor !== 'function') return false;
        const { TavernDspEngine } = await import('./worklet/tavernDsp.js');
        panMode = 'stereo';
        const engine = new TavernDspEngine(engineOptions(0));
        const node = ctx.createScriptProcessor(1024, 0, 2);
        const L = new Float32Array(1024);
        const R = new Float32Array(1024);
        node.onaudioprocess = (e: any) => {
            engine.render([[L, R]]);
            e.outputBuffer.copyToChannel(L, 0);
            e.outputBuffer.copyToChannel(R, 1);
            if (engine.statsDirty) {
                engine.statsDirty = false;
                workletStats = engine.stats();
            }
        };
        node.connect(mixBus);
        post = (msg) => engine.handleMessage(msg);
        synth = 'script-processor';
        return true;
    }

    async function initSynth() {
        const forceFallback = params.has('audio-fallback');
        try {
            if (!forceFallback && (await initWorklet())) return onSynthReady();
        } catch (err) {
            lastError = String(err);
            console.warn('[Audio] AudioWorklet unavailable, falling back to ScriptProcessor.', err);
        }
        try {
            if (await initScriptProcessor()) return onSynthReady();
        } catch (err) {
            lastError = String(err);
            console.warn('[Audio] Synth fallback failed; audio disabled.', err);
        }
        synth = 'none';
    }

    function resume() {
        const ctx = ensureContext();
        if (!ctx) return;
        try {
            if (ctx.state === 'suspended') {
                Promise.resolve(ctx.resume())
                    .then(startAmbient)
                    .catch(() => {});
            } else if (ctx.state === 'running') {
                startAmbient();
            }
        } catch {
            // Some browsers throw synchronously outside a gesture; the next gesture retries.
        }
    }

    function canPlay() {
        const ctx = ensureContext();
        return !!ctx && ctx.state === 'running' && post != null;
    }

    function activeEstimate(now: number) {
        if (voiceEnds.length) voiceEnds = voiceEnds.filter((t) => t > now);
        return voiceEnds.length;
    }

    /**
     * Reserve a voice (main-side estimate; the processor enforces the real cap)
     * and aim a panner slot at `position`. Returns the slot, -1 for the direct
     * bus, or null when the voice budget is spent.
     */
    function reserveVoice(holdSec: number, position: any): number | null {
        const now = audioContext.currentTime;
        if (activeEstimate(now) >= maxVoices) return null;
        voiceEnds.push(now + holdSec);
        if (!position || panMode !== 'hrtf' || !panners.length) return -1;

        let slot = 0;
        for (let i = 1; i < slotFreeAt.length; i++) {
            if (slotFreeAt[i]! < slotFreeAt[slot]!) slot = i;
        }
        slotFreeAt[slot] = now + holdSec;
        const p = panners[slot];
        p.positionX.setValueAtTime(position.x, now);
        p.positionY.setValueAtTime(position.y, now);
        p.positionZ.setValueAtTime(position.z, now);
        return slot;
    }

    function plainPosition(position: any) {
        return position ? { x: position.x, y: position.y, z: position.z } : null;
    }

    function updateListener(camera: any) {
        const ctx = audioContext;
        if (!ctx || !camera || ctx.state !== 'running') return;

        camera.getWorldDirection(_listenerForward);
        _listenerUp.copy(camera.up);
        const p = camera.position;
        const f = _listenerForward;
        const u = _listenerUp;
        const values = [p.x, p.y, p.z, f.x, f.y, f.z, u.x, u.y, u.z];
        let changed = false;
        for (let i = 0; i < 9; i++) {
            if (!(Math.abs(values[i]! - _lastListener[i]!) < 1e-4)) {
                changed = true;
                _lastListener[i] = values[i]!;
            }
        }
        if (!changed) return;

        if (panMode === 'stereo') {
            post?.({
                type: 'listener',
                position: { x: p.x, y: p.y, z: p.z },
                forward: { x: f.x, y: f.y, z: f.z },
                up: { x: u.x, y: u.y, z: u.z },
            });
            return;
        }

        const listener = ctx.listener;
        const t = ctx.currentTime;
        listener.positionX.setTargetAtTime(p.x, t, 0.05);
        listener.positionY.setTargetAtTime(p.y, t, 0.05);
        listener.positionZ.setTargetAtTime(p.z, t, 0.05);
        listener.forwardX.setTargetAtTime(f.x, t, 0.05);
        listener.forwardY.setTargetAtTime(f.y, t, 0.05);
        listener.forwardZ.setTargetAtTime(f.z, t, 0.05);
        listener.upX.setTargetAtTime(u.x, t, 0.05);
        listener.upY.setTargetAtTime(u.y, t, 0.05);
        listener.upZ.setTargetAtTime(u.z, t, 0.05);
    }

    function handleCollisionEvent(event: any) {
        if (!canPlay()) return;

        const mass = event.mass ?? 5;
        const linearSpeedSq = event.linearSpeedSq ?? (event.impactSpeed ?? 0) ** 2;
        const angularSpeedSq = event.angularSpeedSq ?? 0;
        const inertiaScalar = event.inertiaScalar ?? 0;
        const totalKE = 0.5 * mass * linearSpeedSq + 0.5 * inertiaScalar * angularSpeedSq;
        if (totalKE < config.minAudibleEnergy) return;

        const nowMs = performance.now();
        const pairKey = collisionPairKey(event.idA ?? -1, event.idB ?? -1);
        const lastAt = pairCooldowns.get(pairKey) ?? 0;
        if (nowMs - lastAt < config.cooldownMs) return;
        pairCooldowns.set(pairKey, nowMs);

        const voice = selectVoice(event);
        const position = plainPosition(event.position);
        const slot = reserveVoice(VOICE_HOLD_SECONDS[voice] ?? 0.15, position);
        if (slot == null) return;

        playedCount += 1;
        post!({
            type: 'impact',
            voice,
            energy: totalKE,
            mass,
            sides: event.sides ?? null,
            slot,
            position,
        });
    }

    function playImpact({
        surface = 'metal',
        volume = 0.6,
        pitch = 1,
        decay = null,
        position = null,
    }: any = {}) {
        if (!canPlay()) return;
        const hold = Math.max(VOICE_HOLD_SECONDS[surface] ?? 0.65, (decay ?? 0) + 0.05);
        const pos = plainPosition(position);
        const slot = reserveVoice(hold, pos);
        if (slot == null) return;
        post!({ type: 'prop', surface, volume, pitch, decay, slot, position: pos });
    }

    function checkCollisionPropReactions(event: any) {
        if (!lampData?.triggerJiggle || !event?.position) return;
        const speed = event.impactSpeed ?? Math.sqrt(event.linearSpeedSq ?? 0);
        if (speed < config.lampJiggleMinSpeed) return;

        const lampGroup = lampData.group;
        if (!lampGroup) return;
        lampGroup.getWorldPosition(_lampPos);
        const dx = event.position.x - _lampPos.x;
        const dy = event.position.y - _lampPos.y;
        const dz = event.position.z - _lampPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > config.lampJiggleRadius * config.lampJiggleRadius) return;

        const intensity = clamp(speed / 12, 0.2, 1);
        lampData.triggerJiggle(intensity);
        playImpact({
            surface: 'click',
            volume: 0.12 + intensity * 0.08,
            position: { x: _lampPos.x, y: _lampPos.y, z: _lampPos.z },
        });
    }

    function setLampData(data: any) {
        lampData = data ?? null;
    }

    function playMelody(notes: any) {
        if (!canPlay()) return false;
        const tune = Array.isArray(notes)
            ? notes.map((n: any) => ({ f: n?.f, d: n?.d, vol: n?.vol }))
            : null;
        post!({ type: 'melody', notes: tune });
        return true;
    }

    function startAmbient() {
        if (ambientStarted) return;
        if (!audioContext || audioContext.state !== 'running') return;
        ambientStarted = true;
        post?.({ type: 'ambient', on: true });
    }

    function applyAmbientIntensity(value: any) {
        ambientIntensity = clamp(value, 0, 1.5);
        post?.({ type: 'ambient', intensity: ambientIntensity });
    }

    /**
     * Apply an AdaptiveQuality profile id (`high` / `medium` / `mobile` / `xr`).
     * Low-cost profiles drop `maxVoices` and the convolution send; the pan mode
     * is fixed once the context exists, so it only follows the profile known at
     * first audio unlock.
     */
    function setQualityProfile(profileId: any) {
        qualityProfileId = typeof profileId === 'string' ? profileId : null;
        maxVoices = isLowCost()
            ? Math.min(config.maxVoices, config.lowCostMaxVoices)
            : config.maxVoices;
        post?.({ type: 'config', maxVoices });
        applyReverb();
    }

    function applyMasterGain(immediate: any = false) {
        if (!masterGain || !audioContext) return;
        const target = effectiveGain();
        if (immediate) masterGain.gain.value = target;
        else masterGain.gain.setTargetAtTime(target, audioContext.currentTime, 0.02);
    }

    function setMasterVolume(value: any) {
        userVolume = clamp(value, 0, 1);
        try {
            localStorage.setItem(STORAGE_VOLUME, String(userVolume));
        } catch {}
        applyMasterGain();
    }

    function setMuted(value: any) {
        muted = !!value;
        try {
            localStorage.setItem(STORAGE_MUTED, muted ? '1' : '0');
        } catch {}
        applyMasterGain();
    }

    const api = {
        resume,
        handleCollisionEvent,
        checkCollisionPropReactions,
        playImpact,
        playMelody,
        setAmbientIntensity: applyAmbientIntensity,
        setQualityProfile,
        setMasterVolume,
        getMasterVolume: () => userVolume,
        setMuted,
        toggleMute: () => {
            setMuted(!muted);
            return muted;
        },
        isMuted: () => muted,
        updateListener,
        setLampData,
        getStats: () => ({
            played: playedCount,
            activeVoices:
                workletStats?.active ??
                (audioContext ? activeEstimate(audioContext.currentTime) : 0),
            maxVoices,
            volume: userVolume,
            muted,
            synth,
            panMode,
            reverb: !!reverbSend && reverbEnabled && !isLowCost(),
            engine: workletStats,
            error: lastError,
            sampleRate: audioContext?.sampleRate ?? null,
            requestedSampleRate: contextOptions.sampleRate,
            latencyHint: contextOptions.latencyHint,
            baseLatency: audioContext?.baseLatency ?? null,
        }),
    };
    activeInstance = api;
    return api;
}
