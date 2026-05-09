// =========================================================
//  DND VTT – DM Toolbar Controls
//  "Tools" button toggles a right-side tray of icon buttons.
//  Each tray button toggles its own floating draggable panel.
// =========================================================

(function () {
  window.VTT_SNAP      = false;
  window.VTT_GRID_SIZE = 60;
  window.VTT_GRID_TYPE = 'square';
  window.VTT_FOLLOW_PLAYERS = true;

  document.addEventListener('DOMContentLoaded', () => {

    // ── Help Modal ────────────────────────────────────────
    document.getElementById('help-btn').addEventListener('click', () =>
      document.getElementById('help-modal').classList.remove('hidden'));
    document.querySelector('.help-close').addEventListener('click', () =>
      document.getElementById('help-modal').classList.add('hidden'));
    document.getElementById('help-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('help-modal'))
        document.getElementById('help-modal').classList.add('hidden');
    });

    // ── Snap to Grid ──────────────────────────────────────
    document.getElementById('snap-grid-toggle').addEventListener('change', e => {
      window.VTT_SNAP = e.target.checked;
    });

    const followPlayersToggle = document.getElementById('follow-players-toggle');
    if (followPlayersToggle) {
      window.VTT_FOLLOW_PLAYERS = followPlayersToggle.checked;
      followPlayersToggle.addEventListener('change', e => {
        window.VTT_FOLLOW_PLAYERS = e.target.checked;
      });
    }

    // ── Grid Size ─────────────────────────────────────────
    const display = document.getElementById('grid-size-display');
    const STEP = 10, MIN = 20, MAX = 200;

    function updateGridSize(delta) {
      window.VTT_GRID_SIZE = Math.min(MAX, Math.max(MIN, window.VTT_GRID_SIZE + delta));
      display.textContent  = window.VTT_GRID_SIZE;
      const paintInput = document.getElementById('paint-grid-size');
      if (paintInput) { paintInput.value = window.VTT_GRID_SIZE; paintInput.dispatchEvent(new Event('change')); }
    }

    document.getElementById('grid-size-plus').addEventListener('click',  () => updateGridSize(+STEP));
    document.getElementById('grid-size-minus').addEventListener('click', () => updateGridSize(-STEP));

    const gridTypeToggle = document.getElementById('grid-type-toggle');
    if (gridTypeToggle) {
      gridTypeToggle.addEventListener('click', () => {
        window.VTT_GRID_TYPE = window.VTT_GRID_TYPE === 'square' ? 'hex' : 'square';
        gridTypeToggle.textContent = window.VTT_GRID_TYPE === 'square' ? 'Square' : 'Hex';
        const paintInput = document.getElementById('paint-grid-size');
        if (paintInput) paintInput.dispatchEvent(new Event('change'));
        if (window.VTT_DM) {
          window.VTT_DM.socket.emit('toggleGrid', {
            visible: gridVisible,
            gridSize: window.VTT_GRID_SIZE,
            gridType: window.VTT_GRID_TYPE,
          });
        }
      });
    }

    // ── Grid Show/Hide toggle ─────────────────────────────
    const gridShowBtn = document.getElementById('grid-show-btn');
    let gridVisible = true;
    gridShowBtn.addEventListener('click', () => {
      gridVisible = !gridVisible;
      const gc = document.getElementById('paint-grid-canvas');
      if (gc) gc.style.display = gridVisible ? '' : 'none';
      const pt = document.getElementById('paint-grid-toggle');
      if (pt) { pt.checked = gridVisible; pt.dispatchEvent(new Event('change')); }
      gridShowBtn.classList.toggle('active-tool-btn', !gridVisible);
      gridShowBtn.textContent = gridVisible ? 'Hide Grid' : 'Show Grid';
    });

    // ── Snap to View (DM → Players) ───────────────────────
    const snapViewBtn = document.getElementById('snap-view-btn');
    if (snapViewBtn) {
      snapViewBtn.addEventListener('click', () => {
        function trySend() {
          if (!window.VTT_DM) { setTimeout(trySend, 150); return; }
          const renderer = window.VTT_DM.sceneManager.sceneRenderer;
          const currentScene = window.VTT_DM.sceneManager.currentScene;
          window.VTT_DM.socket.emit('snapView', {
            sceneId: currentScene ? currentScene.sceneId : null,
            scale:   renderer.scale,
            offsetX: renderer.offsetX,
            offsetY: renderer.offsetY,
          });
          snapViewBtn.innerHTML = '<i class="fa-solid fa-check"></i> Snapped!';
          setTimeout(() => { snapViewBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Snap View'; }, 1200);
        }
        trySend();
      });
    }

    // ── Paint Layer (z-index for all paint tiles) ─────────
    const layerSlider  = document.getElementById('paint-layer-slider');
    const layerDisplay = document.getElementById('paint-layer-display');
    layerSlider.addEventListener('input', () => {
      const z = parseInt(layerSlider.value);
      layerDisplay.textContent = z;
      window.VTT_PAINT_LAYER = z;
      document.querySelectorAll('.paint-tile-el').forEach(el => { el.style.zIndex = z; });
    });
    window.VTT_PAINT_LAYER = -10;

    // ── Tools Tray toggle ─────────────────────────────────
    const trayBtn  = document.getElementById('dm-tools-tray-btn');
    const tray     = document.getElementById('dm-tool-tray');
    trayBtn.addEventListener('click', () => {
      const hidden = tray.classList.toggle('tray-hidden');
      trayBtn.classList.toggle('active-tool-btn', !hidden);
    });

    // ── Panel pop-out toggles from tray ───────────────────
    setupPanelToggle('init-toggle-btn',  'initiative-panel');
    setupPanelToggle('paint-toggle-btn', 'paint-panel');
    setupPanelToggle('ae-toggle-btn',    'area-effect-panel');
    setupPanelToggle('dice-toggle-btn',  'dice-panel');
    setupPanelToggle('music-toggle-btn', 'music-panel');

    // ── Make panels draggable ─────────────────────────────
    makeDraggable(document.getElementById('initiative-panel'));
    makeDraggable(document.getElementById('paint-panel'));
    makeDraggable(document.getElementById('area-effect-panel'));
    makeDraggable(document.getElementById('notes-panel'));
    makeDraggable(document.getElementById('music-panel'));
    makeDraggable(document.getElementById('dice-panel'));
  });

  // ─────────────────────────────────────────────────────────
  function setupPanelToggle(btnId, panelId) {
    const btn   = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const hidden = panel.classList.toggle('panel-hidden');
      btn.classList.toggle('active-tool-btn', !hidden);
      // Deactivate paint mode when the paint panel is closed
      if (hidden && panelId === 'paint-panel') {
        document.getElementById('paint-stop-btn')?.click();
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  function makeDraggable(el) {
    if (!el) return;
    const handle = el.querySelector('.panel-drag-handle');
    if (!handle) return;
    let ox = 0, oy = 0, sx = 0, sy = 0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      ox = rect.left;  oy = rect.top;
      el.style.right    = 'auto';
      el.style.left     = ox + 'px';
      el.style.top      = oy + 'px';
      el.style.position = 'fixed';
      function onMove(e) {
        el.style.left = (ox + e.clientX - sx) + 'px';
        el.style.top  = (oy + e.clientY - sy) + 'px';
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }
})();
