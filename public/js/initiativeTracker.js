// =========================================================
//  DND VTT – Initiative Tracker (DM Side)
//  - Sorted highest-first on add
//  - 🔔 button per row → set active + announce
// =========================================================

(function () {
  function waitForSocket(cb) {
    if (typeof io !== 'undefined') { cb(); }
    else { setTimeout(() => waitForSocket(cb), 100); }
  }

  waitForSocket(() => {
    const socket = io({ query: { role: 'dm' } });

    const state = {
      players: [],
      activeIndex: -1,
      round: 1
    };

    const nameInput = document.getElementById('init-name');
    const valInput  = document.getElementById('init-val');
    const addBtn    = document.getElementById('add-init-btn');
    const prevBtn   = document.getElementById('prev-init-btn');
    const nextBtn   = document.getElementById('next-init-btn');
    const resetBtn  = document.getElementById('reset-init-btn');
    const clearBtn  = document.getElementById('clear-init-btn');
    const list      = document.getElementById('init-list');
    const roundDisplay = document.getElementById('init-round-display');

    // ── Add player ──────────────────────────────────────
    function addPlayer() {
      const name = nameInput.value.trim();
      const init = parseInt(valInput.value);
      if (!name || isNaN(init)) return;
      state.players.push({ name, init });
      // Always sort highest first
      state.players.sort((a, b) => b.init - a.init);
      nameInput.value = '';
      valInput.value  = '';
      nameInput.focus();
      broadcast();
    }

    addBtn.addEventListener('click', addPlayer);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
    valInput.addEventListener('keydown',  e => { if (e.key === 'Enter') addPlayer(); });

    resetBtn.addEventListener('click', () => {
      state.activeIndex = 0;
      state.round = 1;
      broadcast();
    });

    nextBtn.addEventListener('click', () => {
      if (!state.players.length) return;
      if (state.activeIndex < 0) {
        state.activeIndex = 0;
      } else if (state.activeIndex >= state.players.length - 1) {
        state.activeIndex = 0;
        state.round += 1;
      } else {
        state.activeIndex += 1;
      }
      broadcast();
    });

    prevBtn.addEventListener('click', () => {
      if (!state.players.length) return;
      if (state.activeIndex <= 0) {
        state.activeIndex = state.players.length - 1;
        state.round = Math.max(1, state.round - 1);
      } else {
        state.activeIndex -= 1;
      }
      broadcast();
    });

    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear all initiative entries?')) return;
      state.players     = [];
      state.activeIndex = -1;
      state.round = 1;
      broadcast();
    });

    // ── Broadcast ────────────────────────────────────────
    let lastBroadcastActive = -1;
    function broadcast() {
      renderList();
      renderRound();
      // Show local flourish for DM when active turn changes
      if (state.activeIndex !== lastBroadcastActive && state.activeIndex >= 0 && state.players.length > 0) {
        showInitFlourish(state.players[state.activeIndex].name);
        lastBroadcastActive = state.activeIndex;
      }
      socket.emit('updateInitiative', { players: state.players, activeIndex: state.activeIndex, round: state.round });
    }

    function renderRound() {
      if (roundDisplay) roundDisplay.textContent = `Round ${state.round || 1}`;
    }

    // ── Render list ──────────────────────────────────────
    function renderList() {
      list.innerHTML = '';
      state.players.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = 'init-row' + (i === state.activeIndex ? ' init-active' : '');

        li.innerHTML = `
          <span class="init-num">${i + 1}</span>
          <input class="init-edit-name" value="${p.name}">
          <input class="init-edit-val"  value="${p.init}" type="number">
          <button class="init-announce-btn" title="Announce turn"><i class="fa-solid fa-bell"></i></button>
          <button class="init-remove-btn"   title="Remove">✕</button>`;

        // 🔔 Announce → set active turn
        li.querySelector('.init-announce-btn').addEventListener('click', () => {
          state.activeIndex = i;
          broadcast();
        });

        // Inline edit – name
        li.querySelector('.init-edit-name').addEventListener('change', e => {
          state.players[i].name = e.target.value.trim() || p.name;
          broadcast();
        });

        // Inline edit – init value (re-sort on change)
        li.querySelector('.init-edit-val').addEventListener('change', e => {
          const v = parseInt(e.target.value);
          if (!isNaN(v)) {
            state.players[i].init = v;
            state.players.sort((a, b) => b.init - a.init);
            state.activeIndex = -1;
            broadcast();
          }
        });

        // Remove
        li.querySelector('.init-remove-btn').addEventListener('click', () => {
          state.players.splice(i, 1);
          if (state.activeIndex >= state.players.length)
            state.activeIndex = Math.max(0, state.players.length - 1);
          broadcast();
        });

        list.appendChild(li);
      });
    }

    // ── DM-side flourish for initiative ──────────────────
    function showInitFlourish(name) {
      if (window.VTT_CALLOUTS) {
        window.VTT_CALLOUTS.show(`${name}'s Turn`, { type: 'initiative' });
      }
    }
  });
})();
