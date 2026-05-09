// =========================================================
//  DND VTT – Player Controls
//  Handles: dice panel toggle + drag-to-move
// =========================================================

(function () {
  document.addEventListener('DOMContentLoaded', () => {
    setupPanelToggle('dice-toggle-btn', 'dice-panel');
    makeDraggable(document.getElementById('dice-panel'));
  });

  function setupPanelToggle(btnId, panelId) {
    const btn   = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;

    btn.addEventListener('click', () => {
      const isHidden = panel.classList.toggle('panel-hidden');
      btn.style.background  = isHidden ? '#151515' : '#c62828';
      btn.style.borderColor = isHidden ? 'rgba(255,255,255,0.16)' : '#c62828';
    });
  }

  function makeDraggable(el) {
    if (!el) return;
    const handle = el.querySelector('.panel-drag-handle');
    if (!handle) return;

    let ox = 0, oy = 0, sx = 0, sy = 0;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = rect.left;
      oy = rect.top;

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
