// public/js/turnTracker.js
// Standalone turn tracker page for tablet display.

(function () {
  'use strict';

  const socket = io({ query: { role: 'tracker' } });

  let currentSceneId = null;
  let currentTokens = [];
  let currentTitle = 'Turn Tracker';
  let isDM = false;

  const turnListEl = document.getElementById('turn-list');
  const emptyStateEl = document.getElementById('empty-state');
  const roundDisplayEl = document.getElementById('round-display');
  const sceneNameEl = document.getElementById('scene-name');
  const dmControlsEl = document.getElementById('dm-controls');
  const mainEl = document.getElementById('tracker-main');

  function fetchSession() {
    return fetch('/api/session')
      .then((res) => {
        if (!res.ok) throw new Error('session fetch failed');
        return res.json();
      })
      .then((data) => {
        isDM = !!data.isDM;
        if (isDM) {
          dmControlsEl.classList.remove('hidden');
          mainEl.classList.add('has-dm-controls');
          setupDMControls();
        }
      })
      .catch(() => {
        // Session endpoint is best-effort; the page still works read-only.
      });
  }

  function setupDMControls() {
    document.getElementById('prev-turn-btn').addEventListener('click', () => {
      if (currentSceneId) socket.emit('previousTurn', { sceneId: currentSceneId });
    });
    document.getElementById('next-turn-btn').addEventListener('click', () => {
      if (currentSceneId) socket.emit('advanceTurn', { sceneId: currentSceneId });
    });
    document.getElementById('reset-turn-btn').addEventListener('click', () => {
      if (currentSceneId) socket.emit('resetTurnTracker', { sceneId: currentSceneId });
    });
  }

  function loadScene(sceneId) {
    if (!sceneId) return;
    socket.emit('loadScene', { sceneId });
  }

  socket.on('activeSceneId', (sceneId) => {
    loadScene(sceneId);
  });

  socket.on('sceneData', (scene) => {
    if (!scene || !scene.sceneId) return;
    currentSceneId = scene.sceneId;
    currentTitle = scene.turnTracker && scene.turnTracker.title ? scene.turnTracker.title : 'Turn Tracker';
    currentTokens = scene.tokens || [];
    render(scene.turnTracker || { order: [], activeIndex: 0, round: 1, title: '' });
  });

  socket.on('turnTrackerUpdate', ({ sceneId, turnTracker }) => {
    if (sceneId !== currentSceneId) return;
    // Tokens stay the same between tracker updates; only order/active turn changes.
    if (turnTracker && turnTracker.title) {
      currentTitle = turnTracker.title;
    }
    render(turnTracker || { order: [], activeIndex: 0, round: 1, title: '' });
  });

  socket.on('error', ({ message }) => {
    console.error('Turn tracker error:', message);
  });

  function render(turnTracker) {
    const order = (turnTracker.order || []).slice();
    const activeIndex = Math.max(0, Math.min(turnTracker.activeIndex || 0, order.length - 1));
    const round = turnTracker.round || 1;

    sceneNameEl.textContent = currentTitle || 'Turn Tracker';
    roundDisplayEl.textContent = `Round ${round}`;

    turnListEl.innerHTML = '';

    if (!order.length) {
      turnListEl.classList.add('hidden');
      emptyStateEl.classList.remove('hidden');
      return;
    }

    turnListEl.classList.remove('hidden');
    emptyStateEl.classList.add('hidden');

    const tokenMap = new Map();
    currentTokens.forEach((token) => {
      if (token && token.tokenId) tokenMap.set(token.tokenId, token);
    });

    order.forEach((entry, index) => {
      const token = tokenMap.get(entry.tokenId);
      if (!token) return;
      turnListEl.appendChild(buildRow(token, entry, index, index === activeIndex, index + 1));
    });
  }

  function buildRow(token, entry, index, isActive, rank) {
    const isDisabled = !!entry.disabled;
    const row = document.createElement('div');
    row.className = 'turn-row' +
      (isActive ? ' turn-active' : '') +
      (isDisabled ? ' turn-disabled' : '');

    const name = document.createElement('div');
    name.className = 'turn-name';
    name.textContent = (token.name || 'Unknown') + (isDisabled ? ' (skipped)' : '');
    name.title = token.name || 'Unknown';

    const body = document.createElement('div');
    body.className = 'turn-body';

    const rankEl = document.createElement('div');
    rankEl.className = 'turn-rank';
    rankEl.textContent = String(rank);

    const img = document.createElement('img');
    img.className = 'turn-image';
    img.alt = token.name || 'Token';
    img.src = token.imageUrl || '/DungeonSmith.png';
    img.onerror = () => { img.src = '/DungeonSmith.png'; };

    const stats = document.createElement('div');
    stats.className = 'turn-stats';

    const hp = buildHP(token.hpCurrent, token.hpMax);

    const init = document.createElement('div');
    init.className = 'turn-init';
    init.innerHTML = `<span class="turn-init-label">Init</span><span class="turn-init-value">${entry.initiative}</span>`;

    stats.appendChild(hp);
    stats.appendChild(init);

    body.appendChild(rankEl);
    body.appendChild(img);
    body.appendChild(stats);

    row.appendChild(name);
    row.appendChild(body);

    if (isDM) {
      row.addEventListener('dblclick', () => {
        if (!isDisabled && currentSceneId) {
          socket.emit('setActiveTurn', { sceneId: currentSceneId, tokenId: entry.tokenId });
        }
      });
    }

    return row;
  }

  function buildHP(current, max) {
    const container = document.createElement('div');
    container.className = 'turn-hp';

    const bar = document.createElement('div');
    bar.className = 'hp-bar';

    const fill = document.createElement('div');
    fill.className = 'hp-fill';

    const cur = typeof current === 'number' ? current : 0;
    const mx = typeof max === 'number' && max > 0 ? max : 0;
    const pct = mx > 0 ? Math.max(0, Math.min(100, (cur / mx) * 100)) : 0;
    fill.style.width = `${pct}%`;
    if (pct > 0 && pct <= 25) fill.classList.add('hp-low');

    bar.appendChild(fill);

    const text = document.createElement('span');
    text.className = 'hp-text';
    if (typeof current === 'number' && typeof max === 'number') {
      text.textContent = `${cur} / ${max}`;
    } else if (typeof current === 'number') {
      text.textContent = String(cur);
    } else if (typeof max === 'number') {
      text.textContent = `0 / ${max}`;
    } else {
      text.textContent = '—';
    }

    container.appendChild(bar);
    container.appendChild(text);
    return container;
  }

  document.addEventListener('DOMContentLoaded', () => {
    fetchSession();
  });
})();
