/**
 * The one visible surface for "something broke": a banner with a message and
 * a reload action. It is deliberately plain DOM with inline styles — it must
 * work when the HUD stylesheet, the renderer or half the app did not load.
 */

export interface ErrorBannerAction {
    label: string;
    run: () => void;
}

export interface ErrorBannerOptions {
    /** One short line a player can read. */
    message: string;
    /** Technical detail (first failing source / message), shown small. */
    detail?: string;
    actions?: ErrorBannerAction[];
    /** `status` for news that is not a fault (an update is ready). Fixed when the banner is created. */
    role?: 'alert' | 'status';
}

export const ERROR_BANNER_ID = 'app-error-banner';

/** Distinct problems listed at once; the rest are summarised. */
const MAX_LINES = 3;

function styleButton(btn: HTMLButtonElement, primary: boolean): void {
    btn.style.cssText = [
        'font: inherit',
        'cursor: pointer',
        'padding: 6px 14px',
        'border-radius: 4px',
        `border: 1px solid ${primary ? '#ff9933' : '#777'}`,
        `background: ${primary ? '#ff9933' : 'transparent'}`,
        `color: ${primary ? '#1a0f08' : '#eee'}`,
        'min-height: 32px',
    ].join(';');
}

/**
 * Show (or extend) the banner. A second call adds a line instead of stacking
 * a second banner, so a burst of failures is one box, not a wall of them.
 */
export function showErrorBanner(
    options: ErrorBannerOptions,
    doc: Document = document
): HTMLElement | null {
    const host = doc.body ?? doc.documentElement;
    if (!host) return null;

    let banner = doc.getElementById(ERROR_BANNER_ID);
    if (!banner) {
        banner = doc.createElement('div');
        banner.id = ERROR_BANNER_ID;
        banner.setAttribute('role', options.role ?? 'alert');
        banner.style.cssText = [
            'position: fixed',
            'left: 50%',
            'bottom: 16px',
            'transform: translateX(-50%)',
            'z-index: 10000',
            'box-sizing: border-box',
            'max-width: min(560px, calc(100vw - 32px))',
            'padding: 12px 16px',
            'background: rgba(26, 15, 8, 0.96)',
            'color: #f4e6d0',
            'border: 1px solid #ff9933',
            'border-radius: 8px',
            'font: 14px/1.4 system-ui, sans-serif',
            'box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6)',
        ].join(';');
        const list = doc.createElement('div');
        list.dataset.role = 'lines';
        const bar = doc.createElement('div');
        bar.dataset.role = 'actions';
        bar.style.cssText = 'display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap';
        banner.append(list, bar);
        host.appendChild(banner);
    }

    const list = banner.querySelector<HTMLElement>('[data-role="lines"]');
    const bar = banner.querySelector<HTMLElement>('[data-role="actions"]');
    if (!list || !bar) return banner;

    const lines = Array.from(list.querySelectorAll<HTMLElement>('[data-line]'));
    const known = lines.find((l) => l.dataset.line === options.message);
    if (!known) {
        if (lines.length < MAX_LINES) {
            const line = doc.createElement('div');
            line.dataset.line = options.message;
            const strong = doc.createElement('strong');
            strong.textContent = options.message;
            line.appendChild(strong);
            if (options.detail) {
                const small = doc.createElement('div');
                small.textContent = options.detail;
                small.style.cssText = 'opacity: 0.7; font-size: 12px; word-break: break-word';
                line.appendChild(small);
            }
            list.appendChild(line);
        } else {
            let more = list.querySelector<HTMLElement>('[data-more]');
            if (!more) {
                more = doc.createElement('div');
                more.dataset.more = '0';
                more.style.cssText = 'opacity: 0.7; font-size: 12px';
                list.appendChild(more);
            }
            const n = Number(more.dataset.more) + 1;
            more.dataset.more = String(n);
            more.textContent = `…and ${n} more (see the console)`;
        }
    }

    // Actions are replaced, not appended: the latest problem decides the remedy.
    if (options.actions) {
        bar.textContent = '';
        options.actions.forEach((action, i) => {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.textContent = action.label;
            styleButton(btn, i === 0);
            btn.addEventListener('click', action.run);
            bar.appendChild(btn);
        });
        const dismiss = doc.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Dismiss';
        styleButton(dismiss, false);
        dismiss.addEventListener('click', () => hideErrorBanner(doc));
        bar.appendChild(dismiss);
    }
    return banner;
}

export function hideErrorBanner(doc: Document = document): void {
    doc.getElementById(ERROR_BANNER_ID)?.remove();
}
