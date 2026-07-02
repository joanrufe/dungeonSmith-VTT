// public/js/sceneRenderer.js

/** @typedef {import('./sceneManager.js').TokenDict} TokenDict */
/** @typedef {import('./sceneManager.js').SceneDict} SceneDict */

export class SceneRenderer {
  constructor(container, isDM = false) {
    this.container = container;
    this.isDM = isDM;
    this.tokens = [];
    this.walls = [];
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.fogOpacity = 1.0;
  }

  /**
   * @param {WallDict[]} walls
   */
  setWalls(walls) {
    this.walls = walls || [];
    if (this.isDM) {
      this.renderWallsOverlay();
    } else {
      this.drawFog();
    }
  }

  /**
   * Update the fog overlay opacity and redraw it.
   * @param {number} v opacity in [0, 1]
   */
  setFogOpacity(v) {
    const clamped = Math.max(0, Math.min(1, Number(v) || 0));
    this.fogOpacity = clamped;
    this.drawFog();
  }

  // ── Background colour helpers ───────────────────────────
  // We use a child <div id="scene-bg-el"> at z-index:-9999 instead of
  // setting backgroundColor on the container itself.  If we used the
  // container's own background, children with negative z-index (paint tiles
  // are at -10) would be drawn *behind* the background and become invisible.

  _getBgEl() {
    let el = document.getElementById('scene-bg-el');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scene-bg-el';
      el.style.cssText = [
        'position:absolute',
        'top:0', 'left:0',
        'width:100%', 'height:100%',
        'z-index:-9999',
        'pointer-events:none',
      ].join(';');
      el.style.backgroundColor = this._bgColor || '#000000';
      this.container.appendChild(el);
    }
    return el;
  }

  /**
   * @param {SceneDict} scene
   */
  renderScene(scene) {
    this.resetCamera();
    // Remember bg color then restore after the innerHTML wipe
    const savedBg = this._bgColor || '#000000';
    this.container.innerHTML = ''; // Clear existing content
    // Clear the container's own background (we use scene-bg-el instead)
    this.container.style.backgroundColor = '';
    this._bgColor = savedBg;
    // Re-create the background layer
    this._getBgEl();

    // Pull the per-scene fog opacity (default 1.0 = fully opaque).
    this.fogOpacity = Math.max(0, Math.min(1, Number(scene.fogOpacity) || 1));

    // For DM, include all tokens; for players, include only visible tokens
    if (this.isDM) {
      this.tokens = scene.tokens;
    } else {
      this.tokens = scene.tokens.filter(token => !token.hidden);
    }

    // Sort tokens by zIndex
    this.tokens.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    // Render tokens
    this.tokens.forEach((token) => {
      this.renderToken(token);
    });

    // DM sees walls as an SVG overlay; players use them for LOS math only
    if (this.isDM) {
      this.renderWallsOverlay();
    }

    // Players get a fog overlay canvas; DM is exempt
    if (!this.isDM) {
      this._ensureFogCanvas();
      this.drawFog();
    }
  }

  /** Called by the BG color picker and by the setBgColor socket event. */
  setBackgroundColor(color) {
    this._bgColor = color;
    // Update the bg element if it already exists in the DOM
    const el = document.getElementById('scene-bg-el');
    if (el) {
      el.style.backgroundColor = color;
    } else {
      // Container exists but bg el doesn't yet – set via _getBgEl
      this._getBgEl().style.backgroundColor = color;
    }
    // Make sure the container itself has no competing background
    this.container.style.backgroundColor = '';
  }

  /**
   * Render (or refresh) the DM-only SVG wall overlay.
   * Survives token re-renders because it is rebuilt after tokens.
   */
  renderWallsOverlay() {
    if (!this.isDM) return;
    let svg = document.getElementById('walls-overlay');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'walls-overlay';
      svg.style.cssText = [
        'position:absolute',
        'top:0', 'left:0',
        'width:100%', 'height:100%',
        'pointer-events:none',
        'z-index:200',
      ].join(';');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      this.container.appendChild(svg);
    }
    // Rebuild polygons so we never have stale DOM
    svg.innerHTML = '';
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const wall of this.walls || []) {
      const points = wall.points || [];
      if (points.length < 3) continue;
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const ptsAttr = points
        .map(p => `${(p.x + this.offsetX) * this.scale},${(p.y + this.offsetY) * this.scale}`)
        .join(' ');
      poly.setAttribute('points', ptsAttr);
      poly.setAttribute('data-wall-id', wall.wallId);
      poly.classList.add('wall-overlay-line');
      group.appendChild(poly);
    }
    svg.appendChild(group);
  }

  /**
   * @param {TokenDict} token
   */
  _syncHpBar(token) {
    if (token.isPaintTile) return;
    const BAR_H = 6, GAP = 3;
    let bar = document.getElementById(`hpbar-${token.tokenId}`);
    const hasHp = token.hpMax > 0 && token.hpCurrent != null;
    if (!hasHp || (!this.isDM && token.hidden)) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = `hpbar-${token.tokenId}`;
      bar.className = 'token-hp-bar';
      bar.appendChild(document.createElement('div')).className = 'token-hp-bar-fill';
      this.container.appendChild(bar);
    }
    const pct   = Math.max(0, Math.min(1, token.hpCurrent / token.hpMax));
    const color = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
    bar.style.left    = `${(token.x + this.offsetX) * this.scale}px`;
    bar.style.top     = `${(token.y + this.offsetY) * this.scale - BAR_H - GAP}px`;
    bar.style.width   = `${token.width * this.scale}px`;
    bar.style.height  = `${BAR_H}px`;
    bar.style.opacity = (this.isDM && token.hidden) ? '0.5' : '1';
    bar.querySelector('.token-hp-bar-fill').style.width      = `${pct * 100}%`;
    bar.querySelector('.token-hp-bar-fill').style.background = color;
  }

  /**
   * @param {TokenDict} token
   */
  _syncConditionLabel(token) {
    if (token.isPaintTile) return;
    const BAR_H = 6, BAR_GAP = 3, LABEL_GAP = 2;
    let label = document.getElementById(`cond-${token.tokenId}`);
    const hasText = token.conditionText && token.conditionText.trim();
    if (!hasText || (!this.isDM && token.hidden)) { if (label) label.remove(); return; }
    if (!label) {
      label = document.createElement('div');
      label.id = `cond-${token.tokenId}`;
      label.className = 'token-condition-label';
      this.container.appendChild(label);
    }
    const baseFontSize  = token.conditionFontSize || 22;
    const scaledFont    = Math.max(9, Math.round(baseFontSize * this.scale));
    const labelH        = scaledFont + 2;
    const totalOffset   = BAR_H + BAR_GAP + labelH + LABEL_GAP;
    label.textContent        = token.conditionText;
    label.style.color        = token.conditionColor || '#ffffff';
    label.style.fontSize     = `${scaledFont}px`;
    label.style.lineHeight   = `${labelH}px`;
    label.style.left         = `${(token.x + this.offsetX) * this.scale}px`;
    label.style.top          = `${(token.y + this.offsetY) * this.scale - totalOffset}px`;
    label.style.width        = `${token.width * this.scale}px`;
    label.style.opacity      = (this.isDM && token.hidden) ? '0.5' : '1';
  }

  /**
   * @param {TokenDict} token
   * @returns {HTMLElement|undefined}
   */
  renderToken(token) {
    if (!this.isDM && token.hidden) {
      return;
    }

    let element;
    if (token.mediaType === 'video') {
      element = document.createElement('video');
      element.src = token.imageUrl;
      element.autoplay = true;
      element.loop = true;
      element.muted = true; // Muted due to browser autoplay policies
    } else {
      element = document.createElement('img');
      element.src = token.imageUrl;
    }

    // Common properties
    element.id = `token-${token.tokenId}`;
    element.className = 'token';
    element.style.position = 'absolute';
    element.style.left = `${(token.x + this.offsetX) * this.scale}px`;
    element.style.top = `${(token.y + this.offsetY) * this.scale}px`;
    element.style.width = `${token.width * this.scale}px`;
    element.style.height = `${token.height * this.scale}px`;
    element.style.transform = `rotate(${token.rotation}deg)`;
    element.style.zIndex = token.zIndex || 0;
    element.dataset.tokenId = token.tokenId;

    if (token.isPaintTile) {
      element.classList.add('paint-tile-el');
      element.style.pointerEvents = 'none';
    }

    if (this.isDM && token.hidden) {
      element.style.opacity = '0.5';
    }

    if (token.locked) {
      element.style.outline = '2px solid #ff3333';
      element.style.outlineOffset = '1px';
    }

    // Disable default browser dragging
    element.draggable = false;

    this.container.appendChild(element);
    this._syncHpBar(token);
    this._syncConditionLabel(token);

    return element;
  }

  // Update all token elements
  updateAllTokenElements() {
    this.tokens.forEach((token) => {
      if (!this.isDM && token.hidden) return; // Skip hidden tokens for players
      this.updateTokenElement(token);
    });

    // Keep grid canvas in sync with zoom/pan.
    // Use phase (modulo) instead of raw offset so the canvas always starts
    // near screen (0,0) and never leaves the top/left of the viewport uncovered.
    const _gridSpacing = (window.VTT_GRID_SIZE || 60) * this.scale;
    const _phaseX = ((this.offsetX * this.scale) % _gridSpacing + _gridSpacing) % _gridSpacing;
    const _phaseY = ((this.offsetY * this.scale) % _gridSpacing + _gridSpacing) % _gridSpacing;
    const gridCanvas = document.getElementById('paint-grid-canvas');
    if (gridCanvas) {
      gridCanvas.style.transformOrigin = '0 0';
      gridCanvas.style.transform = `translate(${_phaseX}px, ${_phaseY}px) scale(${this.scale})`;
    }
    const playerGridCanvas = document.getElementById('player-grid-canvas');
    if (playerGridCanvas) {
      playerGridCanvas.style.transformOrigin = '0 0';
      playerGridCanvas.style.transform = `translate(${_phaseX}px, ${_phaseY}px) scale(${this.scale})`;
    }

    // Redraw fog after any pan/zoom/token move (players only)
    if (!this.isDM) {
      this.drawFog();
    } else {
      this.renderWallsOverlay();
    }
  }

  // Update a single token element's position and size
  /**
   * @param {TokenDict} token
   */
  updateTokenElement(token) {
    const element = document.getElementById(`token-${token.tokenId}`);
  
    if (!this.isDM && token.hidden) {
      if (element && element.parentNode === this.container) {
        this.container.removeChild(element);
      }
      this._syncHpBar(token);
      this._syncConditionLabel(token);
      return;
    }
  
    if (element) {
      // Update element style
      element.style.left = `${(token.x + this.offsetX) * this.scale}px`;
      element.style.top = `${(token.y + this.offsetY) * this.scale}px`;
      element.style.width = `${token.width * this.scale}px`;
      element.style.height = `${token.height * this.scale}px`;
      element.style.transform = `rotate(${token.rotation}deg)`;
      element.style.zIndex = token.zIndex || 0;
      element.style.outline       = token.locked ? '2px solid #ff3333' : '';
      element.style.outlineOffset = token.locked ? '1px' : '';

      if (this.isDM && token.hidden) {
        element.style.opacity = '0.5';
      } else {
        element.style.opacity = '1';
      }
    } else if (!token.hidden || this.isDM) {
      // Token element doesn't exist, create it if it's not hidden
      this.renderToken(token);
      // Optionally set up token interactions
    }
    this._syncHpBar(token);
    this._syncConditionLabel(token);
  }

  resetCamera() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  // Kept as no-op for backwards compatibility – background is now always black
  // and controlled by the DM's BG color picker.
  setBackgroundBasedOnTokens() {
    // No-op – background controlled by BG color picker
  }

  // ── Fog of War overlay (player view only) ───────────────────────────────

  /**
   * Create (or return) the full-viewport fog canvas appended to #scene-container.
   * Called once per renderScene; position/size is maintained by _resizeFogCanvas
   * and the ResizeObserver set up in _attachFogResizeObserver.
   * @returns {HTMLCanvasElement}
   */
  _ensureFogCanvas() {
    let canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('fog-canvas'));
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'fog-canvas';
      canvas.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'pointer-events:none',
        'z-index:100',
      ].join(';');
      this.container.appendChild(canvas);
      this._attachFogResizeObserver(canvas);
    }
    this._resizeFogCanvas(canvas);
    return canvas;
  }

  /**
   * Size the canvas to match its container's current dimensions.
   * Must be called whenever the viewport or container changes size.
   * @param {HTMLCanvasElement} canvas
   */
  _resizeFogCanvas(canvas) {
    const w = this.container.clientWidth  || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
  }

  /**
   * Attach a ResizeObserver on #scene-container so the fog canvas stays
   * full-viewport when the browser window resizes. (Task 3.4)
   * @param {HTMLCanvasElement} canvas
   */
  _attachFogResizeObserver(canvas) {
    if (!window.ResizeObserver) return;
    if (this._fogResizeObserver) this._fogResizeObserver.disconnect();
    this._fogResizeObserver = new ResizeObserver(() => {
      this._resizeFogCanvas(canvas);
      this.drawFog();
    });
    this._fogResizeObserver.observe(this.container);
  }

  /**
   * Draw the fog overlay:
   * 1. Fill the entire canvas with the per-scene fog colour.
   * 2. For each vision source, punch a radial gradient vision circle with
   *    `destination-out`. The gradient gives a soft halo that extends to
   *    the full vision radius, so light "spills" around walls naturally.
   * 3. Re-occlude light inside any wall polygon that overlaps a vision
   *    circle (walls are physical light-blockers and always fully opaque).
   *
   * The radial gradient of the vision circle handles the soft "spill" around
   * walls. The wall polygons are subtracted as opaque masks on top, so any
   * area inside a wall stays dark. This avoids the spurious straight edges
   * that a visibility-polygon approach would introduce between wall vertices.
   */
  drawFog() {
    const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('fog-canvas'));
    if (!canvas) return;
    this._resizeFogCanvas(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Fog only makes sense when the current scene has at least one vision
    // source. Cover/splash scenes without vision tokens should remain fully
    // visible.
    const visionSources = this.tokens.filter((token) => {
      if (token.isMap) return false;
      if (token.isPaintTile) return false;
      if (token.isAreaEffect) return false;
      const radius = token.visionRadius;
      return radius && radius > 0;
    });
    if (visionSources.length === 0) return;

    const walls = (this.walls || []).filter(w => (w.points || []).length >= 3);

    const fogFill = `rgba(0,0,0,${this.fogOpacity})`;

    // Step 1: paint the fog layer. Opacity comes from the per-scene
    // fogOpacity setting (default 1.0 = fully opaque so the map is not
    // visible through the fog and players cannot infer the terrain under it).
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = fogFill;
    ctx.fillRect(0, 0, w, h);

    // Step 2: wall-aware vision carving
    //
    // For each vision source that overlaps a wall, compute a visibility
    // polygon by raycasting toward wall vertices (with dense fallback
    // rays so polygon edges follow the circle smoothly).  Paint that
    // polygon with a clipped radial gradient. For sources that do not overlap
    // any wall bounds, fall back to plain radial carving. Then paint each wall
    // polygon as a fully-opaque mask on top to re-occlude light inside the
    // wall.
    if (walls.length === 0) {
      ctx.globalCompositeOperation = 'destination-out';
      for (const token of visionSources) {
        const radius = token.visionRadius;
        if (!radius || radius <= 0) continue;
        const cx = (token.x + token.width  / 2 + this.offsetX) * this.scale;
        const cy = (token.y + token.height / 2 + this.offsetY) * this.scale;
        const sr = radius * this.scale;
        this._drawRadialVisionHole(ctx, cx, cy, sr);
      }
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    ctx.globalCompositeOperation = 'destination-out';

    for (const token of visionSources) {
      const radius = token.visionRadius;
      if (!radius || radius <= 0) continue;
      const cx = (token.x + token.width  / 2 + this.offsetX) * this.scale;
      const cy = (token.y + token.height / 2 + this.offsetY) * this.scale;
      const sr = radius * this.scale;

      // Check if the vision circle actually overlaps any wall
      let nearWall = false;
      for (const wall of walls) {
        const pts = wall.points;
        let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
        for (const p of pts) {
          const sx = (p.x + this.offsetX) * this.scale;
          const sy = (p.y + this.offsetY) * this.scale;
          if (sx < pMinX) pMinX = sx; if (sy < pMinY) pMinY = sy;
          if (sx > pMaxX) pMaxX = sx; if (sy > pMaxY) pMaxY = sy;
        }
        if (pMaxX >= cx - sr && pMinX <= cx + sr && pMaxY >= cy - sr && pMinY <= cy + sr) {
          nearWall = true;
          break;
        }
      }
      if (!nearWall) {
        this._drawRadialVisionHole(ctx, cx, cy, sr);
        continue;
      }

      const points = this._computeVisibilityPolygon(cx, cy, sr, walls);
      if (points.length < 3) continue;

      // Paint a soft radial gradient clipped to the visibility polygon.
      // With 360+ fallback rays the polygon edges that lie on the circle
      // arc are short enough (≈3 px chords) to be imperceptible.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.clip();

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr);
      grad.addColorStop(0,    'rgba(0,0,0,1)');
      grad.addColorStop(0.7,  'rgba(0,0,0,0.9)');
      grad.addColorStop(0.92, 'rgba(0,0,0,0.3)');
      grad.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, sr, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    // Paint every wall polygon as fully opaque so wall interiors are never
    // visible through carved vision areas.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    for (const wall of walls) {
      const pts = wall.points;
      const n = pts.length;
      if (n < 3) continue;

      // Wall polygon
      ctx.beginPath();
      ctx.moveTo((pts[0].x + this.offsetX) * this.scale, (pts[0].y + this.offsetY) * this.scale);
      for (let i = 1; i < n; i++) {
        ctx.lineTo((pts[i].x + this.offsetX) * this.scale, (pts[i].y + this.offsetY) * this.scale);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Restore default composite for future draws
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Draw an unobstructed radial vision hole with a soft falloff.
   */
  _drawRadialVisionHole(ctx, cx, cy, sr) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr);
    grad.addColorStop(0,    'rgba(0,0,0,1)');
    grad.addColorStop(0.7,  'rgba(0,0,0,0.9)');
    grad.addColorStop(0.92, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, sr, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /**
   * Compute a visibility polygon for a vision source at (cx, cy) with radius
   * sr, bounded by the supplied wall polygons. Casts rays toward every wall
   * vertex (with ±ε angular offsets to avoid slivers) plus a dense fallback
   * ring so chords on the circle are imperceptibly short.
   */
  _computeVisibilityPolygon(cx, cy, sr, walls) {
    const EPS_ANG = 0.0002;
    const FALLBACK_RAYS = 360;
    const TWO_PI = Math.PI * 2;
    const normalizeAngle = (a) => {
      const m = a % TWO_PI;
      return m < 0 ? m + TWO_PI : m;
    };
    const angles = new Set();

    for (const wall of walls) {
      const pts = wall.points;
      for (const p of pts) {
        const sx = (p.x + this.offsetX) * this.scale;
        const sy = (p.y + this.offsetY) * this.scale;
        const a = Math.atan2(sy - cy, sx - cx);
        angles.add(normalizeAngle(a - EPS_ANG));
        angles.add(normalizeAngle(a));
        angles.add(normalizeAngle(a + EPS_ANG));
      }
    }

    for (let i = 0; i < FALLBACK_RAYS; i++) {
      angles.add((Math.PI * 2 * i) / FALLBACK_RAYS);
    }

    const sorted = Array.from(angles).sort((a, b) => a - b);
    const points = [];

    for (const angle of sorted) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let minT = sr;

      for (const wall of walls) {
        const pts = wall.points;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const ax = (a.x + this.offsetX) * this.scale;
          const ay = (a.y + this.offsetY) * this.scale;
          const bx = (b.x + this.offsetX) * this.scale;
          const by = (b.y + this.offsetY) * this.scale;
          const t = this._raySegmentT(cx, cy, dx, dy, ax, ay, bx, by);
          if (t !== null && t < minT) minT = t;
        }
      }

      points.push({ x: cx + dx * minT, y: cy + dy * minT });
    }

    return points;
  }

  /**
   * Ray-segment intersection. Returns the parametric distance t along the
   * ray from the origin to the intersection point, or null if the segment
   * is not hit within the ray's range.
   */
  _raySegmentT(ox, oy, dx, dy, x1, y1, x2, y2) {
    const sdx = x2 - x1;
    const sdy = y2 - y1;
    const denom = dx * sdy - dy * sdx;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((x1 - ox) * sdy - (y1 - oy) * sdx) / denom;
    const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;

    if (t > 1e-6 && u >= 0 && u <= 1) return t;
    return null;
  }
}
