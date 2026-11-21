/**
 * DOM affordances for XR: Enter VR / Enter AR button + hide desktop help while presenting.
 */

import { xrButtonLabel } from './XrSessionOptions.js';

/**
 * @param {object} options
 * @param {'immersive-vr' | 'immersive-ar'} [options.mode]
 * @param {() => Promise<void>} options.onEnter
 * @param {() => void} [options.onExit]
 * @returns {{
 *   button: HTMLButtonElement;
 *   setPresenting: (presenting: boolean) => void;
 *   setSupported: (supported: boolean) => void;
 *   setError: (message: string | null) => void;
 *   dispose: () => void;
 * }}
 */
export function createXrUi({ mode = 'immersive-vr', onEnter, onExit }) {
    const button = document.createElement('button');
    button.type = 'button';
    // Stable id for automation; `#xr-enter-vr` predates `?ar`.
    button.id = 'xr-enter-vr';
    button.dataset.xrMode = mode;
    button.textContent = xrButtonLabel(mode, false);
    button.setAttribute('aria-label', xrButtonLabel(mode, false));
    Object.assign(button.style, {
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        zIndex: '1100',
        padding: '12px 18px',
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '15px',
        letterSpacing: '0.04em',
        color: '#f5e6c8',
        background: 'linear-gradient(180deg, #5c3d1e 0%, #3a2410 100%)',
        border: '1px solid #c4a574',
        borderRadius: '4px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
        display: 'none',
    });

    let supported = false;
    let presenting = false;

    function sync() {
        if (!supported) {
            button.style.display = 'none';
            return;
        }
        button.style.display = presenting ? 'none' : 'block';
        const label = xrButtonLabel(mode, presenting);
        button.textContent = label;
        button.setAttribute('aria-label', label);
    }

    button.addEventListener('click', () => {
        if (presenting) {
            onExit?.();
        } else {
            void onEnter();
        }
    });

    const canvasContainer = document.getElementById('canvas-container') ?? document.body;
    canvasContainer.appendChild(button);

    /** @type {HTMLElement | null} */
    let helpEl = null;
    function findHelp() {
        if (helpEl) return helpEl;
        const container = document.getElementById('canvas-container');
        if (!container) return null;
        for (const child of Array.from(container.children)) {
            if (
                child instanceof HTMLElement &&
                child !== button &&
                child.style?.position === 'absolute' &&
                child.innerHTML?.includes('Right Click')
            ) {
                helpEl = child;
                return helpEl;
            }
        }
        return null;
    }

    return {
        button,
        setPresenting(next) {
            presenting = next;
            sync();
            const help = findHelp();
            if (help) help.style.display = next ? 'none' : '';
        },
        setSupported(next) {
            supported = next;
            sync();
        },
        setError(message) {
            // Shown as a tooltip; the session-start failure is also logged.
            button.title = message ? `XR failed: ${message}` : '';
            button.dataset.xrError = message ?? '';
        },
        dispose() {
            button.remove();
        },
    };
}
