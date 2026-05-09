// =========================================================
//  DND VTT – Paint Mode (DM side)
//  Paint tiles are emitted as addToken events (SVG data-URL)
//  so players see them via the normal sync system.
//  Eraser tool removes tiles by emitting removeToken.
// =========================================================

(function () {
  const TOOLS = {
    stone:  { bg: '#6b6b6b', border: '#444',    icon: 'fa-solid fa-cube',             title: 'Stone' },
    grass:  { bg: '#4CAF50', border: '#388e3c', icon: 'fa-solid fa-leaf',             title: 'Grass' },
    dirt:   { bg: '#795548', border: '#5d4037', icon: 'fa-solid fa-circle',           title: 'Dirt' },
    sand:   { bg: '#d4c281', border: '#bda95c', icon: 'fa-solid fa-sun',              title: 'Sand' },
    water:  { bg: '#1565c0', border: '#0d47a1', icon: 'fa-solid fa-droplet',          title: 'Water' },
    lava:   { bg: '#e64a19', border: '#bf360c', icon: 'fa-solid fa-fire',             title: 'Lava' },
    pillar: { bg: '#9e9e9e', border: '#616161', icon: 'fa-solid fa-chess-rook',       title: 'Pillar' },
    door:   { bg: '#5D4037', border: '#3e2723', icon: 'fa-solid fa-door-closed',      title: 'Door' },
    table:  { bg: '#8D6E63', border: '#6d4c41', icon: 'fa-solid fa-chair',            title: 'Table' },
    star:   { bg: '#FFD700', border: '#FFA000', icon: 'fa-solid fa-star',             title: 'Star' },
  };

  let activeTool = null; // null = select, 'eraser' = erase, or a TOOL key
  let isDrawing  = false;
  let gridSize   = 60;
  let showGrid   = true;
  let gridType   = 'square';
  let gridCanvas = null;
  let brushSize  = 1; // 1–5 cells (center-based)
  let previewEl  = null;

  // Track col-row → tokenId so we can erase
  const tileMap = {}; // key: "col,row" → tokenId

  // ── Build a colored SVG data-URL for a tool ─────────────
  function makeSVG(tool) {
    let cfg;
    if (tool === 'custom') {
      cfg = {
        bg: document.getElementById('custom-paint-fill').value,
        border: document.getElementById('custom-paint-outline').value
      };
    } else {
      cfg = TOOLS[tool];
    }
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${gridSize}" height="${gridSize}">` +
      `<rect width="${gridSize}" height="${gridSize}" fill="${cfg.bg}" stroke="${cfg.border}" stroke-width="1"/>` +
      `</svg>`
    )}`;
  }

  // ── Get DM socket + sceneManager (wait for dm.js to load) ─
  function getDM(cb) {
    if (window.VTT_DM) { cb(window.VTT_DM); }
    else { setTimeout(() => getDM(cb), 150); }
  }

  // ── Setup ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {

    // Dynamically generate the tool buttons
    const toolsContainer = document.getElementById('paint-tools-container');
    if (toolsContainer) {
      Object.keys(TOOLS).forEach(key => {
        const t = TOOLS[key];
        const btn = document.createElement('button');
        btn.className = 'ptool';
        btn.dataset.tool = key;
        btn.style.background = t.bg;
        btn.title = t.title;
        btn.innerHTML = `<i class="${t.icon}"></i>`;
        toolsContainer.appendChild(btn);
      });
    }

    // Tool buttons listener
    document.querySelectorAll('.ptool').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tool;
        if (activeTool === t) { deactivate(); return; }
        setActiveTool(t);
      });
    });

    // Custom tool button
    const customBtn = document.getElementById('paint-custom-btn');
    if (customBtn) {
      customBtn.addEventListener('click', () => {
        if (activeTool === 'custom') { deactivate(); return; }
        setActiveTool('custom');
      });
    }

    // Brush size slider (1–5)
    const brushSlider  = document.getElementById('paint-brush-slider');
    const brushDisplay = document.getElementById('paint-brush-display');
    if (brushSlider) {
      brushSlider.addEventListener('input', () => {
        brushSize = parseInt(brushSlider.value);
        if (brushDisplay) brushDisplay.textContent = brushSize;
      });
    }

    // Eraser button
    document.getElementById('paint-eraser-btn').addEventListener('click', () => {
      if (activeTool === 'eraser') { deactivate(); return; }
      setActiveTool('eraser');
    });

    document.getElementById('paint-stop-btn').addEventListener('click', deactivate);

    document.getElementById('paint-clear-btn').addEventListener('click', () => {
      if (!confirm('Clear all painted tiles from this scene?')) return;
      getDM(({ socket, sceneManager }) => {
        if (!sceneManager.currentScene) return;
        const sceneId = sceneManager.currentScene.sceneId;

        // Find all paint tokens in the current scene array (including loaded ones)
        const paintTokens = sceneManager.currentScene.tokens.filter(t => t.isPaintTile || (t.tokenId && t.tokenId.startsWith('paint-')));

        paintTokens.forEach(t => {
          socket.emit('removeToken', { sceneId, tokenId: t.tokenId });
          const el = document.getElementById(`token-${t.tokenId}`);
          if (el) el.remove();
        });

        // Filter them out of the main scene token array locally
        sceneManager.currentScene.tokens = sceneManager.currentScene.tokens.filter(t => !t.isPaintTile && (!t.tokenId || !t.tokenId.startsWith('paint-')));

        // Clear local map
        for (const k in tileMap) delete tileMap[k];
      });
    });

    // Grid toggle – also broadcast to players
    document.getElementById('paint-grid-toggle').addEventListener('change', e => {
      showGrid = e.target.checked;
      updateGrid();
      getDM(({ socket }) => {
        socket.emit('toggleGrid', { visible: showGrid, gridSize, gridType });
      });
    });

    // Grid size (synced from dmControls)
    document.getElementById('paint-grid-size').addEventListener('change', e => {
      const v = parseInt(e.target.value);
      if (!isNaN(v) && v >= 20) {
        gridSize = v;
        window.VTT_GRID_SIZE = gridSize;
        gridType = window.VTT_GRID_TYPE || gridType;
        rebuildGrid();
        getDM(({ socket }) => {
          socket.emit('toggleGrid', { visible: showGrid, gridSize, gridType });
        });
      }
    });

    // Background color picker – always defaults to black
    const bgPicker = document.getElementById('scene-bg-color');
    bgPicker.value = '#000000';
    // Apply initial black via the renderer (creates the bg-div at the right z-index)
    getDM(({ socket, sceneManager }) => {
      if (sceneManager && sceneManager.sceneRenderer) {
        sceneManager.sceneRenderer.setBackgroundColor('#000000');
      }

      // Sync tileMap when a new scene is loaded so the eraser works on existing paint tiles
      socket.on('sceneData', (scene) => {
        for (const k in tileMap) delete tileMap[k];
        if (scene && scene.tokens) {
          scene.tokens.forEach(t => {
            if (t.isPaintTile || (t.tokenId && t.tokenId.startsWith('paint-'))) {
              const col = Math.round(t.x / gridSize);
              const row = Math.round(t.y / gridSize);
              tileMap[`${col},${row}`] = t.tokenId;
            }
          });
        }
      });
    });

    bgPicker.addEventListener('input', () => {
      // Route ALL bg changes through sceneRenderer so the z-indexed bg-div is updated
      getDM(({ socket, sceneManager }) => {
        if (sceneManager && sceneManager.sceneRenderer) {
          sceneManager.sceneRenderer.setBackgroundColor(bgPicker.value);
        }
        // Broadcast bg color to players
        socket.emit('setBgColor', { color: bgPicker.value });
      });
    });

    buildGrid();
    buildPreview();
    bindMouseEvents();
  });

  // ── Active tool helper ───────────────────────────────────
  function setActiveTool(t) {
    document.querySelectorAll('.ptool, #paint-custom-btn, #paint-eraser-btn').forEach(b => b.classList.remove('ptool-active'));
    if (t === 'eraser') {
      document.getElementById('paint-eraser-btn').classList.add('ptool-active');
    } else if (t === 'custom') {
      document.getElementById('paint-custom-btn').classList.add('ptool-active');
    } else {
      const btn = document.querySelector(`.ptool[data-tool="${t}"]`);
      if (btn) btn.classList.add('ptool-active');
    }
    activeTool = t;
    window.VTT_ACTIVE_PAINT_TOOL = t;
    const sc = document.getElementById('scene-container');
    if (sc) sc.style.cursor = 'crosshair';
  }

  function deactivate() {
    document.querySelectorAll('.ptool, #paint-custom-btn, #paint-eraser-btn').forEach(b => b.classList.remove('ptool-active'));
    activeTool = null;
    window.VTT_ACTIVE_PAINT_TOOL = null;
    const sc = document.getElementById('scene-container');
    if (sc) sc.style.cursor = '';
    hidePreview();
  }

  // ── Paint preview overlay ────────────────────────────────
  function buildPreview() {
    previewEl = document.createElement('div');
    previewEl.id = 'paint-preview-overlay';
    previewEl.style.cssText = 'position:absolute;pointer-events:none;z-index:99;display:none;box-sizing:border-box;';
    const sc = document.getElementById('scene-container');
    if (sc) sc.appendChild(previewEl);
  }

  function updatePreview(e, sc) {
    if (previewEl && !previewEl.parentNode) sc.appendChild(previewEl);
    if (!previewEl || !activeTool) { hidePreview(); return; }

    const rect     = sc.getBoundingClientRect();
    const renderer = window.VTT_DM && window.VTT_DM.sceneManager && window.VTT_DM.sceneManager.sceneRenderer;
    const scale    = renderer ? renderer.scale   : 1;
    const offsetX  = renderer ? renderer.offsetX : 0;
    const offsetY  = renderer ? renderer.offsetY : 0;

    const mx  = (e.clientX - rect.left) / scale - offsetX;
    const my  = (e.clientY - rect.top)  / scale - offsetY;
    const col = Math.floor(mx / gridSize - (brushSize - 1) / 2);
    const row = Math.floor(my / gridSize - (brushSize - 1) / 2);

    const left   = (col * gridSize + offsetX) * scale;
    const top    = (row * gridSize + offsetY) * scale;
    const w      = brushSize * gridSize * scale;
    const h      = brushSize * gridSize * scale;
    const cellPx = gridSize * scale;

    let borderClr, bgClr;
    if (activeTool === 'eraser') {
      borderClr = '#ff4444';
      bgClr     = 'rgba(255,68,68,0.15)';
    } else {
      const cfg = activeTool === 'custom' ? null : TOOLS[activeTool];
      borderClr = '#ffffff';
      bgClr     = cfg ? `${cfg.bg}44` : 'rgba(255,255,255,0.15)';
    }

    previewEl.style.left   = `${left}px`;
    previewEl.style.top    = `${top}px`;
    previewEl.style.width  = `${w}px`;
    previewEl.style.height = `${h}px`;
    previewEl.style.border = `2px solid ${borderClr}`;
    previewEl.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.5)`;
    if (brushSize > 1) {
      previewEl.style.background = `linear-gradient(to right,${borderClr}55 1px,transparent 1px),linear-gradient(to bottom,${borderClr}55 1px,transparent 1px),${bgClr}`;
      previewEl.style.backgroundSize = `${cellPx}px ${cellPx}px,${cellPx}px ${cellPx}px,auto`;
    } else {
      previewEl.style.background     = bgClr;
      previewEl.style.backgroundSize = '';
    }
    previewEl.style.display = '';
  }

  function hidePreview() {
    if (previewEl) previewEl.style.display = 'none';
  }

  // ── Grid overlay ─────────────────────────────────────────
  function buildGrid() {
    gridCanvas = document.createElement('canvas');
    gridCanvas.id = 'paint-grid-canvas';
    gridCanvas.style.cssText = `
      position:absolute; top:0; left:0;
      pointer-events:none; z-index:1; opacity:.35;
      width:6000px; height:6000px;`;
    gridCanvas.width  = 6000;
    gridCanvas.height = 6000;
    drawGrid();
  }

  function applyGridTransform() {
    if (!gridCanvas) return;
    const renderer = window.VTT_DM && window.VTT_DM.sceneManager && window.VTT_DM.sceneManager.sceneRenderer;
    if (renderer) {
      const spacing = gridSize * renderer.scale;
      const phaseX  = ((renderer.offsetX * renderer.scale) % spacing + spacing) % spacing;
      const phaseY  = ((renderer.offsetY * renderer.scale) % spacing + spacing) % spacing;
      gridCanvas.style.transformOrigin = '0 0';
      gridCanvas.style.transform = `translate(${phaseX}px, ${phaseY}px) scale(${renderer.scale})`;
    }
  }

  function drawGrid() {
    // Ensure the canvas is attached to the DOM (it might have been wiped by renderScene)
    if (gridCanvas && !gridCanvas.parentNode) {
      const sc = document.getElementById('scene-container');
      if (sc) sc.appendChild(gridCanvas);
      applyGridTransform(); // Restore correct transform after re-attach
    }

    const renderer = window.VTT_GRID_RENDERER;
    if (!renderer) return;
    if (!showGrid) return;
    gridType = window.VTT_GRID_TYPE || gridType;
    renderer.drawGrid(gridCanvas, {
      size: gridSize,
      type: gridType,
      color: 'rgba(255,255,255,0.5)',
    });
  }

  function updateGrid() { drawGrid(); gridCanvas.style.display = showGrid ? '' : 'none'; }
  function rebuildGrid() { drawGrid(); }

  // ── Mouse events ─────────────────────────────────────────
  function bindMouseEvents() {
    function tryBind() {
      const sc = document.getElementById('scene-container');
      if (!sc) { setTimeout(tryBind, 200); return; }

      sc.addEventListener('mousedown', e => {
        if (window.VTT_ACTIVE_RULER_TOOL) return;
        if (!activeTool || e.button !== 0) return;
        isDrawing = true;
        handlePaint(e, sc);
      });
      sc.addEventListener('mousemove', e => {
        if (window.VTT_ACTIVE_RULER_TOOL) { hidePreview(); return; }
        updatePreview(e, sc);
        if (!isDrawing || !activeTool) return;
        handlePaint(e, sc);
      });
      sc.addEventListener('mouseleave', hidePreview);
      window.addEventListener('mouseup', () => { isDrawing = false; });
    }
    tryBind();
  }

  // ── Paint / erase a cell ─────────────────────────────────
  function handlePaint(e, sc) {
    const rect     = sc.getBoundingClientRect();
    const renderer = window.VTT_DM && window.VTT_DM.sceneManager && window.VTT_DM.sceneManager.sceneRenderer;
    const scale    = renderer ? renderer.scale   : 1;
    const offsetX  = renderer ? renderer.offsetX : 0;
    const offsetY  = renderer ? renderer.offsetY : 0;

    const mx        = (e.clientX - rect.left) / scale - offsetX;
    const my        = (e.clientY - rect.top)  / scale - offsetY;
    const originCol = Math.floor(mx / gridSize - (brushSize - 1) / 2);
    const originRow = Math.floor(my / gridSize - (brushSize - 1) / 2);

    if (activeTool === 'eraser') {
      for (let dc = 0; dc < brushSize; dc++) {
        for (let dr = 0; dr < brushSize; dr++) {
          eraseTile(`${originCol + dc},${originRow + dr}`);
        }
      }
      return;
    }

    getDM(({ socket, sceneManager }) => {
      if (!sceneManager.currentScene) return;
      const sceneId = sceneManager.currentScene.sceneId;
      const rendererNow = window.VTT_DM && window.VTT_DM.sceneManager && window.VTT_DM.sceneManager.sceneRenderer;
      const scaleNow   = rendererNow ? rendererNow.scale   : 1;
      const offXNow    = rendererNow ? rendererNow.offsetX : 0;
      const offYNow    = rendererNow ? rendererNow.offsetY : 0;

      for (let dc = 0; dc < brushSize; dc++) {
        for (let dr = 0; dr < brushSize; dr++) {
          const col = originCol + dc;
          const row = originRow + dr;
          const key = `${col},${row}`;

          // Replace existing tile of different tool; skip if same tool
          if (tileMap[key]) {
            const el = document.getElementById(`token-${tileMap[key]}`);
            if (el && el.dataset.tool === activeTool) continue;
            eraseTile(key);
          }

          const tokenId = `paint-${col}-${row}-${Date.now()}`;
          const x = col * gridSize;
          const y = row * gridSize;

          const token = {
            tokenId,
            sceneId,
            imageUrl: makeSVG(activeTool),
            mediaType: 'image',
            x, y,
            width:  gridSize,
            height: gridSize,
            rotation: 0,
            zIndex: window.VTT_PAINT_LAYER ?? -10,
            movableByPlayers: false,
            hidden: false,
            isPaintTile: true,
            paintTool: activeTool,
          };

          tileMap[key] = tokenId;
          sceneManager.currentScene.tokens.push(token);
          socket.emit('addToken', { sceneId, token });

          const el = document.createElement('img');
          el.id = `token-${tokenId}`;
          el.src = token.imageUrl;
          el.dataset.tool = activeTool;
          el.className = 'token paint-tile-el';
          el.style.cssText = `position:absolute;
            left:${(x + offXNow) * scaleNow}px; top:${(y + offYNow) * scaleNow}px;
            width:${gridSize * scaleNow}px; height:${gridSize * scaleNow}px;
            z-index:-10; pointer-events:none; draggable:false;`;
          el.draggable = false;
          sc.appendChild(el);
        }
      }
    });
  }

  function eraseTile(key) {
    const tokenId = tileMap[key];
    if (!tokenId) return;
    delete tileMap[key];

    getDM(({ socket, sceneManager }) => {
      if (!sceneManager.currentScene) return;
      const sceneId = sceneManager.currentScene.sceneId;
      socket.emit('removeToken', { sceneId, tokenId });
      const el = document.getElementById(`token-${tokenId}`);
      if (el) el.remove();
      const idx = sceneManager.currentScene.tokens.findIndex(t => t.tokenId === tokenId);
      if (idx !== -1) sceneManager.currentScene.tokens.splice(idx, 1);
    });
  }
})();
