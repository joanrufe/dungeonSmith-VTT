// public/js/tokenTool.js
// Scene-container-level Token Tool for dragging tokens.
// Works on both DM (window.VTT_DM) and Player (window.VTT_PLAYER) pages.
// Listens once on #scene-container — no per-element listener churn.
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    function tryBind() {
      const sc = document.getElementById('scene-container');
      if (!sc) { setTimeout(tryBind, 200); return; }
      bindTokenTool(sc);
    }
    tryBind();
  });

  function getContext() {
    if (window.VTT_DM)     return { isDM: true,  vtt: window.VTT_DM,     scene: window.VTT_DM.sceneManager.currentScene,     renderer: window.VTT_DM.sceneManager.sceneRenderer,     socket: window.VTT_DM.socket };
    if (window.VTT_PLAYER) return { isDM: false, vtt: window.VTT_PLAYER, scene: window.VTT_PLAYER.currentScene,               renderer: window.VTT_PLAYER.sceneRenderer,              socket: window.VTT_PLAYER.socket };
    return null;
  }

  function bindTokenTool(sc) {
    sc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (window.VTT_ACTIVE_PAINT_TOOL) return;
      if (window.VTT_ACTIVE_RULER_TOOL) return;

      // Only act on token elements (not paint tiles, not the container itself)
      const tokenEl = e.target.closest('.token');
      if (!tokenEl || tokenEl.classList.contains('paint-tile-el')) return;

      const ctx = getContext();
      if (!ctx || !ctx.scene) return;

      const tokenId = tokenEl.dataset.tokenId;
      const token   = ctx.scene.tokens.find(t => t.tokenId === tokenId);
      if (!token) return;

      // Players can only move tokens explicitly allowed by the DM
      if (!ctx.isDM && !token.movableByPlayers) return;

      // Leave resize margin (interact.js uses 6px) for the DM only
      if (ctx.isDM) {
        const rect   = tokenEl.getBoundingClientRect();
        const margin = 8;
        const nearEdge = e.clientX - rect.left   < margin ||
                         rect.right  - e.clientX < margin ||
                         e.clientY - rect.top    < margin ||
                         rect.bottom - e.clientY < margin;
        if (nearEdge) return; // let interact.js handle resize
      }

      e.preventDefault();
      e.stopPropagation();

      const renderer  = ctx.renderer;
      const startX    = e.clientX;
      const startY    = e.clientY;
      const selectedIds = ctx.isDM && ctx.vtt.sceneManager && ctx.vtt.sceneManager.selectedTokenIds &&
        ctx.vtt.sceneManager.selectedTokenIds.has(tokenId)
        ? Array.from(ctx.vtt.sceneManager.selectedTokenIds)
        : [tokenId];
      const movingTokens = selectedIds
        .map(id => ctx.scene.tokens.find(t => t.tokenId === id))
        .filter(Boolean);
      const startPositions = new Map(movingTokens.map(t => [t.tokenId, { x: t.x, y: t.y }]));

      tokenEl.setPointerCapture(e.pointerId);
      tokenEl.style.cursor = 'grabbing';

      function onMove(ev) {
        const dx = (ev.clientX - startX) / renderer.scale;
        const dy = (ev.clientY - startY) / renderer.scale;

        movingTokens.forEach((movingToken) => {
          const start = startPositions.get(movingToken.tokenId);
          movingToken.x = start.x + dx;
          movingToken.y = start.y + dy;

          if (window.VTT_SNAP) {
            const g = window.VTT_GRID_SIZE || 60;
            movingToken.x = Math.round(movingToken.x / g) * g;
            movingToken.y = Math.round(movingToken.y / g) * g;
          }

          const movingEl = document.getElementById(`token-${movingToken.tokenId}`);
          if (movingEl) {
            movingEl.style.left = `${(movingToken.x + renderer.offsetX) * renderer.scale}px`;
            movingEl.style.top  = `${(movingToken.y + renderer.offsetY) * renderer.scale}px`;
          }

          ctx.socket.emit('updateToken', {
            sceneId:    movingToken.sceneId,
            tokenId:    movingToken.tokenId,
            properties: { x: movingToken.x, y: movingToken.y },
          });
        });
      }

      function onUp(ev) {
        tokenEl.releasePointerCapture(ev.pointerId);
        tokenEl.style.cursor = '';
        tokenEl.removeEventListener('pointermove',   onMove);
        tokenEl.removeEventListener('pointerup',     onUp);
        tokenEl.removeEventListener('pointercancel', onUp);
      }

      tokenEl.addEventListener('pointermove',   onMove);
      tokenEl.addEventListener('pointerup',     onUp);
      tokenEl.addEventListener('pointercancel', onUp);
    });
  }
})();
