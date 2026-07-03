// public/js/sceneManager.js

/**
 * @typedef {Object} TokenDict
 * @property {string}  tokenId
 * @property {string}  sceneId
 * @property {string}  imageUrl
 * @property {string}  mediaType          - "image" | "video" | "pdf" | "text"
 * @property {number}  x
 * @property {number}  y
 * @property {number}  width
 * @property {number}  height
 * @property {number}  rotation
 * @property {number}  zIndex
 * @property {boolean} movableByPlayers
 * @property {boolean} hidden
 * @property {boolean} [visibleToPlayers]
 * @property {string}  [name]
 * @property {boolean} [locked]
 * @property {boolean} [isPaintTile]
 * @property {boolean} [isAreaEffect]
 * @property {string}  [areaShape]
 * @property {number|null}  [hpCurrent]
 * @property {number|null}  [hpMax]
 * @property {string|null}  [conditionText]
 * @property {string|null}  [conditionColor]
 * @property {number|null}  [conditionFontSize]
 * @property {boolean} [isMap]
 * @property {number}  [visionRadius]
 */

/**
 * @typedef {Object} WallPointDict
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} WallDict
 * @property {string} wallId
 * @property {WallPointDict[]} points
 */

/**
 * @typedef {Object} SceneDict
 * @property {string}      sceneId
 * @property {string}      sceneName
 * @property {TokenDict[]} tokens
 * @property {WallDict[]}  [walls]
 * @property {number}      [order]
 */

/**
 * @typedef {Object} StickyNoteDict
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {string} color   - "yellow" | "pink" | "blue" | "green"
 * @property {string} text
 */

export class SceneManager {
  constructor(socket, sceneRenderer, tokenManager, sceneContainer) {
    this.socket = socket;
    this.sceneRenderer = sceneRenderer;
    this.tokenManager = tokenManager;
    this.sceneContainer = sceneContainer;
    this.isDM = true;
    this.currentScene = null;
    this.selectedTokenId = null;
    this.selectedTokenIds = new Set();
    this.allScenes = [];
    this.pinnedSceneIds = this._loadPinnedScenes();
    this._dropdownSetup = false;

    this.init();
  }

  init() {
    this.setupSocketListeners();
    this.setupSceneContainerListeners();
    this.fetchSceneList();
    this.setupKeyListeners();
  }

  setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('sceneData', (scene) => this.onSceneData(scene));

    this.socket.on('addToken', ({ sceneId, token }) => {
      if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;
      // Skip if we already have this token (locally created via drag-drop upload)
      if (this.currentScene.tokens.find(t => t.tokenId === token.tokenId)) return;
      token.sceneId = sceneId;
      this.currentScene.tokens.push(token);
      this.sceneRenderer.tokens.push(token);
      this.sceneRenderer.renderToken(token);
      this.tokenManager.setupTokenInteractions(token);
      if (!token.isPaintTile) {
        const element = document.getElementById(`token-${token.tokenId}`);
        if (element) element.addEventListener('click', (e) => this.onTokenClick(e, token.tokenId));
      }
    });

    this.socket.on('updateToken', ({ sceneId, tokenId, properties }) => {
      this.onUpdateToken(sceneId, tokenId, properties);
    });

    this.socket.on('removeToken', ({ sceneId, tokenId }) => {
      this.onRemoveToken(sceneId, tokenId);
    });

    this.socket.on('sceneDeleted', ({ sceneId }) => {
      this.onSceneDeleted(sceneId);
    });

    this.socket.on('pingScene', (data) => {
      this.drawPing(data);
    });

    this.socket.on('addWall', ({ sceneId, wall }) => {
      if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;
      if (!this.currentScene.walls) this.currentScene.walls = [];
      this.currentScene.walls.push(wall);
      this.sceneRenderer.setWalls(this.currentScene.walls);
    });

    this.socket.on('updateWall', (payload) => {
      if (!this.currentScene || this.currentScene.sceneId !== payload.sceneId) return;
      const wall = (this.currentScene.walls || []).find(w => w.wallId === payload.wallId);
      if (!wall) return;
      wall.points = payload.points;
      this.sceneRenderer.setWalls(this.currentScene.walls);
    });

    this.socket.on('removeWall', ({ sceneId, wallId }) => {
      if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;
      this.currentScene.walls = (this.currentScene.walls || []).filter(w => w.wallId !== wallId);
      this.sceneRenderer.setWalls(this.currentScene.walls);
    });

    this.socket.on('clearWalls', ({ sceneId }) => {
      if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;
      this.currentScene.walls = [];
      this.sceneRenderer.setWalls([]);
    });

    this.socket.on('wallsData', ({ sceneId, walls }) => {
      if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;
      this.currentScene.walls = walls || [];
      this.sceneRenderer.setWalls(this.currentScene.walls);
    });

    this.socket.on('fogOpacity', ({ sceneId, fogOpacity }) => {
      if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;
      const v = Math.max(0, Math.min(1, Number(fogOpacity) || 0));
      this.currentScene.fogOpacity = v;
      // warFogTool owns the slider UI; it listens for fogOpacity too
      // and updates itself. Nothing else for the scene manager to do.
    });

    // Add other socket event handlers as needed
  }

  setupSceneContainerListeners() {
    this.sceneContainer.addEventListener('dragover', (event) => this.onDragOver(event));
    this.sceneContainer.addEventListener('dragleave', (event) => this.onDragLeave(event));
    this.sceneContainer.addEventListener('drop', (event) => this.onDrop(event));

    // Unselect token when clicking on the scene background
    this.sceneContainer.addEventListener('click', (event) => this.onSceneClick(event));

    // Double-click to ping
    this.sceneContainer.addEventListener('dblclick', (event) => this.onSceneDblClick(event));
  }

  setupKeyListeners() {
    // Handle Delete key press to remove selected token and other key events
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  fetchSceneList() {
    fetch('/scenes')
      .then((response) => response.json())
      .then((data) => {
        this.renderSceneButtons(data.scenes);
      })
      .catch((error) => {
        console.error('Error fetching scene list:', error);
      });
  }

  // ── Pin persistence ──────────────────────────────────────────
  _loadPinnedScenes() {
    try {
      const d = localStorage.getItem('vtt-pinned-scenes');
      return d ? JSON.parse(d) : [];
    } catch { return []; }
  }

  _savePinnedScenes() {
    try { localStorage.setItem('vtt-pinned-scenes', JSON.stringify(this.pinnedSceneIds)); } catch {}
  }

  pinScene(sceneId) {
    if (this.pinnedSceneIds.includes(sceneId) || this.pinnedSceneIds.length >= 5) return;
    this.pinnedSceneIds.push(sceneId);
    this._savePinnedScenes();
    this._renderPinnedButtons();
    this._renderDropdownMenu();
  }

  unpinScene(sceneId) {
    this.pinnedSceneIds = this.pinnedSceneIds.filter(id => id !== sceneId);
    this._savePinnedScenes();
    this._renderPinnedButtons();
    this._renderDropdownMenu();
  }

  // ── Scene UI rendering ────────────────────────────────────────
  /**
   * @param {SceneDict[]} scenes
   */
  renderSceneButtons(scenes) {
    this.allScenes = scenes;
    this._renderPinnedButtons();
    this._renderDropdownMenu();
    this._updateDropdownLabel();
    this._setupDropdownToggle();
  }

  _renderPinnedButtons() {
    const container = document.getElementById('pinned-scenes-container');
    if (!container) return;
    container.innerHTML = '';
    const pinnedScenes = this.pinnedSceneIds
      .map(id => this.allScenes.find(s => s.sceneId === id))
      .filter(Boolean);
    pinnedScenes.forEach(scene => {
      const btn = document.createElement('button');
      btn.className = 'scene-button' + (this.currentScene?.sceneId === scene.sceneId ? ' active' : '');
      btn.textContent = scene.sceneName;
      btn.dataset.sceneId = scene.sceneId;
      btn.title = scene.sceneName;
      btn.addEventListener('click', () => this.onSceneButtonClick(scene));
      container.appendChild(btn);
    });
  }

  _renderDropdownMenu() {
    const menu = document.getElementById('scene-dropdown-menu');
    if (!menu) return;
    menu.innerHTML = '';
    this.allScenes.forEach(scene => {
      const isPinned = this.pinnedSceneIds.includes(scene.sceneId);
      const isActive = this.currentScene?.sceneId === scene.sceneId;

      const item = document.createElement('div');
      item.className = 'scene-dd-item' + (isActive ? ' active' : '');
      item.dataset.sceneId = scene.sceneId;

      const namePart = document.createElement('span');
      namePart.className = 'scene-dd-name';
      namePart.textContent = scene.sceneName;
      namePart.addEventListener('click', () => {
        this.onSceneButtonClick(scene);
        this._closeDropdown();
      });

      const pinBtn = document.createElement('button');
      pinBtn.className = 'scene-dd-pin' + (isPinned ? ' pinned' : '');
      pinBtn.title = isPinned
        ? 'Unpin scene'
        : (this.pinnedSceneIds.length >= 5 ? 'Max 5 pins reached' : 'Pin scene');
      pinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isPinned) this.unpinScene(scene.sceneId);
        else this.pinScene(scene.sceneId);
      });

      item.appendChild(namePart);
      item.appendChild(pinBtn);
      menu.appendChild(item);
    });
  }

  _updateDropdownLabel() {
    const label = document.getElementById('scene-dropdown-label');
    if (label) label.textContent = this.currentScene ? this.currentScene.sceneName : 'Scenes';
  }

  _setupDropdownToggle() {
    if (this._dropdownSetup) return;
    this._dropdownSetup = true;
    const btn  = document.getElementById('scene-dropdown-btn');
    const menu = document.getElementById('scene-dropdown-menu');
    if (!btn || !menu) return;

    // Toggle on button click
    btn.addEventListener('click', () => {
      menu.classList.toggle('hidden');
    });

    // One permanent capture-phase listener — fires before any stopPropagation in child handlers.
    // If the click lands outside the wrap AND the menu is open, close it.
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('hidden')) return;
      const wrap = document.getElementById('scene-dropdown-wrap');
      if (wrap && !wrap.contains(e.target)) {
        menu.classList.add('hidden');
      }
    }, true);
  }

  _closeDropdown() {
    const menu = document.getElementById('scene-dropdown-menu');
    if (menu) menu.classList.add('hidden');
  }

  /**
   * @param {SceneDict} scene
   */
  onSceneButtonClick(scene) {
    const followPlayers = document.getElementById('follow-players-toggle')?.checked !== false;
    window.VTT_FOLLOW_PLAYERS = followPlayers;

    if (followPlayers) {
      this.socket.emit('changeScene', { sceneId: scene.sceneId });
    }

    this.loadScene(scene.sceneId);
    this._renderPinnedButtons();
    this._renderDropdownMenu();
  }

  loadScene(sceneId) {
    this.socket.emit('loadScene', { sceneId: sceneId });
  }

  /**
   * @param {SceneDict} scene
   */
  onSceneData(scene) {
    this.currentScene = scene;
    this.currentScene.walls = scene.walls || [];
    this.sceneRenderer.walls = this.currentScene.walls;
    scene.tokens.forEach(t => { t.sceneId = scene.sceneId; });
    this.clearSelection();
    this.renderScene(scene);
    this._renderPinnedButtons();
    this._renderDropdownMenu();
    this._updateDropdownLabel();
  }

  /**
   * @param {SceneDict} scene
   */
  renderScene(scene) {
    this.sceneRenderer.renderScene(scene);

    // After rendering tokens, setup interactions
    scene.tokens.forEach((token) => {
      this.tokenManager.setupTokenInteractions(token);
      if (token.isPaintTile) return;
      const element = document.getElementById(`token-${token.tokenId}`);
      if (element) {
        element.addEventListener('click', (event) => this.onTokenClick(event, token.tokenId));
      }
    });
  }

  onTokenClick(event, tokenId) {
    event.stopPropagation(); // Prevent click from bubbling up to sceneContainer

    // Click-through: if clicking an area effect interior, pass click to token below.
    // Clicking the outline ring keeps the area effect selected.
    const clickedToken = this.currentScene?.tokens.find(t => t.tokenId === tokenId);
    if (clickedToken?.isAreaEffect && !this._isClickOnEffectOutline(event, clickedToken)) {
      const allAtPoint = document.elementsFromPoint(event.clientX, event.clientY);
      for (const el of allAtPoint) {
        if (el.dataset.tokenId === tokenId) continue;
        if (!el.classList.contains('token') || el.classList.contains('paint-tile-el')) continue;
        const under = this.currentScene.tokens.find(t => t.tokenId === el.dataset.tokenId);
        if (!under || under.isAreaEffect) continue;
        tokenId = under.tokenId;
        break;
      }
    }

    if (event.shiftKey) {
      if (this.selectedTokenIds.has(tokenId)) {
        this.selectedTokenIds.delete(tokenId);
      } else {
        this.selectedTokenIds.add(tokenId);
      }
      this.selectedTokenId = this.selectedTokenIds.size ? Array.from(this.selectedTokenIds).at(-1) : null;
      this.refreshSelectionStyles();
      return;
    }

    this.selectedTokenIds.clear();
    this.selectedTokenIds.add(tokenId);
    this.selectedTokenId = tokenId;
    this.refreshSelectionStyles();
  }

  /**
   * @param {MouseEvent} event
   * @param {TokenDict}  token
   * @returns {boolean}
   */
  _isClickOnEffectOutline(event, token) {
    const rect = this.sceneContainer.getBoundingClientRect();
    const r    = this.sceneRenderer;

    // Click position relative to the scene container in screen px
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;

    // Token bounding box in screen px
    const left   = (token.x + r.offsetX) * r.scale;
    const top    = (token.y + r.offsetY) * r.scale;
    const w      = token.width  * r.scale;
    const h      = token.height * r.scale;
    const right  = left + w;
    const bottom = top  + h;

    // Stroke thickness in screen px (SVG uses ~2.5% of token size) plus click tolerance
    const strokePx = Math.max(6, Math.min(w, h) * 0.025) + 6;

    if (token.areaShape === 'circle') {
      // Distance from click to circle centre vs radius
      const dist = Math.hypot(cx - (left + w / 2), cy - (top + h / 2));
      return Math.abs(dist - w / 2) <= strokePx;
    }

    // Square, cone, line — border ring of the bounding box
    if (cx < left || cx > right || cy < top || cy > bottom) return false;
    return (
      cx <= left   + strokePx ||
      cx >= right  - strokePx ||
      cy <= top    + strokePx ||
      cy >= bottom - strokePx
    );
  }

  onSceneClick(event) {
    // If clicked directly on the sceneContainer (not on any token)
    if (event.target === this.sceneContainer) {
      this.clearSelection();
    }
  }

  onSceneDblClick(event) {
    if (window.VTT_ACTIVE_NOTES_TOOL) return;
    // Don't ping on sticky notes (they handle their own dblclick for editing)
    if (event.target.closest('.sticky-note')) return;
    // Don't ping on UI panels outside the scene
    if (!this.sceneContainer.contains(event.target) && event.target !== this.sceneContainer) return;

    const rect = this.sceneContainer.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const worldX = (mouseX / this.sceneRenderer.scale) - this.sceneRenderer.offsetX;
    const worldY = (mouseY / this.sceneRenderer.scale) - this.sceneRenderer.offsetY;

    // Default to blue for players, green for DM
    const color = (window.VTT_DM && !window.VTT_PLAYER) ? '#00FF00' : '#00AAFF';

    const data = { x: worldX, y: worldY, color };
    this.socket.emit('pingScene', data);
    this.drawPing(data); // Draw locally
  }

  drawPing(data) {
    const pingEl = document.createElement('div');
    pingEl.className = 'scene-ping';
    pingEl.style.position = 'absolute';
    // Calculate current screen bounds for this ping's absolute world position
    const px = (data.x + this.sceneRenderer.offsetX) * this.sceneRenderer.scale;
    const py = (data.y + this.sceneRenderer.offsetY) * this.sceneRenderer.scale;
    pingEl.style.left = `${px}px`;
    pingEl.style.top = `${py}px`;
    pingEl.style.transform = 'translate(-50%, -50%)';
    pingEl.style.borderColor = data.color;
    
    // Parse hex to rgba for background
    const isGreen = data.color === '#00FF00';
    pingEl.style.backgroundColor = isGreen ? 'rgba(0, 255, 0, 0.4)' : 'rgba(0, 170, 255, 0.4)';

    this.sceneContainer.appendChild(pingEl);

    setTimeout(() => {
      if (pingEl.parentNode) pingEl.remove();
    }, 1000);
  }

  onKeyDown(event) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (document.activeElement?.contentEditable === 'true') return;
    if (this.hasSelection() && event.key === ']') {
      this.forEachSelectedTokenId(tokenId => this.moveTokenZIndexUp(tokenId));
    } else if (this.hasSelection() && event.key === '[') {
      this.forEachSelectedTokenId(tokenId => this.moveTokenZIndexDown(tokenId));
    } else if (this.hasSelection() && event.key.toLowerCase() === 'h') {
      this.forEachSelectedTokenId(tokenId => this.toggleTokenHiddenState(tokenId));
    } else if (this.hasSelection() && event.key === 'Delete') {
      this.deleteSelectedToken();
    } else if (this.hasSelection() && event.ctrlKey && event.key.toLowerCase() === 'd') {
      // Duplicate the selected token
      event.preventDefault(); // Prevent default browser action
      this.duplicateSelectedToken();
    } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (this.currentScene) {
        this.socket.emit('undo', { sceneId: this.currentScene.sceneId });
      }
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (this.currentScene) {
        this.socket.emit('redo', { sceneId: this.currentScene.sceneId });
      }
    } else if (this.hasSelection() && event.key.toLowerCase() === 'i') {
      this.forEachSelectedTokenId(tokenId => this.toggleTokenMovableByPlayers(tokenId));
    } else if (this.hasSelection() && event.key.toLowerCase() === 'l') {
      this.forEachSelectedTokenId(tokenId => this.toggleTokenLocked(tokenId));
    } else if (this.hasSelection() && event.key.toLowerCase() === 'q') {
      this.rotateSelectedTokens(event.shiftKey ? -5 : -15);
    } else if (this.hasSelection() && event.key.toLowerCase() === 'e') {
      this.rotateSelectedTokens(event.shiftKey ? 5 : 15);
    } else if (event.key.toLowerCase() === 't') {
      this.toggleToolbar();
    } else if (event.shiftKey && event.key.toLowerCase() === 'd') {
      // Shift + D pressed: Prompt to delete the current scene
      if (this.currentScene) {
        const confirmDelete = confirm('Are you sure you want to delete the current scene? This action cannot be undone.');
        if (confirmDelete) {
          // Proceed to delete the scene
          this.deleteCurrentScene();
        }
      } else {
        alert('No scene is currently loaded.');
      }
    } else if (this.hasSelection() && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? 25 : 5;
      let dx = 0;
      let dy = 0;
      if (event.key === 'ArrowUp') dy = -step;
      else if (event.key === 'ArrowDown') dy = step;
      else if (event.key === 'ArrowLeft') dx = -step;
      else if (event.key === 'ArrowRight') dx = step;
      this.moveSelectedTokensBy(dx, dy);
    }
  }

  hasSelection() {
    return this.selectedTokenIds && this.selectedTokenIds.size > 0;
  }

  getSelectedTokenIds() {
    if (this.selectedTokenIds && this.selectedTokenIds.size) {
      return Array.from(this.selectedTokenIds);
    }
    return this.selectedTokenId ? [this.selectedTokenId] : [];
  }

  forEachSelectedTokenId(callback) {
    this.getSelectedTokenIds().forEach(callback);
  }

  /**
   * Move all selected tokens by the given delta. Locked tokens are skipped.
   * @param {number} dx
   * @param {number} dy
   */
  moveSelectedTokensBy(dx, dy) {
    if (!this.currentScene) return;
    let moved = false;
    this.getSelectedTokenIds().forEach((tokenId) => {
      const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
      if (!token || token.locked) return;
      token.x += dx;
      token.y += dy;
      this.sceneRenderer.updateTokenElement(token);
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: token.tokenId,
        properties: { x: token.x, y: token.y },
      });
      moved = true;
    });
    if (moved && !this.isDM) {
      this.sceneRenderer.drawFog();
    }
  }

  clearSelection() {
    this.selectedTokenIds.clear();
    this.selectedTokenId = null;
    this.refreshSelectionStyles();
  }

  refreshSelectionStyles() {
    document.querySelectorAll('.token').forEach(element => {
      const tokenId = element.dataset.tokenId;
      if (this.selectedTokenIds.has(tokenId)) {
        element.style.boxShadow = '0px 0px 0px 3px #00FFFF, 0px 0px 15px 5px rgba(0,255,255,0.6)';
        element.style.borderRadius = '5px';
      } else if (!element.classList.contains('paint-tile-el')) {
        element.style.boxShadow = 'none';
        element.style.borderRadius = '';
      }
    });
  }

  toggleTokenHiddenState(tokenId) {
    const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
    if (token) {
      token.hidden = !token.hidden;

      // Update the token's visual representation (handles both hidden and visibleToPlayers)
      this.sceneRenderer.updateTokenElement(token);

      // Send update to server
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: tokenId,
        properties: { hidden: token.hidden },
      });
    }
  }

  duplicateSelectedToken() {
    const selectedIds = this.getSelectedTokenIds();
    if (selectedIds.length) {
      const newSelection = [];
      selectedIds.forEach((tokenId) => {
        const originalToken = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
        if (!originalToken) return;
      // Clone the original token
      const newToken = JSON.parse(JSON.stringify(originalToken));
  
      // Generate a new unique tokenId
      newToken.tokenId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
  
      // Offset the new token's position slightly
      const offset = 20; // Adjust as needed
      newToken.x = originalToken.x + offset;
      newToken.y = originalToken.y + offset;
      newToken.zIndex = originalToken.zIndex + 1;
  
      // Add the new token to the current scene's tokens array
      this.currentScene.tokens.push(newToken);
  
      // Notify the server about the new token
      this.socket.emit('addToken', { sceneId: this.currentScene.sceneId, token: newToken });
  
      // Render the new token
      this.sceneRenderer.renderToken(newToken);
  
      // Setup interactions for the new token
      this.tokenManager.setupTokenInteractions(newToken);
  
      // Add event listener for token selection
      const element = document.getElementById(`token-${newToken.tokenId}`);
      if (element) {
        element.addEventListener('click', (event) => this.onTokenClick(event, newToken.tokenId));
      }
        newSelection.push(newToken.tokenId);
      });

      this.selectedTokenIds = new Set(newSelection);
      this.selectedTokenId = newSelection.at(-1) || null;
      this.refreshSelectionStyles();
    } else {
      alert('No token is currently selected.');
    }
  }

  moveTokenZIndexUp(tokenId) {
    const tokens = this.currentScene.tokens;
    tokens.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    const index = tokens.findIndex(t => t.tokenId === tokenId);
  
    if (index < tokens.length - 1) {
      const token = tokens[index];
      const nextToken = tokens[index + 1];
  
      // Swap zIndex values
      const tempZIndex = token.zIndex;
      token.zIndex = nextToken.zIndex;
      nextToken.zIndex = tempZIndex;
  
      // Mark scene as dirty
      this.currentScene.dirty = true;
  
      // Emit updateToken events for both tokens
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: token.tokenId,
        properties: { zIndex: token.zIndex },
      });
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: nextToken.tokenId,
        properties: { zIndex: nextToken.zIndex },
      });
  
      // Update the DOM elements
      this.sceneRenderer.updateTokenElement(token);
      this.sceneRenderer.updateTokenElement(nextToken);
    }
  }

  moveTokenZIndexDown(tokenId) {
    const tokens = this.currentScene.tokens;
    tokens.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    const index = tokens.findIndex(t => t.tokenId === tokenId);
  
    if (index > 0) {
      const token = tokens[index];
      const prevToken = tokens[index - 1];
  
      // Swap zIndex values
      const tempZIndex = token.zIndex;
      token.zIndex = prevToken.zIndex;
      prevToken.zIndex = tempZIndex;
  
      // Mark scene as dirty
      this.currentScene.dirty = true;
  
      // Emit updateToken events for both tokens
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: token.tokenId,
        properties: { zIndex: token.zIndex },
      });
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: prevToken.tokenId,
        properties: { zIndex: prevToken.zIndex },
      });
  
      // Update the DOM elements
      this.sceneRenderer.updateTokenElement(token);
      this.sceneRenderer.updateTokenElement(prevToken);
    }
  }

  toggleToolbar() {
    const toolbar = document.getElementById('toolbar');
    if (toolbar.style.top === '0px' || toolbar.style.top === '') {
      toolbar.style.top = '-50px'; // Adjust this value based on the toolbar height
    } else {
      toolbar.style.top = '0px';
    }
  }

  deleteSelectedToken() {
    const selectedIds = this.getSelectedTokenIds();
    if (!selectedIds.length) return;

    selectedIds.forEach((tokenId) => {
    const tokenIndex = this.currentScene.tokens.findIndex((t) => t.tokenId === tokenId);
    if (tokenIndex !== -1) {
      // Remove from currentScene.tokens
      this.currentScene.tokens.splice(tokenIndex, 1);
      // Remove from DOM
      const element = document.getElementById(`token-${tokenId}`);
      if (element) {
        this.sceneContainer.removeChild(element);
      }
      const hpBar = document.getElementById(`hpbar-${tokenId}`);
      if (hpBar) hpBar.remove();
      const condLabel = document.getElementById(`cond-${tokenId}`);
      if (condLabel) condLabel.remove();
      // Notify server
      this.socket.emit('removeToken', {
        sceneId: this.currentScene.sceneId,
        tokenId,
      });
    }
    });

    this.clearSelection();
  }

  toggleTokenLocked(tokenId) {
    const token = this.currentScene.tokens.find(t => t.tokenId === tokenId);
    if (!token || token.isPaintTile) return;
    token.locked = !token.locked;
    this.sceneRenderer.updateTokenElement(token);
    this.tokenManager.setupTokenInteractions(token);
    this.socket.emit('updateToken', {
      sceneId: this.currentScene.sceneId,
      tokenId,
      properties: { locked: token.locked },
    });
  }

  toggleTokenMovableByPlayers(tokenId) {
    const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
    if (token) {
      token.movableByPlayers = !token.movableByPlayers;

      // Update the token's visual representation
      const element = document.getElementById(`token-${tokenId}`);
      if (element) {
        if (token.movableByPlayers) {
          element.style.border = '2px dashed blue';
        } else {
          element.style.border = '';
        }
      }

      // Send update to server
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: tokenId,
        properties: { movableByPlayers: token.movableByPlayers },
      });
    }
  }

  rotateSelectedTokens(delta) {
    this.forEachSelectedTokenId((tokenId) => {
      const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
      if (!token) return;
      token.rotation = (token.rotation || 0) + delta;
      this.sceneRenderer.updateTokenElement(token);
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId,
        properties: { rotation: token.rotation },
      });
    });
  }

  deleteCurrentScene() {
    fetch('/deleteScene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: this.currentScene.sceneId }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          alert('Scene deleted successfully.');
          // Clear the current scene and tokens
          this.currentScene = null;
          this._showNoSceneMsg();
          // Update the scene list
          this.fetchSceneList();
        } else {
          alert('Failed to delete the scene.');
        }
      })
      .catch((error) => {
        console.error('Error deleting scene:', error);
        alert('An error occurred while deleting the scene.');
      });
  }

  /**
   * @param {string} sceneId
   * @param {string} tokenId
   * @param {Partial<TokenDict>} properties
   */
  onUpdateToken(sceneId, tokenId, properties) {
    if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;

    const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
    if (token) {
      // Update token properties
      Object.assign(token, properties);

      // Update the DOM element
      this.sceneRenderer.updateTokenElement(token);

      // Fog depends on token position and vision radius, so redraw it on every update
      if (!this.isDM) {
        this.sceneRenderer.drawFog();
      }

      // Only re-setup interactions when interaction-relevant props change
      if ('movableByPlayers' in properties || 'hidden' in properties || 'visibleToPlayers' in properties || 'locked' in properties) {
        this.tokenManager.setupTokenInteractions(token);
      }
    }
  }

  onRemoveToken(sceneId, tokenId) {
    if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;

    const tokenIndex = this.currentScene.tokens.findIndex((t) => t.tokenId === tokenId);
    if (tokenIndex !== -1) {
      // Remove from currentScene.tokens
      this.currentScene.tokens.splice(tokenIndex, 1);
      // Remove from DOM
      const element = document.getElementById(`token-${tokenId}`);
      if (element && element.parentNode === this.sceneContainer) {
        this.sceneContainer.removeChild(element);
      }
      const hpBar = document.getElementById(`hpbar-${tokenId}`);
      if (hpBar) hpBar.remove();
      const condLabel = document.getElementById(`cond-${tokenId}`);
      if (condLabel) condLabel.remove();
      // If the removed token was selected, unselect it
      if (this.selectedTokenId === tokenId) {
        this.selectedTokenIds.delete(tokenId);
        this.selectedTokenId = this.selectedTokenIds.size ? Array.from(this.selectedTokenIds).at(-1) : null;
        this.refreshSelectionStyles();
      }
    }
  }

  onSceneDeleted(sceneId) {
    if (this.currentScene && this.currentScene.sceneId === sceneId) {
      this.currentScene = null;
      this._showNoSceneMsg();
    }
    this.unpinScene(sceneId);
    this.fetchSceneList();
  }

  _showNoSceneMsg() {
    this.sceneContainer.innerHTML = '';
    const msg = document.createElement('div');
    msg.id = 'no-scene-msg';
    msg.className = 'no-scene-msg';
    msg.innerHTML = `<img src="./DungeonSmith.png" class="no-scene-logo" alt="DungeonSmith VTT"><div class="no-scene-label">Pick a Scene</div>`;
    this.sceneContainer.appendChild(msg);
  }

  onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    // Add visual feedback
    this.sceneContainer.classList.add('dragover');
  }

  onDragLeave(event) {
    this.sceneContainer.classList.remove('dragover');
  }

  onDrop(event) {
    event.preventDefault();
    this.sceneContainer.classList.remove('dragover');
  
    if (!this.currentScene) {
      alert('Please load or create a scene first.');
      return;
    }
  
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      this.processDroppedFiles(files, event);
    }
  }
  
  async processDroppedFiles(files, event) {
    for (const file of files) {
      await this.processFile(file, event);
    }
  }
  
  async processFile(file, event) {
    // Extract the file name without the extension
    const fileName = file.name.split('.').slice(0, -1).join('.');
  
    const formData = new FormData();
    formData.append('file', file);
  
    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
  
      const imageUrl = data.imageUrl;
      const mediaType = data.mediaType;
  
      // Get the drop position relative to the scene container
      const rect = this.sceneContainer.getBoundingClientRect();
      const x = (event.clientX - rect.left) / this.sceneRenderer.scale - this.sceneRenderer.offsetX;
      const y = (event.clientY - rect.top) / this.sceneRenderer.scale - this.sceneRenderer.offsetY;
  
      let width, height;
  
      // Function to create the token after media dimensions are available
      /**
       * Constructs the token object literal, adds it to the scene, emits to server, renders, and sets up interactions.
       * @type {() => void}
       */
      const createToken = () => {
        // Create a new token
        const token = {
          tokenId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
          sceneId: this.currentScene.sceneId,
          imageUrl: imageUrl,
          mediaType: mediaType,
          x: x,
          y: y,
          width: width,
          height: height,
          rotation: 0,
          zIndex: this.getMaxZIndex() + 1,
          movableByPlayers: false,
          visibleToPlayers: true,
          name: fileName,
        };
  
        // Add token to the scene
        this.currentScene.tokens.push(token);
        // Save the scene on the server
        this.socket.emit('addToken', { sceneId: this.currentScene.sceneId, token: token });
        // Render the token
        this.sceneRenderer.renderToken(token);
        // Setup interactions
        this.tokenManager.setupTokenInteractions(token);
  
        // Add click event listener for token selection
        const element = document.getElementById(`token-${token.tokenId}`);
        if (element) {
          element.addEventListener('click', (event) => this.onTokenClick(event, token.tokenId));
        }
      };
  
      // Load the image or video to get its dimensions
      if (mediaType === 'video') {
        const video = document.createElement('video');
        video.src = imageUrl;
  
        // Wrap the event listener in a Promise to use await
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => {
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
  
            const maxDimension = 200; // Adjust as needed
            width = videoWidth;
            height = videoHeight;
  
            // Scale dimensions if necessary
            if (width > height) {
              if (width > maxDimension) {
                const scale = maxDimension / width;
                width = maxDimension;
                height = height * scale;
              }
            } else {
              if (height > maxDimension) {
                const scale = maxDimension / height;
                height = maxDimension;
                width = width * scale;
              }
            }
  
            createToken();
            resolve();
          });
  
          video.addEventListener('error', (error) => {
            console.error('Error loading video:', error);
            reject(error);
          });
        });
      } else {
        // Handle images
        const image = new Image();
  
        // Wrap the event listener in a Promise to use await
        await new Promise((resolve, reject) => {
          image.onload = () => {
            const imageWidth = image.naturalWidth;
            const imageHeight = image.naturalHeight;
  
            const maxDimension = 200; // Adjust as needed
            width = imageWidth;
            height = imageHeight;
  
            // Scale dimensions if necessary
            if (width > height) {
              if (width > maxDimension) {
                const scale = maxDimension / width;
                width = maxDimension;
                height = height * scale;
              }
            } else {
              if (height > maxDimension) {
                const scale = maxDimension / height;
                height = maxDimension;
                width = width * scale;
              }
            }
  
            createToken();
            resolve();
          };
  
          image.onerror = (error) => {
            console.error('Error loading image:', error);
            reject(error);
          };
  
          image.src = imageUrl;
        });
      }
    } catch (error) {
      console.error('Error uploading token file:', error);
    }
  }

  createScene(sceneName) {
    fetch('/createScene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneName }),
    })
      .then((response) => response.json())
      .then((data) => {
        const sceneId = data.sceneId;
        // Fetch the updated scene list to include the new scene
        this.fetchSceneList();
        // Load the new scene
        this.loadScene(sceneId);
      })
      .catch((error) => {
        console.error('Error creating scene:', error);
      });
  }

  duplicateScene(sceneId, sceneName) {
    fetch('/duplicateScene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId, sceneName }),
    })
      .then((response) => response.json())
      .then((data) => {
        this.fetchSceneList();
        this.loadScene(data.sceneId);
      })
      .catch((error) => {
        console.error('Error duplicating scene:', error);
      });
  }

  /**
   * @returns {number}
   */
  getMaxZIndex() {
    if (!this.currentScene || !this.currentScene.tokens || this.currentScene.tokens.length === 0) {
      return 0;
    }
    return Math.max(...this.currentScene.tokens.map(token => token.zIndex || 0));
  }
}
