// =========================================================
//  DND VTT – Effects Tool (DM side)
//  Spawns transparent shape overlay tokens that act like
//  normal tokens (movable, scalable, rotatable).
//  Breathing uses SVG SMIL animation (works in <img> src).
// =========================================================

(function () {
  const FT_PER_CELL = 5;

  const PRESETS = [
    { name: 'Fire',      color: '#FF4500' },
    { name: 'Ice',       color: '#00BFFF' },
    { name: 'Lightning', color: '#FFFF00' },
    { name: 'Acid',      color: '#7FFF00' },
    { name: 'Poison',    color: '#9B59B6' },
    { name: 'Thunder',   color: '#6495ED' },
    { name: 'Necrotic',  color: '#6B0AC9' },
    { name: 'Radiant',   color: '#FFF176' },
    { name: 'Force',     color: '#E040FB' },
    { name: 'Psychic',   color: '#F48FB1' },
    { name: 'Fog',       color: '#B0BEC5' },
    { name: 'Darkness',  color: '#1A237E' },
  ];

  let activeShape  = 'square';
  let activeColor  = PRESETS[0].color;
  let sizeFt       = 30;
  let isBreathing  = false;

  function getGridPx() { return window.VTT_GRID_SIZE || 60; }
  function ftToPx(ft)  { return (ft / FT_PER_CELL) * getGridPx(); }

  // ── SVG builders ──────────────────────────────────────────
  function breatheAnim(startOpacity) {
    // SMIL animation — works inside SVG used as <img> src
    const lo  = Math.max(0.04, startOpacity * 0.2).toFixed(2);
    const hi  = Math.min(0.70, startOpacity * 1.4).toFixed(2);
    return `<animate attributeName="fill-opacity"` +
      ` values="${lo};${hi};${lo}" dur="2.5s" repeatCount="indefinite"` +
      ` calcMode="spline" keyTimes="0;0.5;1"` +
      ` keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>`;
  }

  function buildSVG(shape, color, ft, breathing) {
    const px      = Math.round(ftToPx(ft));
    const fill    = color;
    const initOp  = 0.4;
    const anim    = breathing ? breatheAnim(initOp) : '';

    let svgBody, w, h;

    if (shape === 'circle') {
      w = px * 2;
      h = px * 2;
      const sw = Math.max(2, Math.round(px * 0.025));
      svgBody  = `<circle cx="${px}" cy="${px}" r="${px - sw / 2}"` +
        ` fill="${fill}" fill-opacity="${initOp}"` +
        ` stroke="${fill}" stroke-width="${sw}">${anim}</circle>`;

    } else if (shape === 'cone') {
      w = px;
      h = px;
      const sw   = Math.max(2, Math.round(px * 0.025));
      const half = Math.round(px / 2);
      svgBody    = `<polygon points="0,${half} ${px},0 ${px},${px}"` +
        ` fill="${fill}" fill-opacity="${initOp}"` +
        ` stroke="${fill}" stroke-width="${sw}" stroke-linejoin="round">${anim}</polygon>`;

    } else if (shape === 'line') {
      // Width = length; height = 1 grid cell (5 ft wide)
      w = px;
      h = Math.max(20, Math.round(getGridPx()));
      const sw = Math.max(2, Math.round(h * 0.12));
      svgBody  = `<rect x="${sw / 2}" y="${sw / 2}"` +
        ` width="${Math.max(1, w - sw)}" height="${Math.max(1, h - sw)}"` +
        ` fill="${fill}" fill-opacity="${initOp}"` +
        ` stroke="${fill}" stroke-width="${sw}">${anim}</rect>`;

    } else {
      // square
      w = px;
      h = px;
      const sw = Math.max(2, Math.round(px * 0.025));
      svgBody  = `<rect x="${sw / 2}" y="${sw / 2}"` +
        ` width="${Math.max(1, px - sw)}" height="${Math.max(1, px - sw)}"` +
        ` fill="${fill}" fill-opacity="${initOp}"` +
        ` stroke="${fill}" stroke-width="${sw}">${anim}</rect>`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgBody}</svg>`;
    return { svg, w, h };
  }

  // ── Spawn ─────────────────────────────────────────────────
  function spawnEffect() {
    const dm = window.VTT_DM;
    if (!dm?.sceneManager?.currentScene) {
      alert('No scene is currently loaded.');
      return;
    }

    const { svg, w, h } = buildSVG(activeShape, activeColor, sizeFt, isBreathing);
    const imageUrl = 'data:image/svg+xml;base64,' + btoa(svg);

    const sm = dm.sceneManager;
    const r  = sm.sceneRenderer;

    const wx = (window.innerWidth  / 2 / r.scale) - r.offsetX - w / 2;
    const wy = (window.innerHeight / 2 / r.scale) - r.offsetY - h / 2;

    const token = {
      tokenId:          Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      imageUrl,
      x:                wx,
      y:                wy,
      width:            w,
      height:           h,
      zIndex:           200,
      hidden:           false,
      movableByPlayers: false,
      rotation:         0,
      isAreaEffect:     true,
    };

    sm.socket.emit('addToken', { sceneId: sm.currentScene.sceneId, token });
  }

  // ── Label + preview ───────────────────────────────────────
  function updateSizeLabel() {
    const el = document.getElementById('ae-size-display');
    if (el) el.textContent = `${sizeFt}ft`;
  }

  function updatePreview() {
    const preview = document.getElementById('ae-preview');
    if (!preview) return;
    const { svg, w, h } = buildSVG(activeShape, activeColor, sizeFt, isBreathing);
    const boxSize = 68;
    const scale   = boxSize / Math.max(w, h);
    // Inject SVG directly — SMIL animations run inline
    preview.innerHTML =
      `<div style="transform:scale(${scale.toFixed(4)});transform-origin:center;` +
      `width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;">` +
      svg + `</div>`;
  }

  // ── Init ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {

    // Color presets
    const grid = document.getElementById('ae-presets');
    if (grid) {
      PRESETS.forEach((p, i) => {
        const btn = document.createElement('button');
        btn.className     = 'ae-swatch' + (i === 0 ? ' active' : '');
        btn.title         = p.name;
        btn.dataset.color = p.color;
        btn.style.cssText = `background:${p.color};`;
        btn.addEventListener('click', () => {
          activeColor = p.color;
          document.getElementById('ae-color-pick').value = p.color;
          document.querySelectorAll('.ae-swatch').forEach(s => s.classList.remove('active'));
          btn.classList.add('active');
          updatePreview();
        });
        grid.appendChild(btn);
      });
    }

    // Shape buttons
    document.querySelectorAll('.ae-shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeShape = btn.dataset.shape;
        document.querySelectorAll('.ae-shape-btn').forEach(b => b.classList.remove('ae-active'));
        btn.classList.add('ae-active');
        updateSizeLabel();
        updatePreview();
      });
    });

    // Size slider
    const sizeSlider = document.getElementById('ae-size-input');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', () => {
        sizeFt = parseInt(sizeSlider.value);
        updateSizeLabel();
        updatePreview();
      });
    }

    // Custom color
    const pick = document.getElementById('ae-color-pick');
    if (pick) {
      pick.addEventListener('input', () => {
        activeColor = pick.value;
        document.querySelectorAll('.ae-swatch').forEach(s => s.classList.remove('active'));
        updatePreview();
      });
    }

    // Breathing toggle
    const breatheCheck = document.getElementById('ae-breathe-check');
    if (breatheCheck) {
      breatheCheck.addEventListener('change', () => {
        isBreathing = breatheCheck.checked;
        updatePreview();
      });
    }

    // Spawn
    document.getElementById('ae-spawn-btn')?.addEventListener('click', spawnEffect);

    updateSizeLabel();
    updatePreview();
  });
})();
