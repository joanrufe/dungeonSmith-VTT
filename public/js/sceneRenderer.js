// public/js/sceneRenderer.js

/** @typedef {import('./sceneManager.js').TokenDict} TokenDict */
/** @typedef {import('./sceneManager.js').SceneDict} SceneDict */

export class SceneRenderer {
  constructor(container, isDM = false) {
    this.container = container;
    this.isDM = isDM;
    this.tokens = [];
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
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
}