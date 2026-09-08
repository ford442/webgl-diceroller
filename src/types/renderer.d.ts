// Minimal renderer-side structural types.
//
// `ComposerLike` lives here rather than in `app.d.ts` so that low-level modules
// (FrameScheduler) can depend on it without importing the app-wide context
// types — `app.d.ts` itself refers to FrameScheduler, so keeping the interface
// there created a type-only import cycle (`npm run check:cycles`).

/** The subset of an EffectComposer the frame loop and renderer factory drive. */
export interface ComposerLike {
    render?: () => void;
    dispose?: () => void;
    type?: string;
    setPixelRatio?: (ratio: number) => void;
    setSize?: (width: number, height: number) => void;
}
