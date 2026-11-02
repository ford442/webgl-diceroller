/**
 * A visible, dismissible notice that a link or room refers to a different table
 * than the one this page built (#369): the collider-world hash did not match,
 * so replaying would silently produce another roll.
 */

const BADGE_ID = 'table-mismatch-badge';

/**
 * @param {string} message
 * @param {{ detail?: string }} [options] hover text (e.g. both hashes)
 * @returns {HTMLElement | null}
 */
export function showTableMismatchBadge(message, { detail = '' } = {}) {
    if (typeof document === 'undefined') return null;
    document.getElementById(BADGE_ID)?.remove();

    const badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.setAttribute('role', 'alert');
    badge.textContent = message;
    badge.title = detail ? `${detail}\n(click to dismiss)` : 'Click to dismiss';
    Object.assign(badge.style, {
        position: 'absolute',
        bottom: '36px',
        left: '10px',
        zIndex: '1100',
        maxWidth: 'min(90vw, 420px)',
        padding: '6px 10px',
        borderRadius: '5px',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '1.35',
        cursor: 'pointer',
        backgroundColor: 'rgba(140, 20, 20, 0.88)',
        color: '#ffd9d9',
    });
    badge.addEventListener('click', () => badge.remove());
    (document.getElementById('canvas-container') ?? document.body).appendChild(badge);
    return badge;
}
