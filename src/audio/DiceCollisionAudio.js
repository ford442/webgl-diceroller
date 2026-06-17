/**
 * Synthesised tavern audio: dice collisions, prop-impact accents, and a subtle
 * ambient room bed. Everything is generated with the Web Audio API — no external
 * audio assets are downloaded.
 *
 * Collision loudness/timbre is driven by the kinetic energy of the colliding
 * body, approximated as:
 *
 *   E_k = 1/2 * m * v^2 + 1/2 * I * omega^2
 *
 * Harder impacts → louder, brighter and slightly lower-pitched sounds. On top of
 * the energy mapping, a per-impact "voice" is chosen from the materials involved
 * (wooden table, die-on-die, metal prop, glass) so a gold tankard rings while the
 * table thuds.
 */
const DEFAULTS = {
    maxVoices: 6,
    cooldownMs: 45,
    energyForMaxVolume: 50,
    minAudibleEnergy: 0.18,
    // Master gain = (muted ? 0 : userVolume) * masterScale. A userVolume of ~0.6
    // reproduces the previous fixed 0.18 master gain.
    masterScale: 0.3,
    defaultVolume: 0.6
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

// Module-level handle to the (single) active instance so prop modules can play
// impact accents without threading a reference through every layer.
let activeInstance = null;

/** Play a one-off prop-impact accent (gong, skull, lamp, heavy drops). */
export const playPropImpact = (opts) => activeInstance?.playImpact(opts);

/** Adjust ambient loudness multiplier (e.g. louder in FPS/pointer-lock mode). */
export const setAmbientIntensity = (value) => activeInstance?.setAmbientIntensity(value);

/** Play a short flute melody (defaults to a pleasant built-in phrase). */
export const playFluteMelody = (notes) => activeInstance?.playMelody(notes);

// A gentle pentatonic-ish phrase (frequencies in Hz, durations in seconds).
const DEFAULT_FLUTE_TUNE = [
    { f: 587.33, d: 0.18 }, // D5
    { f: 659.25, d: 0.18 }, // E5
    { f: 783.99, d: 0.18 }, // G5
    { f: 880.0, d: 0.26 },  // A5
    { f: 783.99, d: 0.16 }, // G5
    { f: 880.0, d: 0.18 },  // A5
    { f: 1046.5, d: 0.42 }  // C6
];

export function createDiceCollisionAudio(options = {}) {
    const config = { ...DEFAULTS, ...options };
    let audioContext = null;
    let masterGain = null;
    let lastPlayAt = 0;
    let playedCount = 0;

    let userVolume = readStoredVolume(config.defaultVolume);
    let muted = readStoredMuted();

    // Ambient state.
    let ambientGain = null;
    let ambientStarted = false;
    let ambientIntensity = 0.5; // base; bumped toward 1.0 in FPS mode
    let noiseLoopBuffer = null;

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
            ctx.resume().then(startAmbient).catch(() => {});
        } else if (ctx.state === 'running') {
            startAmbient();
        }
    }

    // ----- shared white-noise buffer factory ------------------------------

    function makeNoiseBuffer(seconds, decay = true) {
        const ctx = audioContext;
        const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = decay ? (1 - i / len) : 1;
            data[i] = (Math.random() * 2 - 1) * env;
        }
        return buffer;
    }

    // ----- collision voice selection --------------------------------------

    // Resolve the material "voice" for a collision from optional surface metadata,
    // falling back to the legacy id-based heuristic (idB === -1 means table) so
    // the WASM/worker event path (which carries no surface) still works.
    function selectVoice(event) {
        const a = event.surface ?? 'die';
        const b = event.otherSurface ?? (event.idB === -1 ? 'table' : 'die');
        if (a === 'metal' || b === 'metal') return 'metal';
        if (a === 'glass' || b === 'glass') return 'glass';
        if (a === 'table' || b === 'table' || a === 'wood' || b === 'wood') return 'wood';
        return 'clack';
    }

    function handleCollisionEvent(event) {
        const ctx = ensureContext();
        if (!ctx || !masterGain) return;
        if (ctx.state !== 'running') return;

        const mass = event.mass ?? 5;
        const linearSpeedSq = event.linearSpeedSq ?? ((event.impactSpeed ?? 0) ** 2);
        const angularSpeedSq = event.angularSpeedSq ?? 0;
        const inertiaScalar = event.inertiaScalar ?? 0;
        const totalKE = 0.5 * mass * linearSpeedSq + 0.5 * inertiaScalar * angularSpeedSq;
        if (totalKE < config.minAudibleEnergy) return;

        const nowMs = performance.now();
        if ((nowMs - lastPlayAt) < config.cooldownMs) return;
        lastPlayAt = nowMs;
        playedCount++;

        const volume = clamp(totalKE / config.energyForMaxVolume, 0.04, 1.0);
        const impactBias = clamp(totalKE / 200, 0, 1);
        // Heavier bodies read as duller/lower; this gives a d20 a different voice
        // than a d4 even on the same surface.
        const massBias = clamp((mass - 5) / 20, -0.15, 0.25);
        synthVoice(selectVoice(event), { volume, impactBias, massBias });
    }

    // ----- voices ---------------------------------------------------------

    // A short noise transient through a filter, plus a pitched "body" tone.
    function synthNoiseTone(now, { filterType, freq, q, noiseGain, noiseDecay, toneType, toneFreq, toneGain, toneDecay }) {
        const ctx = audioContext;

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
        ng.connect(masterGain);
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
            tg.connect(masterGain);
            tone.start(now);
            tone.stop(now + toneDecay + 0.02);
        }
    }

    // Inharmonic metallic ring (gong, tankard, struck metal). `decay` and `gain`
    // scale with impact energy; partials are deliberately non-integer for a
    // shimmering, bell-like timbre.
    function synthMetalRing(now, { baseFreq, gain, decay, partials = [1, 2.76, 5.4, 8.9] }) {
        const ctx = audioContext;
        partials.forEach((ratio, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = baseFreq * ratio;
            // slight inharmonic detune
            osc.detune.value = (Math.random() - 0.5) * 8;
            const g = ctx.createGain();
            const pGain = gain / (i + 1.3);
            const pDecay = decay / (1 + i * 0.5);
            g.gain.setValueAtTime(0.0001, now);
            g.gain.linearRampToValueAtTime(pGain, now + 0.004);
            g.gain.exponentialRampToValueAtTime(0.0001, now + pDecay);
            osc.connect(g);
            g.connect(masterGain);
            osc.start(now);
            osc.stop(now + pDecay + 0.05);
        });
    }

    function synthVoice(voice, { volume, impactBias, massBias = 0 }) {
        const now = audioContext.currentTime;
        const pitchJitter = (Math.random() - 0.5) * 0.1;
        const freqJitter = 1 + (Math.random() - 0.5) * 0.12;
        const brightness = clamp((2300 - impactBias * 1100) * (1 - massBias), 600, 2600);

        if (voice === 'metal') {
            // Light metallic ping for collisions (the gong accent is bigger).
            synthMetalRing(now, {
                baseFreq: clamp(620 * (1 - massBias) * freqJitter, 300, 1200),
                gain: volume * 0.16,
                decay: 0.35 + impactBias * 0.4
            });
            synthNoiseTone(now, {
                filterType: 'highpass', freq: brightness * 1.4, q: 1.2,
                noiseGain: volume * 0.18, noiseDecay: 0.05,
                toneType: 'sine', toneFreq: brightness * 0.4, toneGain: 0, toneDecay: 0.05
            });
            return;
        }

        if (voice === 'glass') {
            synthNoiseTone(now, {
                filterType: 'highpass', freq: clamp(3200 * freqJitter, 1500, 5000), q: 1.6,
                noiseGain: volume * 0.3, noiseDecay: 0.04,
                toneType: 'sine', toneFreq: clamp(2600 * freqJitter, 1200, 4000), toneGain: volume * 0.12, toneDecay: 0.12
            });
            return;
        }

        if (voice === 'wood') {
            // Warm wooden thud (die on table / wooden prop). Bandpass body + low tone.
            const pitch = clamp(1.0 + pitchJitter - impactBias - massBias, 0.6, 1.1);
            synthNoiseTone(now, {
                filterType: 'bandpass', freq: clamp(brightness * 0.8 * freqJitter, 400, 2200), q: 0.9,
                noiseGain: volume * 0.42, noiseDecay: 0.09,
                toneType: 'triangle', toneFreq: brightness * 0.16 * pitch, toneGain: volume * 0.2, toneDecay: 0.08
            });
            return;
        }

        // 'clack' — sharp die-on-die.
        const pitch = clamp(1.0 + pitchJitter - impactBias - massBias, 0.7, 1.15);
        synthNoiseTone(now, {
            filterType: 'highpass', freq: clamp(brightness * freqJitter, 700, 2600), q: 0.9,
            noiseGain: volume * 0.42, noiseDecay: 0.07,
            toneType: 'triangle', toneFreq: brightness * 0.2 * pitch, toneGain: volume * 0.15, toneDecay: 0.06
        });
    }

    // ----- public prop-impact accent --------------------------------------

    /**
     * Play a deliberate prop impact (not energy-derived). `surface` selects the
     * timbre, `volume` (0..1) the loudness. Bypasses the collision cooldown so
     * deliberate interactions always sound.
     */
    function playImpact({ surface = 'metal', volume = 0.6, pitch = 1, decay = null } = {}) {
        const ctx = ensureContext();
        if (!ctx || !masterGain) return;
        if (ctx.state !== 'running') return;
        const v = clamp(volume, 0, 1);
        const now = ctx.currentTime;

        if (surface === 'gong') {
            // Big shimmering gong: deep fundamental + long inharmonic ring + strike noise.
            synthMetalRing(now, {
                baseFreq: clamp(150 * pitch, 80, 400),
                gain: v * 0.5,
                decay: (decay ?? 1.4),
                partials: [1, 1.5, 2.0, 2.74, 3.76, 5.1, 6.8]
            });
            synthNoiseTone(now, {
                filterType: 'bandpass', freq: 1800, q: 0.7,
                noiseGain: v * 0.35, noiseDecay: 0.12,
                toneType: 'sine', toneFreq: 0, toneGain: 0, toneDecay: 0.1
            });
            return;
        }

        if (surface === 'bone') {
            // Hollow knock (skull): lowpassed click + short low body tone.
            synthNoiseTone(now, {
                filterType: 'lowpass', freq: clamp(900 * pitch, 300, 1600), q: 1.0,
                noiseGain: v * 0.4, noiseDecay: 0.06,
                toneType: 'triangle', toneFreq: clamp(180 * pitch, 90, 360), toneGain: v * 0.22, toneDecay: 0.18
            });
            return;
        }

        if (surface === 'click') {
            // Soft metallic click + faint chain rattle (lamp toggle).
            synthNoiseTone(now, {
                filterType: 'highpass', freq: 4200, q: 1.4,
                noiseGain: v * 0.22, noiseDecay: 0.025,
                toneType: 'sine', toneFreq: 0, toneGain: 0, toneDecay: 0.02
            });
            synthMetalRing(now, { baseFreq: 900 * pitch, gain: v * 0.06, decay: 0.18, partials: [1, 2.4] });
            return;
        }

        // default: metal ring
        synthMetalRing(now, {
            baseFreq: clamp(500 * pitch, 200, 1100),
            gain: v * 0.3,
            decay: (decay ?? 0.6)
        });
    }

    // ----- flute melody ----------------------------------------------------

    // A single breathy flute note: sine fundamental + soft triangle overtone,
    // gentle vibrato, a touch of breath noise, and a smooth attack/release.
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

        // Vibrato.
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.5;
        const vibGain = ctx.createGain();
        vibGain.gain.value = freq * 0.006;
        vib.connect(vibGain);
        vibGain.connect(fund.frequency);
        vibGain.connect(over.frequency);

        // Breath noise.
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

        fund.start(startAt); fund.stop(startAt + dur + 0.05);
        over.start(startAt); over.stop(startAt + dur + 0.05);
        vib.start(startAt); vib.stop(startAt + dur + 0.05);
        breath.start(startAt); breath.stop(startAt + dur + 0.02);
    }

    function playMelody(notes) {
        const ctx = ensureContext();
        if (!ctx || !masterGain || ctx.state !== 'running') return false;
        const tune = Array.isArray(notes) && notes.length ? notes : DEFAULT_FLUTE_TUNE;
        let t = ctx.currentTime + 0.03;
        for (const note of tune) {
            const dur = note.d ?? 0.2;
            playFluteNote(t, note.f ?? 660, dur, (note.vol ?? 0.4));
            t += dur * 0.96; // slight legato overlap
        }
        return true;
    }

    // ----- ambient bed -----------------------------------------------------

    function startAmbient() {
        if (ambientStarted) return;
        const ctx = audioContext;
        if (!ctx || ctx.state !== 'running' || !masterGain) return;
        ambientStarted = true;

        ambientGain = ctx.createGain();
        ambientGain.gain.value = 0.04 * ambientIntensity;
        ambientGain.connect(masterGain);

        // Looping low-passed brown-ish noise → distant room rumble / wind / fire bed.
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

        // Slow wind swell: LFO on the bed lowpass cutoff and gain.
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

    function setAmbientIntensity(value) {
        ambientIntensity = clamp(value, 0, 1.5);
        if (ambientGain && audioContext) {
            ambientGain.gain.setTargetAtTime(0.04 * ambientIntensity, audioContext.currentTime, 0.8);
        }
    }

    // A faint, irregular fire crackle: short band-limited noise pops.
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
                    src.connect(f); f.connect(g); g.connect(ambientGain);
                    src.start(t); src.stop(t + 0.06);
                }
            }
            scheduleFireCrackle();
        }, delay);
    }

    // Rare, slow wood creak: low sine with a pitch slide + breathy filtered noise.
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
                osc.connect(lp); lp.connect(g); g.connect(ambientGain);
                osc.start(now); osc.stop(now + dur + 0.05);
            }
            scheduleWoodCreak();
        }, delay);
    }

    // ----- volume / mute ---------------------------------------------------

    function applyMasterGain(immediate = false) {
        if (!masterGain || !audioContext) return;
        const target = effectiveGain();
        if (immediate) masterGain.gain.value = target;
        else masterGain.gain.setTargetAtTime(target, audioContext.currentTime, 0.02);
    }

    function setMasterVolume(value) {
        userVolume = clamp(value, 0, 1);
        try { localStorage.setItem(STORAGE_VOLUME, String(userVolume)); } catch {}
        applyMasterGain();
    }

    function setMuted(value) {
        muted = !!value;
        try { localStorage.setItem(STORAGE_MUTED, muted ? '1' : '0'); } catch {}
        applyMasterGain();
    }

    const api = {
        resume,
        handleCollisionEvent,
        playImpact,
        playMelody,
        setAmbientIntensity,
        setMasterVolume,
        getMasterVolume: () => userVolume,
        setMuted,
        toggleMute: () => { setMuted(!muted); return muted; },
        isMuted: () => muted,
        getStats: () => ({ played: playedCount, maxVoices: config.maxVoices, volume: userVolume, muted })
    };
    activeInstance = api;
    return api;
}
