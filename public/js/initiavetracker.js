// =========================================================
//  DND VTT – Initiative Tracker (Enhanced)
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
    // Open / Close modal
    document.getElementById('init-tracker-btn').addEventListener('click', () => {
        document.getElementById('init-modal').classList.remove('hidden');
    });
    document.querySelector('.close-modal').addEventListener('click', () => {
        document.getElementById('init-modal').classList.add('hidden');
    });

    // Add player on button click or Enter key
    document.getElementById('add-init-btn').addEventListener('click', addPlayer);
    document.getElementById('init-name').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
    document.getElementById('init-val').addEventListener('keydown',  e => { if (e.key === 'Enter') addPlayer(); });

    // Reset button – go back to first player
    document.getElementById('reset-init-btn').addEventListener('click', resetOrder);

    // Clear all
    document.getElementById('clear-init-btn').addEventListener('click', () => {
        if (!confirm('Clear all combatants?')) return;
        window.VTT.tracker.players = [];
        window.VTT.tracker.activePlayerIndex = -1;
        renderTracker();
        renderPlaySidebar();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'INPUT') return;
        if (e.altKey && e.key === '[') { e.preventDefault(); cycleTurn(-1); }
        if (e.altKey && e.key === ']') { e.preventDefault(); cycleTurn(1);  }
    });

    renderTracker();
    renderPlaySidebar();
});

// ---------------------------------------------------------
//  Add / Reset
// ---------------------------------------------------------
function addPlayer() {
    const nameEl = document.getElementById('init-name');
    const valEl  = document.getElementById('init-val');
    const name = nameEl.value.trim();
    const init = parseInt(valEl.value);
    if (!name || isNaN(init)) return;

    window.VTT.tracker.players.push({ name, init });
    window.VTT.tracker.players.sort((a, b) => b.init - a.init);

    nameEl.value = '';
    valEl.value  = '';
    nameEl.focus();

    renderTracker();
    renderPlaySidebar();
}

function resetOrder() {
    window.VTT.tracker.activePlayerIndex = 0;
    renderTracker();
    renderPlaySidebar();
    if (window.VTT.tracker.players.length > 0) {
        showFlourish(window.VTT.tracker.players[0].name);
    }
}

// ---------------------------------------------------------
//  Render – Modal list
// ---------------------------------------------------------
function renderTracker() {
    const ul = document.getElementById('init-list');
    ul.innerHTML = '';

    window.VTT.tracker.players.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = i === window.VTT.tracker.activePlayerIndex ? 'active-turn' : '';

        li.innerHTML = `
            <span class="init-order-num">${i + 1}</span>
            <input class="init-edit-name" value="${p.name}" title="Click to edit name">
            <input class="init-edit-val"  value="${p.init}" type="number" title="Click to edit initiative">
            <button class="remove-btn" title="Remove">✕</button>
        `;

        // Inline edit – name
        li.querySelector('.init-edit-name').addEventListener('change', (e) => {
            window.VTT.tracker.players[i].name = e.target.value.trim() || p.name;
            renderPlaySidebar();
        });

        // Inline edit – initiative (re-sort list)
        li.querySelector('.init-edit-val').addEventListener('change', (e) => {
            const newVal = parseInt(e.target.value);
            if (!isNaN(newVal)) {
                window.VTT.tracker.players[i].init = newVal;
                window.VTT.tracker.players.sort((a, b) => b.init - a.init);
                // Reset active index so sort doesn't confuse us
                window.VTT.tracker.activePlayerIndex = -1;
                renderTracker();
                renderPlaySidebar();
            }
        });

        // Remove
        li.querySelector('.remove-btn').addEventListener('click', () => {
            window.VTT.tracker.players.splice(i, 1);
            if (window.VTT.tracker.activePlayerIndex >= window.VTT.tracker.players.length) {
                window.VTT.tracker.activePlayerIndex = Math.max(0, window.VTT.tracker.players.length - 1);
            }
            renderTracker();
            renderPlaySidebar();
        });

        ul.appendChild(li);
    });
}

// ---------------------------------------------------------
//  Render – Play Mode sidebar overlay
// ---------------------------------------------------------
function renderPlaySidebar() {
    let sidebar = document.getElementById('play-init-sidebar');
    if (!sidebar) {
        sidebar = document.createElement('div');
        sidebar.id = 'play-init-sidebar';
        document.getElementById('canvas-container').appendChild(sidebar);
    }

    sidebar.innerHTML = '';

    if (!window.VTT.tracker.players.length) {
        sidebar.style.display = 'none';
        return;
    }
    sidebar.style.display = 'block';

    const title = document.createElement('div');
    title.className = 'play-sidebar-title';
    title.textContent = 'Initiative';
    sidebar.appendChild(title);

    window.VTT.tracker.players.forEach((p, i) => {
        const row = document.createElement('div');
        const isActive = i === window.VTT.tracker.activePlayerIndex;
        row.className = 'play-sidebar-row' + (isActive ? ' active' : '');
        row.innerHTML = `
            <span class="play-sidebar-num">${i + 1}</span>
            <span class="play-sidebar-name">${p.name}</span>
            <span class="play-sidebar-init">${p.init}</span>
        `;
        sidebar.appendChild(row);
    });
}

// ---------------------------------------------------------
//  Cycle Turns
// ---------------------------------------------------------
function cycleTurn(dir) {
    const players = window.VTT.tracker.players;
    if (!players.length) return;

    if (window.VTT.tracker.activePlayerIndex === -1) {
        window.VTT.tracker.activePlayerIndex = 0;
    } else {
        window.VTT.tracker.activePlayerIndex += dir;
        if (window.VTT.tracker.activePlayerIndex >= players.length) window.VTT.tracker.activePlayerIndex = 0;
        if (window.VTT.tracker.activePlayerIndex < 0) window.VTT.tracker.activePlayerIndex = players.length - 1;
    }

    renderTracker();
    renderPlaySidebar();
    showFlourish(players[window.VTT.tracker.activePlayerIndex].name);
}

// ---------------------------------------------------------
//  Flourish Overlay
// ---------------------------------------------------------
function showFlourish(name) {
    const overlay = document.getElementById('active-player-overlay');
    const title   = document.getElementById('active-player-name');

    title.textContent = `${name}'s Turn!`;
    overlay.classList.remove('hidden');

    title.style.animation = 'none';
    void title.offsetWidth; // reflow
    title.style.animation  = '';

    clearTimeout(window.VTT._flourishTimer);
    window.VTT._flourishTimer = setTimeout(() => overlay.classList.add('hidden'), 3000);
}
