/**
 * AudioWorklet host for the tavern DSP engine. Bundled on its own by Vite
 * (`?worker&url` in DiceCollisionAudio.ts) and loaded with
 * `audioWorklet.addModule()`; everything interesting lives in `tavernDsp.ts`.
 *
 * The AudioWorkletGlobalScope globals (`AudioWorkletProcessor`,
 * `registerProcessor`, `sampleRate`) are read off `globalThis` so the module
 * type-checks under the DOM lib and can be instantiated under vitest with
 * mocked globals.
 */
import { TAVERN_PROCESSOR_NAME } from './protocol.js';
import { TavernDspEngine, type EngineOptions, type TavernMessage } from './tavernDsp.js';

/** Stats go back to the main thread at most this often (seconds of audio). */
const STATS_INTERVAL_SECONDS = 0.25;

const scope = globalThis as any;

if (
    typeof scope.AudioWorkletProcessor === 'function' &&
    typeof scope.registerProcessor === 'function'
) {
    class TavernProcessor extends scope.AudioWorkletProcessor {
        engine: TavernDspEngine;
        framesSinceStats = 0;
        statsInterval: number;

        constructor(options: { processorOptions?: Partial<EngineOptions> } = {}) {
            super(options);
            const opts = options.processorOptions ?? {};
            const rate = opts.sampleRate ?? scope.sampleRate ?? 48000;
            this.engine = new TavernDspEngine({ ...opts, sampleRate: rate });
            this.statsInterval = Math.round(STATS_INTERVAL_SECONDS * rate);
            this.port.onmessage = (e: MessageEvent<TavernMessage>) =>
                this.engine.handleMessage(e.data);
        }

        process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
            this.engine.render(outputs);
            this.framesSinceStats += outputs[0]?.[0]?.length ?? 128;
            if (this.engine.statsDirty && this.framesSinceStats >= this.statsInterval) {
                this.engine.statsDirty = false;
                this.framesSinceStats = 0;
                this.port.postMessage({ type: 'stats', stats: this.engine.stats() });
            }
            // Always alive: the ambient bed runs for the whole session.
            return true;
        }
    }

    scope.registerProcessor(TAVERN_PROCESSOR_NAME, TavernProcessor);
}
