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
    const socket      = io({ query: { role: 'player' } });
    const wrapper     = document.getElementById('player-init-wrapper');
    const sidebar     = document.getElementById('player-init-sidebar');
    const collapseBtn = document.getElementById('player-init-collapse-btn');
    const flourish     = document.getElementById('player-flourish');
    const flourishName = document.getElementById('player-flourish-name');

    // ── Collapse / expand ────────────────────────────────
    let collapsed = false;
    collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      wrapper.classList.toggle('init-collapsed', collapsed);
      collapseBtn.innerHTML = collapsed ? '&#x276F;' : '&#x276E;';
    });

    // ── Help modal ───────────────────────────────────────
    const helpBtn   = document.getElementById('player-help-btn');
    const helpModal = document.getElementById('player-help-modal');
    const helpClose = document.querySelector('.player-help-close');

    if (helpBtn)   helpBtn.addEventListener('click',  () => helpModal.classList.remove('hidden'));
    if (helpClose) helpClose.addEventListener('click', () => helpModal.classList.add('hidden'));
    if (helpModal) helpModal.addEventListener('click', e => {
      if (e.target === helpModal) helpModal.classList.add('hidden');
    });

    // ── Socket listener ──────────────────────────────────
    let lastActiveIndex = -1;

    socket.on('updateInitiative', ({ players, activeIndex, round }) => {
      renderSidebar(players, activeIndex, round);
      if (activeIndex !== lastActiveIndex && activeIndex >= 0 && players.length > 0) {
        showFlourish(players[activeIndex].name);
      }
      lastActiveIndex = activeIndex;
    });

    // ── Render sidebar ───────────────────────────────────
    function renderSidebar(players, activeIndex, round = 1) {
      if (!players || !players.length) {
        wrapper.style.display = 'none';
        return;
      }
      wrapper.style.display = 'flex';
      sidebar.innerHTML = `<div class="pisb-title">Initiative</div><div class="pisb-round">Round ${round || 1}</div>`;
      players.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'pisb-row' + (i === activeIndex ? ' pisb-active' : '');
        row.innerHTML = `<span class="pisb-num">${i + 1}</span>
                         <span class="pisb-name">${p.name}</span>
                         <span class="pisb-init">${p.init}</span>`;
        sidebar.appendChild(row);
      });
    }

    // ── Flourish ─────────────────────────────────────────
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
    window.VTT_PLAYER.showFlourish = showFlourish;
    window.VTT_PLAYER.socket = socket;
  });
})();
