// =========================================================
//  DND VTT – Initiative Tracker (DM Side)
//  - Reads combatants from the per-scene turn tracker
//  - Tokens with an initiative value appear automatically
//  - DM can only advance/reset turns and toggle skipped/KO rows
// =========================================================

(function () {
  const DM_POLL_MS = 200;
  const MAX_POLL = 50;
  let pollCount = 0;

  function waitForDM(cb) {
    if (window.VTT_DM && window.VTT_DM.socket && window.VTT_DM.sceneManager) {
      cb();
    } else if (pollCount < MAX_POLL) {
      pollCount += 1;
      setTimeout(() => waitForDM(cb), DM_POLL_MS);
    } else {
      // Fallback to a standalone DM socket if the main DM module isn't loaded
      cb(true);
    }
  }

  waitForDM((fallback = false) => {
    const socket = fallback ? io({ query: { role: 'dm' } }) : window.VTT_DM.socket;
    const sceneManager = fallback ? null : window.VTT_DM.sceneManager;

    const state = {
      sceneId: null,
      tokens: [],
      turnTracker: { order: [], activeIndex: 0, round: 1 },
    };

    const prevBtn = document.getElementById('prev-init-btn');
    const nextBtn = document.getElementById('next-init-btn');
    const resetBtn = document.getElementById('reset-init-btn');
    const clearBtn = document.getElementById('clear-init-btn');
    const titleInput = document.getElementById('init-title');
    const list = document.getElementById('init-list');
    const roundDisplay = document.getElementById('init-round-display');

    function currentScene() {
      return sceneManager ? sceneManager.currentScene : null;
    }

    function updateFromScene(scene) {
      if (!scene || !scene.sceneId) return;
      state.sceneId = scene.sceneId;
      state.tokens = scene.tokens || [];
      state.turnTracker = scene.turnTracker || { order: [], activeIndex: 0, round: 1, title: '' };
      render();
    }

    function updateFromTracker(turnTracker) {
      if (!turnTracker) return;
      state.turnTracker = turnTracker;
      render();
    }

    if (titleInput) {
      titleInput.addEventListener('change', () => {
        send('setTurnTrackerTitle', { title: titleInput.value });
      });
    }

    socket.on('sceneData', (scene) => {
      updateFromScene(scene);
    });

    socket.on('turnTrackerUpdate', ({ sceneId, turnTracker }) => {
      if (sceneId && sceneId !== state.sceneId) return;
      updateFromTracker(turnTracker);
    });

    socket.on('activeSceneId', (sceneId) => {
      if (!sceneId) return;
      socket.emit('loadScene', { sceneId });
    });

    function send(event, payload) {
      if (!state.sceneId) return;
      socket.emit(event, { ...payload, sceneId: state.sceneId });
    }

    prevBtn.addEventListener('click', () => send('previousTurn', {}));
    nextBtn.addEventListener('click', () => send('advanceTurn', {}));
    resetBtn.addEventListener('click', () => send('resetTurnTracker', {}));
    clearBtn.addEventListener('click', () => {
      if (!state.sceneId) return;
      if (!confirm('Clear all initiative values for this scene?')) return;
      send('clearSceneInitiative', {});
    });

    function tokenForEntry(entry) {
      return state.tokens.find((t) => t.tokenId === entry.tokenId) || null;
    }

    function render() {
      renderTitle();
      renderRound();
      renderList();
    }

    function renderTitle() {
      if (!titleInput) return;
      const title = state.turnTracker.title || '';
      if (document.activeElement !== titleInput) {
        titleInput.value = title;
      }
    }

    function renderRound() {
      if (roundDisplay) {
        roundDisplay.textContent = `Round ${state.turnTracker.round || 1}`;
      }
    }

    function renderList() {
      if (!list) return;
      list.innerHTML = '';
      const order = state.turnTracker.order || [];
      const activeIndex = Math.max(0, Math.min(state.turnTracker.activeIndex || 0, order.length - 1));

      order.forEach((entry, i) => {
        const token = tokenForEntry(entry);
        const name = token ? token.name : 'Unknown';
        const init = entry.initiative;
        const isActive = i === activeIndex;
        const isDisabled = !!entry.disabled;

        const li = document.createElement('li');
        li.className = 'init-row' + (isActive ? ' init-active' : '') + (isDisabled ? ' init-disabled' : '');
        li.dataset.tokenId = entry.tokenId;
        li.title = isDisabled ? 'Skipped this turn' : '';

        li.innerHTML = `
          <span class="init-num">${i + 1}</span>
          <span class="init-name">${escapeHtml(name)}</span>
          <span class="init-val">${init}</span>
          <button class="init-skip-btn" title="Skip/KO this combatant"><i class="fa-solid ${isDisabled ? 'fa-play' : 'fa-pause'}"></i></button>
        `;

        li.querySelector('.init-skip-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          send('toggleTurnTrackerEntry', { tokenId: entry.tokenId });
        });

        li.addEventListener('dblclick', () => {
          if (!isDisabled) send('setActiveTurn', { tokenId: entry.tokenId });
        });

        list.appendChild(li);
      });

      const activeEntry = order[activeIndex];
      if (activeEntry) {
        const token = tokenForEntry(activeEntry);
        if (token && token.name) {
          showInitFlourish(token.name);
        }
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function showInitFlourish(name) {
      if (window.VTT_CALLOUTS) {
        window.VTT_CALLOUTS.show(`${name}'s Turn`, { type: 'initiative' });
      }
    }

    // Load the current scene once at startup if the DM page already has one.
    const scene = currentScene();
    if (scene) {
      updateFromScene(scene);
    }
  });
})();
