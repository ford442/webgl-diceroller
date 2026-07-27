/**
 * Synthesised tavern audio: dice collisions, prop-impact accents, and a subtle
 * ambient room bed. Everything is generated with the Web Audio API — no external
 * audio assets are downloaded.
 *
 * Impacts are routed through HRTF PannerNodes at world positions; the listener
 * follows the camera each frame.
 */
import * as THREE from 'three';

const DEFAULTS = {
    maxVoices: 6,
    cooldownMs: 45,
    energyForMaxVolume: 50,
    minAudibleEnergy: 0.18,
    masterScale: 0.3,
    defaultVolume: 0.6,
    lampJiggleRadius: 6,
    lampJiggleMinSpeed: 3.5,
};

const STORAGE_VOLUME = 'tavernAudio.volume';
const STORAGE_MUTED = 'tavernAudio.muted';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function readStoredVolume(fallback) {
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

let activeInstance = null;

/** Play a one-off prop-impact accent (gong, skull, lamp, heavy drops). */
export const playPropImpact = (opts) => activeInstance?.playImpact(opts);

/** Adjust ambient loudness multiplier (e.g. louder in FPS/pointer-lock mode). */
export const setAmbientIntensity = (value) => activeInstance?.setAmbientIntensity(value);

/** Play a short flute melody (defaults to a pleasant built-in phrase). */
export const playFluteMelody = (notes) => activeInstance?.playMelody(notes);

const DEFAULT_FLUTE_TUNE = [
    { f: 587.33, d: 0.18 },
    { f: 659.25, d: 0.18 },
    { f: 783.99, d: 0.18 },
    { f: 880.0, d: 0.26 },
    { f: 783.99, d: 0.16 },
    { f: 880.0, d: 0.18 },
    { f: 1046.5, d: 0.42 },
];

function collisionPairKey(idA, idB) {
    const a = idA < 0 ? 'table' : idA;
    const b = idB < 0 ? 'table' : idB;
    return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

export function createDiceCollisionAudio(options = {}) {
    const config = { ...DEFAULTS, ...options };
    let audioContext = null;
    let masterGain = null;
    let playedCount = 0;
    let activeVoices = 0;

    const pairCooldowns = new Map();

    let userVolume = readStoredVolume(config.defaultVolume);
    let muted = readStoredMuted();

    let ambientGain = null;
    let ambientStarted = false;
    let ambientIntensity = 0.5;
    let noiseLoopBuffer = null;

    let lampData = null;
    const _listenerForward = new THREE.Vector3();
    const _listenerUp = new THREE.Vector3();
    const _lampPos = new THREE.Vector3();

    function effectiveGain() {
        return (muted ? 0 : userVolume) * config.masterScale;
    }

    function ensureContext() {
        if (audioContext) return audioContext;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;

        audioContext = new Ctx();
        masterGain = audioContext.createGain();
        masterGain.gain.value = effectiveGain();
        masterGain.connect(audioContext.destination);
        return audioContext;
    }

    function resume() {
        const ctx = ensureContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume()
                .then(startAmbient)
                .catch(() => {});
        } else if (ctx.state === 'running') {
            startAmbient();
        }
    }

    function createSpatialBus(position) {
        if (!masterGain) return { input: masterGain, dispose: () => {} };
        if (!position) return { input: masterGain, dispose: () => {} };

        const ctx = audioContext;
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1.5;
        panner.maxDistance = 22;
        panner.rolloffFactor = 1.2;
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
        panner.connect(masterGain);
        return { input: panner, dispose: () => panner.disconnect() };
    }

    function updateListener(camera) {
        const ctx = audioContext;
        if (!ctx || !camera || ctx.state !== 'running') return;

        const listener = ctx.listener;
        const t = ctx.currentTime;
        listener.positionX.setTargetAtTime(camera.position.x, t, 0.05);
        listener.positionY.setTargetAtTime(camera.position.y, t, 0.05);
        listener.positionZ.setTargetAtTime(camera.position.z, t, 0.05);

        camera.getWorldDirection(_listenerForward);
        _listenerUp.copy(camera.up);

        listener.forwardX.setTargetAtTime(_listenerForward.x, t, 0.05);
        listener.forwardY.setTargetAtTime(_listenerForward.y, t, 0.05);
        listener.forwardZ.setTargetAtTime(_listenerForward.z, t, 0.05);
        listener.upX.setTargetAtTime(_listenerUp.x, t, 0.05);
        listener.upY.setTargetAtTime(_listenerUp.y, t, 0.05);
        listener.upZ.setTargetAtTime(_listenerUp.z, t, 0.05);
    }

    function releaseSpatialBus(bus, delaySec) {
        if (!bus?.dispose) return;
        window.setTimeout(() => bus.dispose(), Math.max(10, delaySec * 1000));
    }

    function acquireVoice(durationSec) {
        if (activeVoices >= config.maxVoices) return false;
        activeVoices += 1;
        window.setTimeout(
            () => {
                activeVoices = Math.max(0, activeVoices - 1);
            },
            Math.max(10, durationSec * 1000)
        );
        return true;
    }

    function makeNoiseBuffer(seconds, decay = true) {
        const ctx = audioContext;
        const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = decay ? 1 - i / len : 1;
            data[i] = (Math.random() * 2 - 1) * env;
        }
        return buffer;
    }

    function selectVoice(event) {
        const a = event.surface ?? 'die';
        const b = event.otherSurface ?? (event.idB === -1 ? 'velvet' : 'die');
        if (a === 'metal' || b === 'metal') return 'metal';
        if (a === 'glass' || b === 'glass') return 'glass';
        if (a === 'velvet' || b === 'velvet') return 'velvet';
        if (a === 'table' || b === 'table' || a === 'wood' || b === 'wood') return 'wood';
        if (a === 'leather' || b === 'leather') return 'leather';
        return 'clack';
    }

    function handleCollisionEvent(event) {
        const ctx = ensureContext();
        if (!ctx || !masterGain) return;
        if (ctx.state !== 'running') return;

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

        if (activeVoices >= config.maxVoices) return;

        playedCount += 1;

        const volume = clamp(totalKE / config.energyForMaxVolume, 0.04, 1.0);
        const impactBias = clamp(totalKE / 200, 0, 1);
        const massBias = clamp((mass - 5) / 20, -0.15, 0.25);
        const sidesPitch = event.sides
            ? clamp(1.06 - Math.log2(event.sides) * 0.04, 0.82, 1.08)
            : 1;

        synthVoice(selectVoice(event), {
            volume,
            impactBias,
            massBias,
            sidesPitch,
            position: event.position ?? null,
        });
    }

    function synthNoiseTone(
        now,
        output,
        { filterType, freq, q, noiseGain, noiseDecay, toneType, toneFreq, toneGain, toneDecay }
    ) {
        const ctx = audioContext;
        const dest = output ?? masterGain;

        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = makeNoiseBuffer(noiseDecay + 0.01);
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = filterType;
        noiseFilter.frequency.value = freq;
        noiseFilter.Q.value = q;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(noiseGain, now);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + noiseDecay);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(ng);
        ng.connect(dest);
        noiseSource.start(now);
        noiseSource.stop(now + noiseDecay + 0.02);

        if (toneGain > 0) {
            const tone = ctx.createOscillator();
            tone.type = toneType;
            tone.frequency.value = toneFreq;
            const tg = ctx.createGain();
            tg.gain.setValueAtTime(toneGain, now);
            tg.gain.exponentialRampToValueAtTime(0.0001, now + toneDecay);
            tone.connect(tg);
            tg.connect(dest);
            tone.start(now);
            tone.stop(now + toneDecay + 0.02);
        }
    }

    function synthMetalRing(
        now,
        output,
        { baseFreq, gain, decay, partials = [1, 2.76, 5.4, 8.9] }
    ) {
        const ctx = audioContext;
        const dest = output ?? masterGain;
        partials.forEach((ratio, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = baseFreq * ratio;
            osc.detune.value = (Math.random() - 0.5) * 8;
            const g = ctx.createGain();
            const pGain = gain / (i + 1.3);
            const pDecay = decay / (1 + i * 0.5);
            g.gain.setValueAtTime(0.0001, now);
            g.gain.linearRampToValueAtTime(pGain, now + 0.004);
            g.gain.exponentialRampToValueAtTime(0.0001, now + pDecay);
            osc.connect(g);
            g.connect(dest);
            osc.start(now);
            osc.stop(now + pDecay + 0.05);
        });
    }

    function synthVoice(
        voice,
        { volume, impactBias, massBias = 0, sidesPitch = 1, position = null }
    ) {
        const voiceDuration = voice === 'metal' ? 0.5 : voice === 'velvet' ? 0.12 : 0.15;
        if (!acquireVoice(voiceDuration)) return;

        const bus = createSpatialBus(position);
        const output = bus.input;
        const now = audioContext.currentTime;
        const pitchJitter = (Math.random() - 0.5) * 0.1;
        const freqJitter = (1 + (Math.random() - 0.5) * 0.12) * sidesPitch;
        const brightness = clamp(
            (2300 - impactBias * 1100) * (1 - massBias) * sidesPitch,
            600,
            2600
        );

        if (voice === 'metal') {
            synthMetalRing(now, output, {
                baseFreq: clamp(620 * (1 - massBias) * freqJitter, 300, 1200),
                gain: volume * 0.16,
                decay: 0.35 + impactBias * 0.4,
            });
            synthNoiseTone(now, output, {
                filterType: 'highpass',
                freq: brightness * 1.4,
                q: 1.2,
                noiseGain: volume * 0.18,
                noiseDecay: 0.05,
                toneType: 'sine',
                toneFreq: brightness * 0.4,
                toneGain: 0,
                toneDecay: 0.05,
            });
            releaseSpatialBus(bus, voiceDuration);
            return;
        }

        if (voice === 'glass') {
            synthNoiseTone(now, output, {
                filterType: 'highpass',
                freq: clamp(3200 * freqJitter, 1500, 5000),
                q: 1.6,
                noiseGain: volume * 0.3,
                noiseDecay: 0.04,
                toneType: 'sine',
                toneFreq: clamp(2600 * freqJitter, 1200, 4000),
                toneGain: volume * 0.12,
                toneDecay: 0.12,
            });
            releaseSpatialBus(bus, 0.15);
            return;
        }

        if (voice === 'velvet') {
            const pitch = clamp(0.78 + pitchJitter - impactBias * 0.6 - massBias, 0.6, 0.95);
            synthNoiseTone(now, output, {
                filterType: 'lowpass',
                freq: clamp(650 * pitch * sidesPitch, 350, 900),
                q: 0.8,
                noiseGain: volume * 0.36,
                noiseDecay: 0.07,
                toneType: 'triangle',
                toneFreq: brightness * 0.1 * pitch,
                toneGain: volume * 0.12,
                toneDecay: 0.06,
            });
            releaseSpatialBus(bus, voiceDuration);
            return;
        }

        if (voice === 'wood') {
            const pitch = clamp(1.0 + pitchJitter - impactBias - massBias, 0.6, 1.1) * sidesPitch;
            synthNoiseTone(now, output, {
                filterType: 'bandpass',
                freq: clamp(brightness * 0.8 * freqJitter, 400, 2200),
                q: 0.9,
                noiseGain: volume * 0.42,
                noiseDecay: 0.09,
                toneType: 'triangle',
                toneFreq: brightness * 0.16 * pitch,
                toneGain: volume * 0.2,
                toneDecay: 0.08,
            });
            releaseSpatialBus(bus, 0.12);
            return;
        }

        if (voice === 'leather') {
            const pitch =
                clamp(0.82 + pitchJitter - impactBias * 0.5 - massBias, 0.65, 1.0) * sidesPitch;
            synthNoiseTone(now, output, {
                filterType: 'lowpass',
                freq: clamp(550 * pitch, 350, 900),
                q: 0.7,
                noiseGain: volume * 0.38,
                noiseDecay: 0.05,
                toneType: 'triangle',
                toneFreq: brightness * 0.12 * pitch,
                toneGain: volume * 0.1,
                toneDecay: 0.045,
            });
            releaseSpatialBus(bus, 0.08);
            return;
        }

        const pitch = clamp(1.0 + pitchJitter - impactBias - massBias, 0.7, 1.15) * sidesPitch;
        synthNoiseTone(now, output, {
            filterType: 'highpass',
            freq: clamp(brightness * freqJitter, 700, 2600),
            q: 0.9,
            noiseGain: volume * 0.42,
            noiseDecay: 0.07,
            toneType: 'triangle',
            toneFreq: brightness * 0.2 * pitch,
            toneGain: volume * 0.15,
            toneDecay: 0.06,
        });
        releaseSpatialBus(bus, voiceDuration);
    }

    function playImpact({
        surface = 'metal',
        volume = 0.6,
        pitch = 1,
        decay = null,
        position = null,
    } = {}) {
        const ctx = ensureContext();
        if (!ctx || !masterGain) return;
        if (ctx.state !== 'running') return;
        const v = clamp(volume, 0, 1);
        const now = ctx.currentTime;
        const bus = createSpatialBus(position);
        const output = bus.input;

        if (surface === 'gong') {
            if (!acquireVoice(1.6)) return;
            synthMetalRing(now, output, {
                baseFreq: clamp(150 * pitch, 80, 400),
                gain: v * 0.5,
                decay: decay ?? 1.4,
                partials: [1, 1.5, 2.0, 2.74, 3.76, 5.1, 6.8],
            });
            synthNoiseTone(now, output, {
                filterType: 'bandpass',
                freq: 1800,
                q: 0.7,
                noiseGain: v * 0.35,
                noiseDecay: 0.12,
                toneType: 'sine',
                toneFreq: 0,
                toneGain: 0,
                toneDecay: 0.1,
            });
            releaseSpatialBus(bus, 1.6);
            return;
        }

        if (surface === 'bell') {
            if (!acquireVoice(0.9)) return;
            synthMetalRing(now, output, {
                baseFreq: clamp(950 * pitch, 800, 1200),
                gain: v * 0.38,
                decay: decay ?? 0.65,
                partials: [1, 2.1, 3.4, 5.2, 7.1],
            });
            synthNoiseTone(now, output, {
                filterType: 'highpass',
                freq: 2400,
                q: 1.0,
                noiseGain: v * 0.2,
                noiseDecay: 0.04,
                toneType: 'sine',
                toneFreq: 0,
                toneGain: 0,
                toneDecay: 0.04,
            });
            releaseSpatialBus(bus, 0.9);
            return;
        }

        if (surface === 'bubble') {
            if (!acquireVoice(0.5)) return;
            const base = clamp(160 * pitch, 120, 200);
            synthNoiseTone(now, output, {
                filterType: 'bandpass',
                freq: clamp(420 * pitch, 280, 600),
                q: 1.4,
                noiseGain: v * 0.28,
                noiseDecay: 0.08,
                toneType: 'sine',
                toneFreq: base,
                toneGain: v * 0.18,
                toneDecay: 0.22,
            });
            releaseSpatialBus(bus, 0.5);
            return;
        }

        if (surface === 'bone') {
            if (!acquireVoice(0.25)) return;
            synthNoiseTone(now, output, {
                filterType: 'lowpass',
                freq: clamp(900 * pitch, 300, 1600),
                q: 1.0,
                noiseGain: v * 0.4,
                noiseDecay: 0.06,
                toneType: 'triangle',
                toneFreq: clamp(180 * pitch, 90, 360),
                toneGain: v * 0.22,
                toneDecay: 0.18,
            });
            releaseSpatialBus(bus, 0.25);
            return;
        }

        if (surface === 'click') {
            if (!acquireVoice(0.25)) return;
            synthNoiseTone(now, output, {
                filterType: 'highpass',
                freq: 4200,
                q: 1.4,
                noiseGain: v * 0.22,
                noiseDecay: 0.025,
                toneType: 'sine',
                toneFreq: 0,
                toneGain: 0,
                toneDecay: 0.02,
            });
            synthMetalRing(now, output, {
                baseFreq: 900 * pitch,
                gain: v * 0.06,
                decay: 0.18,
                partials: [1, 2.4],
            });
            releaseSpatialBus(bus, 0.25);
            return;
        }

        if (!acquireVoice(0.7)) return;
        synthMetalRing(now, output, {
            baseFreq: clamp(500 * pitch, 200, 1100),
            gain: v * 0.3,
            decay: decay ?? 0.6,
        });
        releaseSpatialBus(bus, 0.7);
    }

    function checkCollisionPropReactions(event) {
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

    function setLampData(data) {
        lampData = data ?? null;
    }

    function playFluteNote(startAt, freq, dur, vol) {
        const ctx = audioContext;
        const env = ctx.createGain();
        env.connect(masterGain);
        const attack = Math.min(0.05, dur * 0.3);
        const release = Math.min(0.12, dur * 0.5);
        env.gain.setValueAtTime(0.0001, startAt);
        env.gain.linearRampToValueAtTime(vol, startAt + attack);
        env.gain.setValueAtTime(vol, startAt + dur - release);
        env.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);

        const fund = ctx.createOscillator();
        fund.type = 'sine';
        fund.frequency.value = freq;
        const over = ctx.createOscillator();
        over.type = 'triangle';
        over.frequency.value = freq * 2;
        const overGain = ctx.createGain();
        overGain.gain.value = 0.18;

        const vib = ctx.createOscillator();
        vib.frequency.value = 5.5;
        const vibGain = ctx.createGain();
        vibGain.gain.value = freq * 0.006;
        vib.connect(vibGain);
        vibGain.connect(fund.frequency);
        vibGain.connect(over.frequency);

        const breath = ctx.createBufferSource();
        breath.buffer = makeNoiseBuffer(dur + 0.02, false);
        const breathFilter = ctx.createBiquadFilter();
        breathFilter.type = 'bandpass';
        breathFilter.frequency.value = freq * 1.5;
        breathFilter.Q.value = 0.6;
        const breathGain = ctx.createGain();
        breathGain.gain.value = vol * 0.06;

        fund.connect(env);
        over.connect(overGain);
        overGain.connect(env);
        breath.connect(breathFilter);
        breathFilter.connect(breathGain);
        breathGain.connect(env);

        fund.start(startAt);
        fund.stop(startAt + dur + 0.05);
        over.start(startAt);
        over.stop(startAt + dur + 0.05);
        vib.start(startAt);
        vib.stop(startAt + dur + 0.05);
        breath.start(startAt);
        breath.stop(startAt + dur + 0.02);
    }

    function playMelody(notes) {
        const ctx = ensureContext();
        if (!ctx || !masterGain || ctx.state !== 'running') return false;
        const tune = Array.isArray(notes) && notes.length ? notes : DEFAULT_FLUTE_TUNE;
        let t = ctx.currentTime + 0.03;
        for (const note of tune) {
            const dur = note.d ?? 0.2;
            playFluteNote(t, note.f ?? 660, dur, note.vol ?? 0.4);
            t += dur * 0.96;
        }
        return true;
    }

    function startAmbient() {
        if (ambientStarted) return;
        const ctx = audioContext;
        if (!ctx || ctx.state !== 'running' || !masterGain) return;
        ambientStarted = true;

        ambientGain = ctx.createGain();
        ambientGain.gain.value = 0.04 * ambientIntensity;
        ambientGain.connect(masterGain);

        noiseLoopBuffer = makeNoiseBuffer(3.0, false);
        const loop = ctx.createBufferSource();
        loop.buffer = noiseLoopBuffer;
        loop.loop = true;
        const bedFilter = ctx.createBiquadFilter();
        bedFilter.type = 'lowpass';
        bedFilter.frequency.value = 320;
        bedFilter.Q.value = 0.5;
        loop.connect(bedFilter);
        bedFilter.connect(ambientGain);
        loop.start();

        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.06;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 140;
        lfo.connect(lfoGain);
        lfoGain.connect(bedFilter.frequency);
        lfo.start();

        scheduleFireCrackle();
        scheduleWoodCreak();
    }

    function applyAmbientIntensity(value) {
        ambientIntensity = clamp(value, 0, 1.5);
        if (ambientGain && audioContext) {
            ambientGain.gain.setTargetAtTime(
                0.04 * ambientIntensity,
                audioContext.currentTime,
                0.8
            );
        }
    }

    function scheduleFireCrackle() {
        if (!ambientStarted) return;
        const delay = 200 + Math.random() * 1100;
        setTimeout(() => {
            const ctx = audioContext;
            if (ambientStarted && ctx && ctx.state === 'running' && ambientGain) {
                const now = ctx.currentTime;
                const pops = 1 + Math.floor(Math.random() * 3);
                for (let i = 0; i < pops; i++) {
                    const t = now + i * (0.02 + Math.random() * 0.05);
                    const src = ctx.createBufferSource();
                    src.buffer = makeNoiseBuffer(0.03);
                    const f = ctx.createBiquadFilter();
                    f.type = 'bandpass';
                    f.frequency.value = 700 + Math.random() * 1800;
                    f.Q.value = 2 + Math.random() * 3;
                    const g = ctx.createGain();
                    const peak = (0.015 + Math.random() * 0.03) * ambientIntensity;
                    g.gain.setValueAtTime(peak, t);
                    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
                    src.connect(f);
                    f.connect(g);
                    g.connect(ambientGain);
                    src.start(t);
                    src.stop(t + 0.06);
                }
            }
            scheduleFireCrackle();
        }, delay);
    }

    function scheduleWoodCreak() {
        if (!ambientStarted) return;
        const delay = 8000 + Math.random() * 17000;
        setTimeout(() => {
            const ctx = audioContext;
            if (ambientStarted && ctx && ctx.state === 'running' && ambientGain) {
                const now = ctx.currentTime;
                const dur = 0.5 + Math.random() * 0.8;
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                const f0 = 90 + Math.random() * 60;
                osc.frequency.setValueAtTime(f0, now);
                osc.frequency.linearRampToValueAtTime(f0 * (1.1 + Math.random() * 0.3), now + dur);
                const lp = ctx.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = 280;
                const g = ctx.createGain();
                const peak = 0.03 * ambientIntensity;
                g.gain.setValueAtTime(0.0001, now);
                g.gain.linearRampToValueAtTime(peak, now + dur * 0.4);
                g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
                osc.connect(lp);
                lp.connect(g);
                g.connect(ambientGain);
                osc.start(now);
                osc.stop(now + dur + 0.05);
            }
            scheduleWoodCreak();
        }, delay);
    }

    function applyMasterGain(immediate = false) {
        if (!masterGain || !audioContext) return;
        const target = effectiveGain();
        if (immediate) masterGain.gain.value = target;
        else masterGain.gain.setTargetAtTime(target, audioContext.currentTime, 0.02);
    }

    function setMasterVolume(value) {
        userVolume = clamp(value, 0, 1);
        try {
            localStorage.setItem(STORAGE_VOLUME, String(userVolume));
        } catch {}
        applyMasterGain();
    }

    function setMuted(value) {
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
            activeVoices,
            maxVoices: config.maxVoices,
            volume: userVolume,
            muted,
        }),
    };
    activeInstance = api;
    return api;
}
