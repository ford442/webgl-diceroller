const { launchPage } = require('./helpers/browser');
const { BASE } = require('./helpers/server');

/**
 * Tavern audio graph smoke (#326). Needs the preview server, not WASM: it
 * drives the audio façade directly with synthetic collision events and prop
 * one-shots.
 *
 * For each synth path (AudioWorklet + HRTF slots, AudioWorklet + in-engine
 * stereo pan, ScriptProcessor fallback) it checks that:
 * - synthesis creates no OscillatorNode / AudioBufferSourceNode on the main
 *   thread and the graph stays a fixed size through a 20-die dump,
 * - the processor enforces maxVoices,
 * - sound actually reaches the master bus.
 */

const PROFILES = [
    { name: 'worklet + hrtf', query: '&audio-pan=hrtf', synth: 'worklet', panMode: 'hrtf' },
    { name: 'worklet + stereo', query: '&audio-pan=stereo', synth: 'worklet', panMode: 'stereo' },
    {
        name: 'script-processor fallback',
        query: '&audio-fallback',
        synth: 'script-processor',
        panMode: 'stereo',
    },
];

// Counts node construction and keeps the first GainNode (the master bus) so
// the test can hang an analyser off it.
function instrumentAudio() {
    const w = /** @type {any} */ (window);
    w.__audioProbe = { created: {}, master: null };
    const proto = AudioContext.prototype;
    for (const method of [
        'createOscillator',
        'createBufferSource',
        'createBiquadFilter',
        'createPanner',
        'createGain',
        'createConvolver',
    ]) {
        const original = /** @type {any} */ (proto)[method];
        /** @type {any} */ (proto)[method] = function (...args) {
            const node = original.apply(this, args);
            w.__audioProbe.created[method] = (w.__audioProbe.created[method] ?? 0) + 1;
            if (method === 'createGain' && !w.__audioProbe.master) w.__audioProbe.master = node;
            return node;
        };
    }
}

async function checkProfile(page, profile) {
    await page.goto(`${BASE}/?webgl&no-post&test${profile.query}`, {
        waitUntil: 'load',
        timeout: 60000,
    });
    await page.waitForFunction(() => !!window.__app?.audio, null, { timeout: 60000 });

    // Trusted gesture → resume() → context + synth init.
    await page.mouse.click(5, 5);
    await page.waitForFunction(
        () => {
            const s = /** @type {any} */ (window.__app.audio).getStats();
            return s.synth !== 'pending' && s.synth !== 'none';
        },
        null,
        { timeout: 15000 }
    );

    const result = await page.evaluate(async () => {
        const w = /** @type {any} */ (window);
        const audio = w.__app.audio;
        const probe = w.__audioProbe;
        const before = { ...probe.created };

        const master = probe.master;
        const analyser = master.context.createAnalyser();
        analyser.fftSize = 2048;
        master.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let peak = 0;
        const sample = () => {
            analyser.getFloatTimeDomainData(buf);
            for (const v of buf) peak = Math.max(peak, Math.abs(v));
        };

        audio.setMuted(false);
        audio.setMasterVolume(1);
        audio.playImpact({ surface: 'gong', volume: 1, position: { x: 1, y: 0, z: 0 } });
        // A 20-die dump: every pair distinct so per-pair cooldowns do not filter it.
        for (let i = 0; i < 20; i++) {
            audio.handleCollisionEvent({
                idA: i,
                idB: -1,
                mass: 5,
                impactSpeed: 6,
                sides: 20,
                position: { x: (i % 5) - 2, y: 0.5, z: Math.floor(i / 5) - 2 },
            });
        }
        audio.playMelody();

        for (let i = 0; i < 20; i++) {
            sample();
            await new Promise((r) => setTimeout(r, 25));
        }
        await new Promise((r) => setTimeout(r, 400));
        const stats = audio.getStats();
        master.disconnect(analyser);
        return { before, after: { ...probe.created }, stats, peak };
    });

    const { before, after, stats, peak } = result;
    const grew = Object.keys(after).filter((k) => (after[k] ?? 0) !== (before[k] ?? 0));
    /** @type {Array<[string, boolean]>} */
    const checks = [
        [`synth path is ${profile.synth}`, stats.synth === profile.synth],
        [`pan mode is ${profile.panMode}`, stats.panMode === profile.panMode],
        ['no nodes created while playing (fixed graph)', grew.length === 0],
        [
            'no OscillatorNode / buffer source ever created',
            !after.createOscillator && !after.createBufferSource,
        ],
        ['collisions accepted (getStats().played > 0)', stats.played > 0],
        ['engine reported voice starts', (stats.engine?.started ?? 0) > 0],
        [
            `processor held maxVoices (${stats.maxVoices})`,
            (stats.engine?.peakActive ?? Infinity) <= stats.maxVoices,
        ],
        ['audible output on the master bus', peak > 0.001],
    ];
    console.log(`\n[${profile.name}]`);
    console.log(
        `  stats: played=${stats.played} engine=${JSON.stringify(stats.engine)} reverb=${stats.reverb} peak=${peak.toFixed(4)}`
    );
    if (grew.length) console.log(`  nodes created during play: ${grew.join(', ')}`);
    let ok = true;
    for (const [name, pass] of checks) {
        console.log(`  ${pass ? '✓' : '✗'} ${name}`);
        ok &&= pass;
    }
    return ok;
}

const LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
];

(async () => {
    const only = process.env.AUDIO_PROFILE;
    let ok = true;
    // A fresh browser per profile: several tavern pages rendering under
    // SwiftShader in one browser exhausts the renderer and crashes the third.
    for (const profile of PROFILES.filter((x) => !only || x.name.includes(only))) {
        const { browser, page } = await launchPage({ args: LAUNCH_ARGS, logConsole: false });
        page.on('crash', () => console.error(`  page crashed during [${profile.name}]`));
        try {
            await page.addInitScript(instrumentAudio);
            ok = (await checkProfile(page, profile)) && ok;
        } catch (err) {
            console.error(`FAILURE [${profile.name}]:`, err.message);
            ok = false;
        } finally {
            await browser.close();
        }
    }
    console.log(ok ? '\nPASS: tavern audio worklet' : '\nFAIL: tavern audio worklet');
    process.exit(ok ? 0 : 1);
})();
