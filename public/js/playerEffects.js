// Player-only area effects. These are local overlays and never sync to the server.
(function () {
  const FT_PER_CELL = 5;
  const EFFECT_Z_INDEX = 2147483000;
  const LS_KEY = 'vtt-player-effects';

  const PRESETS = [
    { name: 'Fire', color: '#FF4500' },
    { name: 'Ice', color: '#00BFFF' },
    { name: 'Lightning', color: '#FFFF00' },
    { name: 'Acid', color: '#7FFF00' },
    { name: 'Poison', color: '#9B59B6' },
    { name: 'Thunder', color: '#6495ED' },
    { name: 'Necrotic', color: '#6B0AC9' },
    { name: 'Radiant', color: '#FFF176' },
    { name: 'Force', color: '#E040FB' },
    { name: 'Psychic', color: '#F48FB1' },
    { name: 'Fog', color: '#B0BEC5' },
    { name: 'Darkness', color: '#1A237E' },
  ];

  let activeShape = 'square';
  let activeColor = PRESETS[0].color;
  let sizeFt = 30;
  let isBreathing = false;
  let selectedId = null;

  let effects = [];

  function getGridPx() {
    return window.VTT_GRID_SIZE || 60;
  }

  function ftToPx(ft) {
    return (ft / FT_PER_CELL) * getGridPx();
  }

  function breatheAnim(startOpacity) {
    const lo = Math.max(0.04, startOpacity * 0.2).toFixed(2);
    const hi = Math.min(0.70, startOpacity * 1.4).toFixed(2);
    return `<animate attributeName="fill-opacity"` +
      ` values="${lo};${hi};${lo}" dur="2.5s" repeatCount="indefinite"` +
      ` calcMode="spline" keyTimes="0;0.5;1"` +
      ` keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>`;
  }

  function buildSVG(shape, color, ft, breathing) {
    const px = Math.round(ftToPx(ft));
    const initOp = 0.4;
    const anim = breathing ? breatheAnim(initOp) : '';
    let svgBody;
    let w;
    let h;

    if (shape === 'circle') {
      w = px * 2;
      h = px * 2;
      const sw = Math.max(2, Math.round(px * 0.025));
      svgBody = `<circle cx="${px}" cy="${px}" r="${px - sw / 2}"` +
        ` fill="${color}" fill-opacity="${initOp}"` +
        ` stroke="${color}" stroke-width="${sw}">${anim}</circle>`;
    } else if (shape === 'cone') {
      w = px;
      h = px;
      const sw = Math.max(2, Math.round(px * 0.025));
      const half = Math.round(px / 2);
      svgBody = `<polygon points="0,${half} ${px},0 ${px},${px}"` +
        ` fill="${color}" fill-opacity="${initOp}"` +
        ` stroke="${color}" stroke-width="${sw}" stroke-linejoin="round">${anim}</polygon>`;
    } else if (shape === 'line') {
      w = px;
      h = Math.max(20, Math.round(getGridPx()));
      const sw = Math.max(2, Math.round(h * 0.12));
      svgBody = `<rect x="${sw / 2}" y="${sw / 2}"` +
        ` width="${Math.max(1, w - sw)}" height="${Math.max(1, h - sw)}"` +
        ` fill="${color}" fill-opacity="${initOp}"` +
        ` stroke="${color}" stroke-width="${sw}">${anim}</rect>`;
    } else {
      w = px;
      h = px;
      const sw = Math.max(2, Math.round(px * 0.025));
      svgBody = `<rect x="${sw / 2}" y="${sw / 2}"` +
        ` width="${Math.max(1, px - sw)}" height="${Math.max(1, px - sw)}"` +
        ` fill="${color}" fill-opacity="${initOp}"` +
        ` stroke="${color}" stroke-width="${sw}">${anim}</rect>`;
    }

    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgBody}</svg>`,
      w,
      h,
    };
  }

  function getRenderer() {
    return window.VTT_PLAYER?.sceneRenderer || null;
  }

  function getContainer() {
    return document.getElementById('scene-container');
  }

  function makeImageUrl(svg) {
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  function worldToScreen(effect) {
    const renderer = getRenderer();
    if (!renderer) return { left: 0, top: 0, width: effect.width, height: effect.height };
    return {
      left: (effect.x + renderer.offsetX) * renderer.scale,
      top: (effect.y + renderer.offsetY) * renderer.scale,
      width: effect.width * renderer.scale,
      height: effect.height * renderer.scale,
    };
  }

  function positionEffect(effect) {
    if (!effect.el) return;
    const pos = worldToScreen(effect);
    effect.el.style.left = `${pos.left}px`;
    effect.el.style.top = `${pos.top}px`;
    effect.el.style.width = `${pos.width}px`;
    effect.el.style.height = `${pos.height}px`;
    effect.el.style.zIndex = String(EFFECT_Z_INDEX);
  }

  function syncAllEffects() {
    effects.forEach(positionEffect);
  }

  function selectEffect(id) {
    selectedId = id;
    effects.forEach(effect => {
      if (effect.el) {
        effect.el.classList.toggle('player-area-effect-selected', effect.id === id);
      }
    });
  }

  function removeSelectedEffect() {
    if (!selectedId) return;
    const index = effects.findIndex(effect => effect.id === selectedId);
    if (index === -1) {
      selectedId = null;
      return;
    }

    const [effect] = effects.splice(index, 1);
    if (effect.el && effect.el.parentNode) effect.el.remove();
    selectedId = null;
    saveEffects();
  }

  function detachAllEffects() {
    effects.forEach(effect => {
      if (effect.el && effect.el.parentNode) effect.el.remove();
      effect.el = null;
    });
    selectedId = null;
  }

  function makeEffectDraggable(effect) {
    if (!window.interact || !effect.el) return;

    interact(effect.el).draggable({
      listeners: {
        start(event) {
          event.preventDefault();
          selectEffect(effect.id);
        },
        move(event) {
          const renderer = getRenderer();
          if (!renderer) return;
          effect.x += event.dx / renderer.scale;
          effect.y += event.dy / renderer.scale;
          positionEffect(effect);
        },
        end() {
          saveEffects();
        },
      },
    });
  }

  function renderEffect(effect, shouldSelect = true) {
    const container = getContainer();
    if (!container) return;
    if (effect.el && effect.el.parentNode === container) return;

    const img = document.createElement('img');
    img.className = 'player-area-effect';
    img.dataset.playerEffectId = effect.id;
    img.src = effect.imageUrl;
    img.draggable = false;
    img.addEventListener('click', event => {
      event.stopPropagation();
      selectEffect(effect.id);
    });
    img.addEventListener('mousedown', event => {
      event.stopPropagation();
      selectEffect(effect.id);
    });

    effect.el = img;
    container.appendChild(img);
    positionEffect(effect);
    makeEffectDraggable(effect);
    if (shouldSelect) selectEffect(effect.id);
  }

  function renderAllEffects() {
    detachAllEffects();
    effects.forEach(effect => renderEffect(effect, false));
    syncAllEffects();
  }

  function spawnEffect() {
    const renderer = getRenderer();
    if (!renderer || !window.VTT_PLAYER?.currentScene) {
      alert('No scene is currently loaded.');
      return;
    }

    const { svg, w, h } = buildSVG(activeShape, activeColor, sizeFt, isBreathing);
    const effect = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      x: (window.innerWidth / 2 / renderer.scale) - renderer.offsetX - w / 2,
      y: (window.innerHeight / 2 / renderer.scale) - renderer.offsetY - h / 2,
      width: w,
      height: h,
      imageUrl: makeImageUrl(svg),
      el: null,
    };

    effects.push(effect);
    renderEffect(effect);
    saveEffects();
  }

  function saveEffects() {
    try {
      const serializable = effects.map(({ el, ...effect }) => effect);
      localStorage.setItem(LS_KEY, JSON.stringify(serializable));
    } catch (e) {}
  }

  function loadEffects() {
    try {
      const data = localStorage.getItem(LS_KEY);
      effects = data ? JSON.parse(data) : [];
    } catch (e) {
      effects = [];
    }
    effects.forEach(effect => { effect.el = null; });
    renderAllEffects();
  }

  function updateSizeLabel() {
    const el = document.getElementById('ae-size-display');
    if (el) el.textContent = `${sizeFt}ft`;
  }

  function updatePreview() {
    const preview = document.getElementById('ae-preview');
    if (!preview) return;
    const { svg, w, h } = buildSVG(activeShape, activeColor, sizeFt, isBreathing);
    const boxSize = 68;
    const scale = boxSize / Math.max(w, h);
    preview.innerHTML =
      `<div style="transform:scale(${scale.toFixed(4)});transform-origin:center;` +
      `width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;">` +
      svg + '</div>';
  }

  function setupColorPresets() {
    const grid = document.getElementById('ae-presets');
    if (!grid || grid.dataset.initialized === 'true') return;
    grid.dataset.initialized = 'true';

    PRESETS.forEach((preset, index) => {
      const btn = document.createElement('button');
      btn.className = 'ae-swatch' + (index === 0 ? ' active' : '');
      btn.title = preset.name;
      btn.dataset.color = preset.color;
      btn.style.background = preset.color;
      btn.addEventListener('click', () => {
        activeColor = preset.color;
        const picker = document.getElementById('ae-color-pick');
        if (picker) picker.value = preset.color;
        document.querySelectorAll('.ae-swatch').forEach(swatch => swatch.classList.remove('active'));
        btn.classList.add('active');
        updatePreview();
      });
      grid.appendChild(btn);
    });
  }

  function setupPanelToggle() {
    const btn = document.getElementById('player-effects-toggle-btn');
    const panel = document.getElementById('player-area-effect-panel');
    if (!btn || !panel) return;

    btn.addEventListener('click', () => {
      const isHidden = panel.classList.toggle('panel-hidden');
      btn.style.background = isHidden ? '#151515' : '#c62828';
      btn.style.borderColor = isHidden ? 'rgba(255,255,255,0.16)' : '#c62828';
    });
  }

  function makePanelDraggable() {
    const panel = document.getElementById('player-area-effect-panel');
    const handle = panel?.querySelector('.panel-drag-handle');
    if (!panel || !handle) return;

    let originX = 0;
    let originY = 0;
    let startX = 0;
    let startY = 0;

    handle.addEventListener('mousedown', event => {
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      originX = rect.left;
      originY = rect.top;

      panel.style.right = 'auto';
      panel.style.left = `${originX}px`;
      panel.style.top = `${originY}px`;
      panel.style.position = 'fixed';

      function onMove(moveEvent) {
        panel.style.left = `${originX + moveEvent.clientX - startX}px`;
        panel.style.top = `${originY + moveEvent.clientY - startY}px`;
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  function setupControlEvents() {
    document.querySelectorAll('.ae-shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeShape = btn.dataset.shape || 'square';
        document.querySelectorAll('.ae-shape-btn').forEach(shapeBtn => shapeBtn.classList.remove('ae-active'));
        btn.classList.add('ae-active');
        updateSizeLabel();
        updatePreview();
      });
    });

    const sizeSlider = document.getElementById('ae-size-input');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', () => {
        sizeFt = parseInt(sizeSlider.value, 10) || 30;
        updateSizeLabel();
        updatePreview();
      });
    }

    const picker = document.getElementById('ae-color-pick');
    if (picker) {
      picker.addEventListener('input', () => {
        activeColor = picker.value;
        document.querySelectorAll('.ae-swatch').forEach(swatch => swatch.classList.remove('active'));
        updatePreview();
      });
    }

    const breatheCheck = document.getElementById('ae-breathe-check');
    if (breatheCheck) {
      breatheCheck.addEventListener('change', () => {
        isBreathing = breatheCheck.checked;
        updatePreview();
      });
    }

    document.getElementById('ae-spawn-btn')?.addEventListener('click', spawnEffect);
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function setupDeleteKey() {
    document.addEventListener('keydown', event => {
      if (event.key !== 'Delete' || isTypingTarget(event.target)) return;
      if (!selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      removeSelectedEffect();
    }, true);
  }

  function setupSceneDeselect() {
    const container = getContainer();
    if (!container) return;
    container.addEventListener('click', event => {
      if (event.target.closest('.player-area-effect')) return;
      selectEffect(null);
    });
  }

  function hookRenderer() {
    const renderer = getRenderer();
    if (!renderer) {
      window.setTimeout(hookRenderer, 100);
      return;
    }
    if (renderer._playerEffectsHooked) return;

    const originalUpdateAll = renderer.updateAllTokenElements.bind(renderer);
    renderer.updateAllTokenElements = function (...args) {
      const result = originalUpdateAll(...args);
      syncAllEffects();
      return result;
    };

    const originalRenderScene = renderer.renderScene.bind(renderer);
    renderer.renderScene = function (...args) {
      const result = originalRenderScene(...args);
      renderAllEffects();
      return result;
    };

    renderer._playerEffectsHooked = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupPanelToggle();
    makePanelDraggable();
    setupColorPresets();
    setupControlEvents();
    setupDeleteKey();
    setupSceneDeselect();
    hookRenderer();
    (function tryLoadEffects() {
      if (getRenderer()) {
        loadEffects();
      } else {
        window.setTimeout(tryLoadEffects, 100);
      }
    })();
    updateSizeLabel();
    updatePreview();
  });
})();
