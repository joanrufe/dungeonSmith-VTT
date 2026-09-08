// =========================================================
//  DND VTT – Player Initiative Sidebar
//  - Collapsible via a toggle tab button
//  - Shows flourish animation on turn change
//  - Help modal open/close
// =========================================================

(function () {
  function waitForSocket(cb) {
    if (typeof io !== 'undefined') { cb(); }
    else { setTimeout(() => waitForSocket(cb), 100); }
  }

  waitForSocket(() => {
    const socket = io({ query: { role: 'player' } });
    const wrapper = document.getElementById('player-init-wrapper');
    const sidebar = document.getElementById('player-init-sidebar');
    const collapseBtn = document.getElementById('player-init-collapse-btn');
    const flourish = document.getElementById('player-flourish');
    const flourishName = document.getElementById('player-flourish-name');

    let currentSceneId = null;
    let currentTokens = [];
    let lastActiveIndex = -1;

    // ── Collapse / expand ────────────────────────────────
    let collapsed = false;
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        collapsed = !collapsed;
        wrapper.classList.toggle('init-collapsed', collapsed);
        collapseBtn.innerHTML = collapsed ? '&#x276F;' : '&#x276E;';
      });
    }

    // ── Help modal ───────────────────────────────────────
    const helpBtn = document.getElementById('player-help-btn');
    const helpModal = document.getElementById('player-help-modal');
    const helpClose = document.querySelector('.player-help-close');

    if (helpBtn) helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
    if (helpClose) helpClose.addEventListener('click', () => helpModal.classList.add('hidden'));
    if (helpModal) helpModal.addEventListener('click', e => {
      if (e.target === helpModal) helpModal.classList.add('hidden');
    });

    // ── Socket listeners ─────────────────────────────────
    socket.on('activeSceneId', (sceneId) => {
      if (sceneId) socket.emit('loadScene', { sceneId });
    });

    socket.on('sceneData', (scene) => {
      if (!scene || !scene.sceneId) return;
      currentSceneId = scene.sceneId;
      currentTokens = scene.tokens || [];
      renderSidebar(scene.turnTracker);
    });

    socket.on('turnTrackerUpdate', ({ sceneId, turnTracker }) => {
      if (sceneId !== currentSceneId) return;
      renderSidebar(turnTracker);
    });

    // ── Render sidebar ───────────────────────────────────
    function renderSidebar(turnTracker) {
      const order = (turnTracker && turnTracker.order) || [];
      const activeIndex = Math.max(0, Math.min(turnTracker.activeIndex || 0, order.length - 1));
      const round = turnTracker.round || 1;

      if (!order.length) {
        if (wrapper) wrapper.style.display = 'none';
        return;
      }
      if (wrapper) wrapper.style.display = 'flex';
      sidebar.innerHTML = `<div class="pisb-title">Initiative</div><div class="pisb-round">Round ${round}</div>`;

      const tokenMap = new Map((currentTokens || []).filter(t => t && t.tokenId).map(t => [t.tokenId, t]));

      order.forEach((entry, i) => {
        const token = tokenMap.get(entry.tokenId);
        const row = document.createElement('div');
        row.className = 'pisb-row' + (i === activeIndex ? ' pisb-active' : '');
        row.innerHTML = `<span class="pisb-num">${i + 1}</span>
                         <span class="pisb-name">${escapeHtml(token ? token.name : 'Unknown')}</span>
                         <span class="pisb-init">${entry.initiative}</span>`;
        sidebar.appendChild(row);
      });

      if (activeIndex !== lastActiveIndex && activeIndex >= 0 && order.length > 0) {
        const active = order[activeIndex];
        const activeToken = active ? tokenMap.get(active.tokenId) : null;
        if (activeToken && activeToken.name) {
          showFlourish(activeToken.name);
        }
      }
      lastActiveIndex = activeIndex;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // ── Flourish ─────────────────────────────────────────
    function showFlourish(name, color = null) {
      if (window.VTT_CALLOUTS) {
        window.VTT_CALLOUTS.show(`${name}'s Turn`, {
          type: 'initiative',
          color,
          durationMs: 3000,
        });
      } else if (flourish && flourishName) {
        flourishName.textContent = `${name}'s Turn`;
        flourishName.style.color = color || '';
        flourish.classList.remove('hidden');
      }
    }

    // Expose for Dice Roller
    window.VTT_PLAYER = window.VTT_PLAYER || {};
    window.VTT_PLAYER.showFlourish = showFlourish;
    window.VTT_PLAYER.socket = socket;
  });
})();
