/**
 * `?debug` / `?boot-trace`: show the boot trace under the loading bar, so the
 * active phase (and what each tier cost) is on screen while it happens.
 *
 * Text only, rewritten on each span boundary; the overlay node is removed with
 * `#loading-overlay` when the page is ready, and the same text is logged once
 * as `[BootTrace]` (see LoadingTiers) for after the fact.
 */
import type { BootTrace } from './BootTrace';

export function installBootTraceOverlay(
    trace: BootTrace,
    doc: Document = document
): (() => void) | null {
    let element: HTMLPreElement | null = null;
    let unsubscribe: (() => void) | null = null;

    const render = () => {
        if (!element) return;
        if (!element.isConnected) {
            // The overlay is not in the DOM yet (the script ran before parse
            // finished) or has been removed: stop updating a detached node.
            const host = doc.getElementById('loading-overlay');
            if (!host) {
                unsubscribe?.();
                return;
            }
            host.appendChild(element);
        }
        element.textContent = trace.format();
    };

    const mount = () => {
        element = doc.createElement('pre');
        element.id = 'boot-trace';
        element.setAttribute('aria-hidden', 'true');
        element.style.cssText =
            'margin:1.5rem 0 0;max-width:90vw;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;' +
            'color:#8a8a8a;white-space:pre-wrap;text-align:left';
        unsubscribe = trace.onChange(render);
        render();
    };

    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
        mount();
    }
    return () => unsubscribe?.();
}
