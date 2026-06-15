/**
 * Synthesised dice collision audio.
 *
 * Impact loudness and timbre are driven by the kinetic energy of the colliding
 * die, approximated as:
 *
 *   E_k = 1/2 * m * v^2 + 1/2 * I * omega^2
 *
 * where m is mass, v is linear velocity, I is a scalar moment-of-inertia
 * estimate, and omega is angular velocity. Harder impacts → louder, brighter
 * and slightly lower-pitched sounds.
 */
const DEFAULTS = {
    maxVoices: 6,
    cooldownMs: 45,
    energyForMaxVolume: 50,
    minAudibleEnergy: 0.18
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function createDiceCollisionAudio(options = {}) {
    const config = { ...DEFAULTS, ...options };
    let audioContext = null;
    let masterGain = null;
    let lastPlayAt = 0;

    function ensureContext() {
        if (audioContext) return audioContext;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;

        audioContext = new Ctx();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.18;
        masterGain.connect(audioContext.destination);
        return audioContext;
    }

    function resume() {
        const ctx = ensureContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
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

        const now = ctx.currentTime;
        const volume = clamp(totalKE / config.energyForMaxVolume, 0.04, 1.0);
        const impactBias = clamp(totalKE / 200, 0, 1);
        const pitchJitter = (Math.random() - 0.5) * 0.1;
        const pitch = clamp(1.0 + pitchJitter - impactBias, 0.7, 1.1);
        const brightness = clamp(2300 - impactBias * 1100, 700, 2600);

        const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.035));
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }

        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = event.idB === -1 ? 'bandpass' : 'highpass';
        noiseFilter.frequency.value = brightness;
        noiseFilter.Q.value = 0.9;

        const tone = ctx.createOscillator();
        tone.type = 'triangle';
        tone.frequency.value = brightness * 0.18 * pitch;

        const toneGain = ctx.createGain();
        toneGain.gain.setValueAtTime(volume * 0.17, now);
        toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.42, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);

        tone.connect(toneGain);
        toneGain.connect(masterGain);

        noiseSource.start(now);
        noiseSource.stop(now + 0.10);
        tone.start(now);
        tone.stop(now + 0.08);
    }

    return {
        resume,
        handleCollisionEvent
    };
}
