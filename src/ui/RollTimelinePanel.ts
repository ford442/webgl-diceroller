/**
 * Roll timeline: a slider in fixed ticks over the roll that just happened,
 * play / pause at 1× and ¼×, and "Live" to hand the table back. It drives the
 * roll theatre and owns no replay state of its own.
 *
 * Collapsed to one "⏪ Replay" button until the player opens it (or the crit
 * cam takes the table, when it opens itself with a Skip button).
 */

import { createHudPanel, hudButton, guardPointerEvents } from './hudPanel.js';
import { ticksToSeconds } from '../app/rollTheatreModel.js';
import type { RollTheatre, TheatreState } from '../app/RollTheatre.js';

export interface RollTimelinePanel {
    open(): void;
    close(): void;
    destroy(): void;
}

export function createRollTimelinePanel({
    theatre,
    container = null,
}: {
    theatre: RollTheatre;
    container?: HTMLElement | null;
}): RollTimelinePanel {
    const panel = createHudPanel({
        id: 'roll-timeline-panel',
        ariaLabel: 'Roll replay timeline',
        variant: 'display',
        className: 'hud-panel--timeline',
        parent: container ?? undefined,
    });
    const { el, body } = panel;
    el.style.display = 'none';

    const openBtn = hudButton('⏪ Replay', 'hud-panel--timeline__open');
    openBtn.title = 'Scrub the last roll';

    const controls = document.createElement('div');
    controls.className = 'hud-row hud-panel--timeline__controls';
    controls.hidden = true;

    const label = document.createElement('span');
    label.className = 'hud-panel--timeline__label';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.step = '1';
    slider.className = 'hud-panel--timeline__slider';
    slider.setAttribute('aria-label', 'Replay position');
    guardPointerEvents(slider);

    const readout = document.createElement('span');
    readout.className = 'hud-panel--timeline__time';

    const playBtn = hudButton('▶');
    playBtn.setAttribute('aria-label', 'Play');
    const slowBtn = hudButton('¼×');
    slowBtn.title = 'Play at quarter speed';
    slowBtn.setAttribute('aria-label', 'Play at quarter speed');
    const liveBtn = hudButton('Live');
    liveBtn.title = 'Back to the settled table';

    controls.append(label, playBtn, slowBtn, slider, readout, liveBtn);
    body.append(openBtn, controls);

    let expanded = false;
    let state: TheatreState = theatre.getState();
    // Slider drags fire faster than a worker round trip: keep only the latest.
    let seeking = false;
    let pendingSeek: number | null = null;

    function render(): void {
        const show = state.available || state.active;
        el.style.display = show ? '' : 'none';
        const open = expanded || state.active;
        openBtn.hidden = open;
        controls.hidden = !open;
        slider.max = String(state.endTick);
        if (!seeking && pendingSeek === null) slider.value = String(state.tick);
        readout.textContent = `${ticksToSeconds(state.tick).toFixed(2)} / ${ticksToSeconds(state.endTick).toFixed(2)} s`;
        label.textContent = state.crit ? 'Slow replay' : 'Replay';
        const slowPlaying = state.playing && state.rate < 1;
        const fastPlaying = state.playing && state.rate >= 1;
        playBtn.textContent = fastPlaying ? '⏸' : '▶';
        playBtn.setAttribute('aria-label', fastPlaying ? 'Pause' : 'Play');
        slowBtn.textContent = slowPlaying ? '⏸' : '¼×';
        liveBtn.textContent = state.crit ? 'Skip ⏭' : 'Live';
        el.dataset.state = state.crit
            ? 'crit'
            : state.playing
              ? 'playing'
              : state.active
                ? 'scrub'
                : 'idle';
    }

    async function flushSeek(): Promise<void> {
        if (seeking) return;
        seeking = true;
        try {
            while (pendingSeek !== null) {
                const target = pendingSeek;
                pendingSeek = null;
                await theatre.seek(target);
            }
        } finally {
            seeking = false;
            render();
        }
    }

    function togglePlay(rate: number): void {
        if (state.playing && rate < 1 === state.rate < 1) {
            theatre.pause();
            return;
        }
        const from = state.active && state.tick < state.endTick ? state.tick : 0;
        void theatre.play(rate, { from });
    }

    openBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        expanded = true;
        render();
    });
    slider.addEventListener('input', () => {
        pendingSeek = Number(slider.value);
        void flushSeek();
    });
    playBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePlay(1);
    });
    slowBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePlay(0.25);
    });
    liveBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        expanded = false;
        void theatre.live();
    });

    const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && (state.crit || state.active)) {
            expanded = false;
            void theatre.live();
        }
    };
    window.addEventListener('keydown', onKey);

    const unsubscribe = theatre.subscribe((next) => {
        state = next;
        if (!next.available && !next.active) expanded = false;
        render();
    });

    return {
        open() {
            expanded = true;
            render();
        },
        close() {
            expanded = false;
            render();
        },
        destroy() {
            unsubscribe();
            window.removeEventListener('keydown', onKey);
            panel.destroy();
        },
    };
}
