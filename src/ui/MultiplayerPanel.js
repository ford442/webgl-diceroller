/**
 * Minimal multiplayer create / join / status panel.
 */

const GOLD = '#e8c882';
const GOLD_DARK = '#8B6914';
const BG = 'rgba(20, 10, 0, 0.55)';

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
    root.style.marginTop = '8px';
    root.style.paddingTop = '8px';
    root.style.borderTop = `1px solid ${GOLD_DARK}`;
    root.style.fontSize = touchUi ? '14px' : '12px';

    const title = document.createElement('div');
    title.textContent = 'Table (multiplayer)';
    title.style.fontWeight = 'bold';
    title.style.color = GOLD;
    title.style.marginBottom = '6px';
    root.appendChild(title);

    const statusEl = document.createElement('div');
    statusEl.id = 'multiplayer-status';
    statusEl.style.color = '#ccc';
    statusEl.style.marginBottom = '6px';
    statusEl.style.minHeight = '1.2em';
    statusEl.textContent = 'Idle';
    root.appendChild(statusEl);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.flexWrap = 'wrap';
    btnRow.style.gap = '6px';
    btnRow.style.marginBottom = '6px';

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = 'Create table';
    styleButton(createBtn, touchUi);

    const leaveBtn = document.createElement('button');
    leaveBtn.type = 'button';
    leaveBtn.textContent = 'Leave';
    leaveBtn.style.display = 'none';
    styleButton(leaveBtn, touchUi);

    btnRow.appendChild(createBtn);
    btnRow.appendChild(leaveBtn);
    root.appendChild(btnRow);

    const codeRow = document.createElement('div');
    codeRow.style.display = 'none';
    codeRow.style.flexDirection = 'column';
    codeRow.style.gap = '4px';
    codeRow.style.marginBottom = '6px';

    const codeLabel = document.createElement('div');
    codeLabel.style.color = GOLD;
    codeLabel.textContent = 'Room code';
    const codeValue = document.createElement('code');
    codeValue.style.display = 'block';
    codeValue.style.padding = '4px 6px';
    codeValue.style.background = BG;
    codeValue.style.borderRadius = '3px';
    codeValue.style.letterSpacing = '0.12em';
    codeValue.style.fontSize = '14px';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy invite URL';
    styleButton(copyBtn, touchUi);

    codeRow.appendChild(codeLabel);
    codeRow.appendChild(codeValue);
    codeRow.appendChild(copyBtn);
    root.appendChild(codeRow);

    const joinRow = document.createElement('div');
    joinRow.style.display = 'flex';
    joinRow.style.gap = '6px';
    joinRow.style.alignItems = 'center';

    const joinInput = document.createElement('input');
    joinInput.type = 'text';
    joinInput.placeholder = 'Room code';
    joinInput.setAttribute('aria-label', 'Join room code');
    joinInput.maxLength = 8;
    joinInput.autocomplete = 'off';
    joinInput.spellcheck = false;
    joinInput.style.flex = '1';
    joinInput.style.minWidth = '0';
    joinInput.style.padding = '4px 6px';
    joinInput.style.background = BG;
    joinInput.style.border = `1px solid ${GOLD_DARK}`;
    joinInput.style.color = '#fff';
    joinInput.style.borderRadius = '3px';
    joinInput.style.fontSize = touchUi ? '16px' : '12px';
    joinInput.style.minHeight = touchUi ? '44px' : 'auto';
    joinInput.addEventListener('mousedown', (e) => e.stopPropagation());

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.textContent = 'Join';
    styleButton(joinBtn, touchUi);

    joinRow.appendChild(joinInput);
    joinRow.appendChild(joinBtn);
    root.appendChild(joinRow);

    const guestHint = document.createElement('div');
    guestHint.style.display = 'none';
    guestHint.style.marginTop = '6px';
    guestHint.style.color = '#aaa';
    guestHint.style.fontStyle = 'italic';
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
            statusEl.style.color = '#f88';
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
            statusEl.style.color = '#f88';
        } finally {
            busy = false;
            joinBtn.disabled = false;
        }
    });

    leaveBtn.addEventListener('click', () => {
        opts.onLeave?.();
        hideCode();
        guestHint.style.display = 'none';
        statusEl.style.color = '#ccc';
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
        statusEl.style.color = state.status === 'error' ? '#f88' : '#ccc';
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

/**
 * @param {HTMLButtonElement} btn
 * @param {boolean} touchUi
 */
function styleButton(btn, touchUi) {
    btn.style.cursor = 'pointer';
    btn.style.padding = touchUi ? '10px 12px' : '4px 8px';
    btn.style.minHeight = touchUi ? '44px' : 'auto';
    btn.style.background = BG;
    btn.style.border = `1px solid ${GOLD_DARK}`;
    btn.style.color = GOLD;
    btn.style.borderRadius = '3px';
    btn.style.fontSize = touchUi ? '14px' : '12px';
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
}
