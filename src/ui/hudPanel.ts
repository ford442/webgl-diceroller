/**
 * Shared HUD panel primitive — the one place that knows how to build a
 * `position:absolute` box over the 3D canvas with a header, an optional
 * collapse toggle, an anchor, and the touch/desktop control sizing rules.
 * Everything else (dice controls, dice case, roll history, session strip,
 * multiplayer, fairness monitor) builds on this instead of re-declaring
 * `rgba(0,0,0,0.5)` / `z-index:1000` / `font-family:sans-serif` locally.
 *
 * Styling lives in `hud.css`; this file only wires up structure, ARIA and
 * the small bits of behaviour (collapse, focus trap, drag-through guard).
 */

export type HudAnchor =
    'top-right' | 'top-left' | 'bottom-left' | 'bottom-center' | 'center-left' | 'none';

export type HudPanelVariant = 'default' | 'display' | 'scrim' | 'bare';

export interface HudPanelOptions {
    /** Element id for the outer panel (useful for tests / query hooks). */
    id?: string;
    /** Required — every HUD panel is a labelled landmark for screen readers. */
    ariaLabel: string;
    /** ARIA role for the outer element. Defaults to 'region'. */
    role?: string;
    /** Where the panel docks. Defaults to 'none' (caller positions it). */
    anchor?: HudAnchor;
    /** Visual flavor: 'display' = serif tavern font, 'scrim' = opaque overlay, 'bare' = no chrome. */
    variant?: HudPanelVariant;
    /** Extra class names on the outer element. */
    className?: string;
    /** Parent to mount into. Defaults to #canvas-container. */
    parent?: HTMLElement | null;
    /** Shows a header row with this title text. */
    title?: string;
    /** Adds a −/+ collapse button to the header (implies a title unless one is given). */
    collapsible?: boolean;
    /** Initial collapsed state. */
    collapsed?: boolean;
    /** Called after the collapsed state changes. */
    onCollapseChange?: (collapsed: boolean) => void;
    /** True on touch-primary devices — flips [data-touch] sizing rules. */
    touchUi?: boolean;
    /** Sets `pointer-events: none` on the panel (click-through informational HUDs). */
    pointerEventsNone?: boolean;
}

export interface HudPanel {
    /** The panel's outer element. */
    el: HTMLElement;
    /** The header row, or null when no title/collapsible was requested. */
    header: HTMLElement | null;
    /** Content container — append panel content here. Hidden when collapsed. */
    body: HTMLElement;
    /** The collapse toggle button, or null when not collapsible. */
    collapseButton: HTMLButtonElement | null;
    setCollapsed(collapsed: boolean): void;
    isCollapsed(): boolean;
    destroy(): void;
}

function defaultParent(): HTMLElement {
    return document.getElementById('canvas-container') ?? document.body;
}

/** Stops a HUD control's mouse/touch interaction from also driving the 3D drag/orbit controls. */
export function guardPointerEvents(el: HTMLElement): void {
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
}

/** Convenience: a `<button>` with the shared HUD button class, guarded against drag-through. */
export function hudButton(text: string, extraClass = ''): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = extraClass ? `hud-btn ${extraClass}` : 'hud-btn';
    btn.textContent = text;
    guardPointerEvents(btn);
    return btn;
}

/** Convenience: a labelled `<select>` with the shared HUD select class, guarded against drag-through. */
export function hudSelect(ariaLabel: string): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'hud-select';
    select.setAttribute('aria-label', ariaLabel);
    guardPointerEvents(select);
    return select;
}

/** Convenience: an `<input>` with the shared HUD input class, guarded against drag-through. */
export function hudInput(type: string, ariaLabel: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = type;
    input.className = 'hud-input';
    input.setAttribute('aria-label', ariaLabel);
    guardPointerEvents(input);
    return input;
}

const VARIANT_CLASS: Record<HudPanelVariant, string> = {
    default: '',
    display: 'hud-panel--display',
    scrim: 'hud-panel--scrim',
    bare: 'hud-panel--bare',
};

export function createHudPanel(options: HudPanelOptions): HudPanel {
    const {
        id,
        ariaLabel,
        role = 'region',
        anchor = 'none',
        variant = 'default',
        className = '',
        parent = defaultParent(),
        title,
        collapsible = false,
        collapsed = false,
        onCollapseChange,
        touchUi = false,
        pointerEventsNone = false,
    } = options;

    const el = document.createElement('div');
    if (id) el.id = id;
    el.className = ['hud-panel', VARIANT_CLASS[variant], className].filter(Boolean).join(' ');
    el.setAttribute('role', role);
    el.setAttribute('aria-label', ariaLabel);
    el.dataset.hudAnchor = anchor;
    if (touchUi) el.dataset.touch = 'true';
    if (pointerEventsNone) el.style.pointerEvents = 'none';

    let header: HTMLElement | null = null;
    let collapseButton: HTMLButtonElement | null = null;
    let isCollapsedState = collapsed;

    if (title || collapsible) {
        header = document.createElement('div');
        header.className = 'hud-panel__header';

        const titleEl = document.createElement('div');
        titleEl.className = 'hud-panel__title';
        titleEl.textContent = title ?? '';
        header.appendChild(titleEl);

        if (collapsible) {
            collapseButton = document.createElement('button');
            collapseButton.type = 'button';
            collapseButton.className = 'hud-btn hud-btn--collapse';
            collapseButton.title = `Collapse ${ariaLabel}`;
            guardPointerEvents(collapseButton);
            collapseButton.addEventListener('click', () => setCollapsed(!isCollapsedState));
            header.appendChild(collapseButton);
        }

        el.appendChild(header);
    }

    const body = document.createElement('div');
    body.className = 'hud-panel__body';
    el.appendChild(body);

    function setCollapsed(next: boolean) {
        isCollapsedState = next;
        body.hidden = next;
        if (collapseButton) {
            collapseButton.textContent = next ? '+' : '−';
        }
        onCollapseChange?.(next);
    }

    setCollapsed(isCollapsedState);
    parent?.appendChild(el);

    return {
        el,
        header,
        body,
        collapseButton,
        setCollapsed,
        isCollapsed: () => isCollapsedState,
        destroy: () => el.remove(),
    };
}
