/**
 * DOM affordances for the XR spike: Enter VR button + hide desktop help while presenting.
 */

/**
 * @param {object} options
 * @param {() => Promise<void>} options.onEnter
 * @param {() => void} [options.onExit]
 * @returns {{
 *   button: HTMLButtonElement;
 *   setPresenting: (presenting: boolean) => void;
 *   setSupported: (supported: boolean) => void;
 *   dispose: () => void;
 * }}
 */
export function createXrUi({ onEnter, onExit }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'xr-enter-vr';
    button.textContent = 'Enter VR';
    button.setAttribute('aria-label', 'Enter VR');
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
        button.textContent = presenting ? 'Exit VR' : 'Enter VR';
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
        dispose() {
            button.remove();
        },
    };
}
