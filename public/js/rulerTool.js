(function () {
  const FEET_PER_CELL = 5;
  let active = false;
  let measuring = false;
  let start = null;
  let overlay = null;
  let line = null;
  let label = null;

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('ruler-toggle-btn');
    const sceneContainer = document.getElementById('scene-container');
    if (!button || !sceneContainer) return;

    button.addEventListener('click', () => {
      active = !active;
      window.VTT_ACTIVE_RULER_TOOL = active;
      document.body.classList.toggle('ruler-mode-active', active);
      button.classList.toggle('active-tool-btn', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.title = active ? 'Ruler mode on' : 'Measure distance';
      sceneContainer.style.cursor = active ? 'crosshair' : '';
      updateModeIndicator(active);
      if (!active) clearRuler();
    });

    sceneContainer.addEventListener('pointerdown', (event) => {
      if (!active || event.button !== 0) return;
      const ctx = getContext();
      if (!ctx) return;

      event.preventDefault();
      event.stopPropagation();
      measuring = true;
      start = screenToWorld(event, sceneContainer, ctx.renderer);
      ensureOverlay(sceneContainer);
      drawMeasurement(start, start, ctx.renderer);
    }, true);

    sceneContainer.addEventListener('click', (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    sceneContainer.addEventListener('pointermove', (event) => {
      if (!measuring || !start) return;
      const ctx = getContext();
      if (!ctx) return;
      drawMeasurement(start, screenToWorld(event, sceneContainer, ctx.renderer), ctx.renderer);
    });

    window.addEventListener('pointerup', () => {
      measuring = false;
    });
  });

  function getContext() {
    if (window.VTT_DM) return { renderer: window.VTT_DM.sceneManager.sceneRenderer };
    if (window.VTT_PLAYER) return { renderer: window.VTT_PLAYER.sceneRenderer };
    return null;
  }

  function screenToWorld(event, container, renderer) {
    const rect = container.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / renderer.scale - renderer.offsetX,
      y: (event.clientY - rect.top) / renderer.scale - renderer.offsetY,
    };
  }

  function worldToScreen(point, renderer) {
    return {
      x: (point.x + renderer.offsetX) * renderer.scale,
      y: (point.y + renderer.offsetY) * renderer.scale,
    };
  }

  function ensureOverlay(container) {
    if (overlay && overlay.parentNode === container) return;

    overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.id = 'ruler-overlay';
    overlay.setAttribute('width', '100%');
    overlay.setAttribute('height', '100%');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2400';

    line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', '#ffd166');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');

    label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('fill', '#ffffff');
    label.setAttribute('stroke', '#111111');
    label.setAttribute('stroke-width', '4');
    label.setAttribute('paint-order', 'stroke');
    label.setAttribute('font-size', '15');
    label.setAttribute('font-weight', '800');
    label.setAttribute('text-anchor', 'middle');

    overlay.appendChild(line);
    overlay.appendChild(label);
    container.appendChild(overlay);
  }

  function drawMeasurement(from, to, renderer) {
    const a = worldToScreen(from, renderer);
    const b = worldToScreen(to, renderer);
    const gridSize = window.VTT_GRID_SIZE || 60;
    const distancePx = Math.hypot(to.x - from.x, to.y - from.y);
    const feet = Math.round((distancePx / gridSize) * FEET_PER_CELL);

    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x);
    line.setAttribute('y2', b.y);
    label.setAttribute('x', (a.x + b.x) / 2);
    label.setAttribute('y', ((a.y + b.y) / 2) - 10);
    label.textContent = `${feet} ft`;
  }

  function clearRuler() {
    if (overlay) overlay.remove();
    overlay = null;
    line = null;
    label = null;
    measuring = false;
    start = null;
  }

  function updateModeIndicator(show) {
    let indicator = document.getElementById('ruler-mode-indicator');

    if (!show) {
      if (indicator) indicator.remove();
      return;
    }

    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'ruler-mode-indicator';
      indicator.textContent = 'Ruler Mode';
      document.body.appendChild(indicator);
    }
  }
})();
