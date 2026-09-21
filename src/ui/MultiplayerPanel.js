/**
 * Minimal multiplayer create / join / status panel.
 */
import { hudButton, hudInput } from './hudPanel.js';

/**
 * @param {{
 *   parent: HTMLElement,
 *   onCreate: () => Promise<{ code: string } | void> | { code: string } | void,
 *   onJoin: (code: string) => Promise<void> | void,
 *   onLeave?: () => void,
 *   touchUi?: boolean,
 * }} opts
 */
export function createMultiplayerPanel(opts) {
    const { parent, touchUi = false } = opts;

    const root = document.createElement('div');
    root.id = 'multiplayer-panel';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Multiplayer table');
    root.className = 'hud-divider hud-panel--multiplayer';
    if (touchUi) root.dataset.touch = 'true';

    const title = document.createElement('div');
    title.textContent = 'Table (multiplayer)';
    title.className = 'hud-panel--multiplayer__title';
    root.appendChild(title);

    const statusEl = document.createElement('div');
    statusEl.id = 'multiplayer-status';
    statusEl.className = 'hud-panel--multiplayer__status';
    statusEl.textContent = 'Idle';
    root.appendChild(statusEl);

    const btnRow = document.createElement('div');
    btnRow.className = 'hud-row hud-row--wrap hud-mt-xs';

    const createBtn = hudButton('Create table');
    const leaveBtn = hudButton('Leave');
    leaveBtn.style.display = 'none';

    btnRow.appendChild(createBtn);
    btnRow.appendChild(leaveBtn);
    root.appendChild(btnRow);

    const codeRow = document.createElement('div');
    codeRow.className = 'hud-panel--multiplayer__code-row hud-mt-xs';
    codeRow.style.display = 'none';

    const codeLabel = document.createElement('div');
    codeLabel.className = 'hud-panel--multiplayer__code-label';
    codeLabel.textContent = 'Room code';
    const codeValue = document.createElement('code');
    codeValue.className = 'hud-panel--multiplayer__code-value';

    const copyBtn = hudButton('Copy invite URL');

    codeRow.appendChild(codeLabel);
    codeRow.appendChild(codeValue);
    codeRow.appendChild(copyBtn);
    root.appendChild(codeRow);

    const joinRow = document.createElement('div');
    joinRow.className = 'hud-row hud-mt-xs';

    const joinInput = hudInput('text', 'Join room code');
    joinInput.placeholder = 'Room code';
    joinInput.maxLength = 8;
    joinInput.autocomplete = 'off';
    joinInput.spellcheck = false;
    joinInput.style.flex = '1';
    joinInput.style.minWidth = '0';

    const joinBtn = hudButton('Join');

    joinRow.appendChild(joinInput);
    joinRow.appendChild(joinBtn);
    root.appendChild(joinRow);

    const guestHint = document.createElement('div');
    guestHint.className = 'hud-panel--multiplayer__guest-hint hud-mt-xs';
    guestHint.style.display = 'none';
    guestHint.textContent = 'Only the host can roll.';
    root.appendChild(guestHint);

    let busy = false;

    createBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        createBtn.disabled = true;
        try {
            const result = await opts.onCreate();
            if (result && 'code' in result && result.code) {
                showCode(result.code);
            }
        } catch (err) {
            statusEl.textContent = err?.message ?? 'Create failed';
            statusEl.classList.add('hud-panel--multiplayer__status--error');
        } finally {
            busy = false;
            createBtn.disabled = false;
        }
    });

    joinBtn.addEventListener('click', async () => {
        if (busy) return;
        const code = joinInput.value.trim();
        if (!code) return;
        busy = true;
        joinBtn.disabled = true;
        try {
            await opts.onJoin(code);
            showCode(code.toUpperCase());
        } catch (err) {
            statusEl.textContent = err?.message ?? 'Join failed';
            statusEl.classList.add('hud-panel--multiplayer__status--error');
        } finally {
            busy = false;
            joinBtn.disabled = false;
        }
    });

    leaveBtn.addEventListener('click', () => {
        opts.onLeave?.();
        hideCode();
        guestHint.style.display = 'none';
        statusEl.classList.remove('hud-panel--multiplayer__status--error');
        statusEl.textContent = 'Idle';
    });

    copyBtn.addEventListener('click', async () => {
        const code = codeValue.textContent;
        if (!code) return;
        const url = new URL(window.location.href);
        url.searchParams.set('room', code);
        url.searchParams.delete('seed');
        try {
            await navigator.clipboard.writeText(url.toString());
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = 'Copy invite URL';
            }, 1200);
        } catch {
            copyBtn.textContent = 'Copy failed';
            setTimeout(() => {
                copyBtn.textContent = 'Copy invite URL';
            }, 1200);
        }
    });

    /**
     * @param {string} code
     */
    function showCode(code) {
        codeValue.textContent = code;
        codeRow.style.display = 'flex';
        leaveBtn.style.display = 'inline-block';
    }

    function hideCode() {
        codeRow.style.display = 'none';
        leaveBtn.style.display = 'none';
        codeValue.textContent = '';
    }

    /**
     * @param {object} state
     */
    function updateStatus(state) {
        const detail = state.statusDetail;
        const peers = state.connectedPeers?.length ?? 0;
        let text = detail;
        if (!text) {
            if (state.status === 'idle') text = 'Idle';
            else if (state.status === 'hosting') text = 'Hosting…';
            else if (state.status === 'joining') text = 'Joining…';
            else if (state.status === 'reconnecting') text = 'Reconnecting…';
            else if (state.status === 'connected' && state.role === 'host') {
                text = `Host · ${peers} connected`;
            } else if (state.status === 'connected') text = 'Guest · synced';
            else if (state.status === 'error') text = 'Error';
            else text = state.status;
        }
        statusEl.textContent = text;
        statusEl.classList.toggle(
            'hud-panel--multiplayer__status--error',
            state.status === 'error'
        );
        guestHint.style.display = state.role === 'guest' ? 'block' : 'none';
        if (state.roomCode) showCode(state.roomCode);
        if (state.status === 'idle') hideCode();
    }

    parent.appendChild(root);

    return {
        root,
        updateStatus,
        setJoinCode(code) {
            joinInput.value = code;
        },
        destroy() {
            root.remove();
        },
    };
}
