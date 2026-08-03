/**
 * Builds the big options object passed to loadTiers(): roll hooks, lamp/gong/
 * candle setters, dice-cup interaction, and motion-activity wiring. Kept
 * separate from main.js purely because of its size — every closure here
 * still reads/writes the caller's live state through the getters/setters in
 * `deps`.
 */

/**
 * @param {import('../types/app').AppContext} app
 * @param {object} deps
 */
export function buildTierLoadOptions(app, deps) {
    const {
        collisionAudio,
        qualityProfile,
        multiplayerRef,
        rollWiring,
        setLampData,
        setGongData,
        setCandleFlamePos,
        setInteraction,
        getDiceCupController,
        getShadowController,
    } = deps;

    return {
        app,
        audio: collisionAudio,
        qualityProfile,
        onRollAll: () => {
            if (multiplayerRef.current?.isGuest()) return;
            rollWiring.rollHandlerRef.roll?.();
        },
        rollShareHooks: {
            hasShareableRoll: rollWiring.hasShareableRoll,
            buildShareUrl: rollWiring.getLastRollShareUrl,
        },
        notationHooks: rollWiring.createNotationHooks(),
        setLampData,
        setGongData,
        setCandleFlamePos,
        setInteraction,
        onDiceCupInteract: () => {
            const diceCupController = getDiceCupController();
            if (diceCupController?.getState().state === 'shaking') {
                diceCupController.handlePourKey();
            } else {
                diceCupController?.tryGrabCup();
            }
        },
        getDiceCupState: () => getDiceCupController()?.getState() ?? { available: false, state: 'idle' },
        interactionHooks: {
            onMotionActivityChange: (active, source) => {
                const shadowController = getShadowController();
                if (!shadowController) return;
                if (active) shadowController.noteMotionStart(source);
                else shadowController.noteMotionEnd(source);
            },
        },
    };
}
