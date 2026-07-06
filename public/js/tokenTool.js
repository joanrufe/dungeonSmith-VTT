// public/js/tokenTool.js
// Scene-container-level Token Tool for dragging tokens.
// Works on both DM (window.VTT_DM) and Player (window.VTT_PLAYER) pages.
// Listens once on #scene-container — no per-element listener churn.

/** @typedef {import('./sceneManager.js').TokenDict} TokenDict */

(function () {
  document.addEventListener('DOMContentLoaded', () => {
    function tryBind() {
      const sc = document.getElementById('scene-container');
      if (!sc) { setTimeout(tryBind, 200); return; }
      bindTokenTool(sc);
    }
    tryBind();
    setupStatusPopup();
  });

  function getContext() {
    if (window.VTT_DM)     return { isDM: true,  vtt: window.VTT_DM,     scene: window.VTT_DM.sceneManager.currentScene,     renderer: window.VTT_DM.sceneManager.sceneRenderer,     socket: window.VTT_DM.socket };
    if (window.VTT_PLAYER) return { isDM: false, vtt: window.VTT_PLAYER, scene: window.VTT_PLAYER.currentScene,               renderer: window.VTT_PLAYER.sceneRenderer,              socket: window.VTT_PLAYER.socket };
    return null;
  }

  function bindTokenTool(sc) {
    sc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return; // Ctrl/Cmd + drag pans the camera
      if (window.VTT_ACTIVE_PAINT_TOOL) return;
      if (window.VTT_ACTIVE_RULER_TOOL) return;

      // Only act on token elements (not paint tiles, not the container itself)
      const tokenEl = e.target.closest('.token');
      if (!tokenEl || tokenEl.classList.contains('paint-tile-el')) return;

      const ctx = getContext();
      if (!ctx || !ctx.scene) return;

      let token = ctx.scene.tokens.find(t => t.tokenId === tokenEl.dataset.tokenId);
      if (!token) return;

      // Click-through: if this is an area effect, look for an interactive token below
      let activeEl = tokenEl;
      if (token.isAreaEffect) {
        const allAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
        for (const el of allAtPoint) {
          if (el === tokenEl) continue;
          if (!el.classList.contains('token') || el.classList.contains('paint-tile-el')) continue;
          const candidate = ctx.scene.tokens.find(t => t.tokenId === el.dataset.tokenId);
          if (!candidate || candidate.isAreaEffect) continue;
          if (!ctx.isDM && !candidate.movableByPlayers) continue;
          activeEl = el;
          token = candidate;
          break;
        }
      }

      // Locked tokens cannot be moved by anyone
      if (token.locked) return;

      // Players can only move tokens explicitly allowed by the DM
      if (!ctx.isDM && !token.movableByPlayers) return;

      // Leave resize margin (interact.js uses 6px) for the DM only
      if (ctx.isDM) {
        const rect   = activeEl.getBoundingClientRect();
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
        ctx.vtt.sceneManager.selectedTokenIds.has(token.tokenId)
        ? Array.from(ctx.vtt.sceneManager.selectedTokenIds)
        : [token.tokenId];
      /** @type {TokenDict[]} */
      const movingTokens = selectedIds
        .map(id => ctx.scene.tokens.find(t => t.tokenId === id))
        .filter(Boolean);
      const startPositions = new Map(movingTokens.map(t => [t.tokenId, { x: t.x, y: t.y }]));

      activeEl.setPointerCapture(e.pointerId);
      activeEl.style.cursor = 'grabbing';

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

          const hpBarEl = document.getElementById(`hpbar-${movingToken.tokenId}`);
          if (hpBarEl) {
            hpBarEl.style.left = `${(movingToken.x + renderer.offsetX) * renderer.scale}px`;
            hpBarEl.style.top  = `${(movingToken.y + renderer.offsetY) * renderer.scale - 9}px`;
          }

          const condEl = document.getElementById(`cond-${movingToken.tokenId}`);
          if (condEl) {
            const fsize       = parseFloat(condEl.style.fontSize) || 22;
            const totalOffset = 6 + 3 + (fsize + 2) + 2; // BAR_H + BAR_GAP + labelH + LABEL_GAP
            condEl.style.left  = `${(movingToken.x + renderer.offsetX) * renderer.scale}px`;
            condEl.style.top   = `${(movingToken.y + renderer.offsetY) * renderer.scale - totalOffset}px`;
            condEl.style.width = `${movingToken.width * renderer.scale}px`;
          }

          ctx.socket.emit('updateToken', {
            sceneId:    movingToken.sceneId,
            tokenId:    movingToken.tokenId,
            properties: { x: movingToken.x, y: movingToken.y },
          });
        });

        // Players see fog; keep it in sync while dragging (server does not echo back to self)
        if (!ctx.isDM) {
          ctx.renderer.drawFog();
        }
      }

      function onUp(ev) {
        activeEl.releasePointerCapture(ev.pointerId);
        activeEl.style.cursor = '';
        activeEl.removeEventListener('pointermove',   onMove);
        activeEl.removeEventListener('pointerup',     onUp);
        activeEl.removeEventListener('pointercancel', onUp);
      }

      activeEl.addEventListener('pointermove',   onMove);
      activeEl.addEventListener('pointerup',     onUp);
      activeEl.addEventListener('pointercancel', onUp);
    });

    sc.addEventListener('contextmenu', (e) => {
      if (!window.VTT_DM) return;
      if (window.VTT_ACTIVE_PAINT_TOOL) return;
      const tokenEl = e.target.closest('.token');
      if (!tokenEl || tokenEl.classList.contains('paint-tile-el')) return;
      e.preventDefault();
      showStatusPopup(e.clientX, e.clientY, tokenEl.dataset.tokenId);
    });
  }
  let _statusTokenId = null;

  function setupStatusPopup() {
    const popup = document.getElementById('token-status-popup');
    if (!popup) return;

    document.addEventListener('pointerdown', (e) => {
      if (popup.style.display === 'block' && !popup.contains(e.target))
        popup.style.display = 'none';
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') popup.style.display = 'none';
    });

    document.getElementById('tsp-cancel').addEventListener('click', () => {
      popup.style.display = 'none';
    });

    document.getElementById('tsp-apply').addEventListener('click', () => {
      const ctx = getContext();
      if (!ctx || !ctx.scene || !_statusTokenId) return;
      const token = ctx.scene.tokens.find(t => t.tokenId === _statusTokenId);
      if (!token) return;

      const cur      = parseInt(document.getElementById('tsp-hp-cur').value);
      const max      = parseInt(document.getElementById('tsp-hp-max').value);
      const cond     = document.getElementById('tsp-cond-text').value.trim();
      const fontSize = parseInt(document.getElementById('tsp-cond-size').value) || 22;
      const radiusCells = parseFloat(document.getElementById('tsp-vision-radius').value);
      const isMap    = document.getElementById('tsp-is-map').checked;
      const visibleToPlayers = document.getElementById('tsp-visible-to-players').checked;
      const gridSize = window.VTT_GRID_SIZE || 60;

      token.hpCurrent        = isNaN(cur) ? null : cur;
      token.hpMax            = isNaN(max) ? null : max;
      token.conditionText    = cond || null;
      token.conditionColor   = cond ? document.getElementById('tsp-cond-color').value : null;
      token.conditionFontSize = cond ? fontSize : null;
      token.visionRadius     = isNaN(radiusCells) ? 0 : Math.max(0, radiusCells) * gridSize;
      token.isMap            = isMap;
      token.visibleToPlayers = visibleToPlayers;

      /** @type {Record<string,any>} */
      const properties = {
        hpCurrent:       token.hpCurrent,
        hpMax:           token.hpMax,
        conditionText:   token.conditionText,
        conditionColor:  token.conditionColor,
        conditionFontSize: token.conditionFontSize,
        visionRadius:    token.visionRadius,
        isMap:           token.isMap,
        visibleToPlayers: token.visibleToPlayers,
      };

      // When marking as a map token, lock it and send it to the background
      // z-layer. When unmarking, restore it as a normal token on top.
      if (isMap) {
        token.locked = true;
        token.zIndex = -1000;
        properties.locked = true;
        properties.zIndex = -1000;
      } else {
        token.locked = false;
        const maxZ = Math.max(0, ...ctx.scene.tokens.map(t => t.zIndex || 0));
        token.zIndex = maxZ + 1;
        properties.locked = false;
        properties.zIndex = token.zIndex;
      }

      ctx.renderer.updateTokenElement(token);

      // Redraw fog if the vision source changed while on the player view
      if (!ctx.isDM) {
        ctx.renderer.drawFog();
      }

      ctx.socket.emit('updateToken', {
        sceneId:    token.sceneId,
        tokenId:    _statusTokenId,
        properties,
      });
      popup.style.display = 'none';
    });
  }

  /**
   * Displays the status popup (HP + condition) for the given token.
   * @param {number} clientX
   * @param {number} clientY
   * @param {string} tokenId
   */
  function showStatusPopup(clientX, clientY, tokenId) {
    const ctx = getContext();
    if (!ctx || !ctx.scene) return;
    const token = ctx.scene.tokens.find(t => t.tokenId === tokenId);
    if (!token) return;
    _statusTokenId = tokenId;

    document.getElementById('tsp-hp-cur').value      = token.hpCurrent != null ? token.hpCurrent : '';
    document.getElementById('tsp-hp-max').value      = token.hpMax     != null ? token.hpMax     : '';
    document.getElementById('tsp-cond-text').value   = token.conditionText   || '';
    document.getElementById('tsp-cond-size').value   = token.conditionFontSize || 22;
    document.getElementById('tsp-cond-color').value  = token.conditionColor  || '#ffffff';

    const gridSize = window.VTT_GRID_SIZE || 60;
    const radiusCells = token.visionRadius ? token.visionRadius / gridSize : 0;
    document.getElementById('tsp-vision-radius').value = radiusCells || '';
    document.getElementById('tsp-is-map').checked = !!token.isMap;
    document.getElementById('tsp-visible-to-players').checked = token.visibleToPlayers !== false;

    const popup = document.getElementById('token-status-popup');
    popup.style.display = 'block';
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    popup.style.left = `${Math.min(clientX + 8, window.innerWidth  - pw - 8)}px`;
    popup.style.top  = `${Math.min(clientY + 8, window.innerHeight - ph - 8)}px`;
  }
})();
