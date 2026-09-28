/**
 * Constants shared by the main-thread façade and the worklet. Kept apart from
 * `tavernDsp.ts` so importing them does not pull the engine into the main chunk.
 */
export const TAVERN_PROCESSOR_NAME = 'tavern-processor';

/**
 * Longest a voice of each kind can ring, seconds. The façade uses this to
 * estimate its voice budget and when a panner slot frees up; the processor
 * enforces the real cap and fades out a slot's tail if the guess was early.
 */
export const VOICE_HOLD_SECONDS: Record<string, number> = {
    clack: 0.08,
    velvet: 0.08,
    wood: 0.1,
    leather: 0.06,
    glass: 0.13,
    metal: 0.8,
    gong: 1.45,
    bell: 0.7,
    bubble: 0.23,
    bone: 0.19,
    click: 0.2,
};
