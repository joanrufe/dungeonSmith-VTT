// public/js/rotationOverlay.js
// DM-only visual center-of-rotation indicator and drag-rotation handle.

/** @typedef {import('./sceneManager.js').TokenDict} TokenDict */

export class RotationOverlay {
  /**
   * @param {HTMLElement} sceneContainer
   * @param {import('./sceneRenderer.js').SceneRenderer} sceneRenderer
   * @param {import('./sceneManager.js').SceneManager | null} sceneManager
   */
  constructor(sceneContainer, sceneRenderer, sceneManager = null) {
    this.sceneContainer = sceneContainer;
    this.sceneRenderer = sceneRenderer;
    this.sceneManager = sceneManager;
    this.socket = null;

    this.HANDLE_OFFSET = 24; // screen px beyond the rotated top edge
    this.MOVE_THRESHOLD = 3; // px; smaller movements are treated as a click

    /**
     * Active drag state. When non-null the handle for this token is being dragged.
     * @type {{
     *   tokenId: string,
     *   token: TokenDict,
     *   startAngle: number,
     *   startRotation: number,
     *   startClientX: number,
     *   startClientY: number,
     *   pointerId: number,
     *   handleEl: HTMLElement,
     *   moveListeners: { move: (e: PointerEvent) => void, up: (e: PointerEvent) => void },
     *   moved: boolean,
     *   maxMovePx: number,
     * } | null}
     */
    this._drag = null;
  }

  /**
   * Synchronise overlay elements with the current selection.
   * @param {Iterable<string>} selectedIds
   */
  sync(selectedIds) {
    const ids = Array.from(selectedIds || []);
    const activeDragId = this._drag?.tokenId;

    // Remove overlays for tokens that are no longer selected (except the one
    // currently being dragged, whose element must stay alive to keep pointer capture).
    this._eachOverlayId((overlayId) => {
      if (!ids.includes(overlayId) && overlayId !== activeDragId) {
        this._removeOverlay(overlayId);
      }
    });

    ids.forEach((tokenId) => {
      if (tokenId === activeDragId) return; // dragged token updates itself
      const token = this._getToken(tokenId);
      if (!token) return;
      const showHandle = this._shouldShowHandle(ids, token);
      this._ensureOverlay(token, showHandle);
    });
  }

  /** Remove every overlay element and cancel any active drag. */
  clear() {
    this._cancelDrag();
    this._eachOverlayId((overlayId) => this._removeOverlay(overlayId));
  }

  /**
   * @param {string} tokenId
   * @returns {TokenDict | undefined}
   */
  _getToken(tokenId) {
    return this.sceneManager.currentScene?.tokens.find((t) => t.tokenId === tokenId);
  }

  /**
   * @param {string[]} ids
   * @param {TokenDict} token
   * @returns {boolean}
   */
  _shouldShowHandle(ids, token) {
    return ids.length === 1 && !token.locked && !!this.sceneManager?.isDM;
  }

  /** @returns {import('./sceneRenderer.js').SceneRenderer} */
  _r() {
    return this.sceneRenderer;
  }

  /**
   * Compute screen-space positions for the marker, line, and handle.
   * @param {TokenDict} token
   */
  _computePositions(token) {
    const r = this._r();
    const cx = (token.x + token.width / 2 + r.offsetX) * r.scale;
    const cy = (token.y + token.height / 2 + r.offsetY) * r.scale;
    const rotation = token.rotation || 0;
    const rad = (rotation * Math.PI) / 180;

    // Unit vector pointing to the token's rotated top edge.
    const dirX = Math.sin(rad);
    const dirY = -Math.cos(rad);

    const halfH = (token.height / 2) * r.scale;
    const topX = cx + dirX * halfH;
    const topY = cy + dirY * halfH;
    const handleX = topX + dirX * this.HANDLE_OFFSET;
    const handleY = topY + dirY * this.HANDLE_OFFSET;

    return { cx, cy, rotation, topX, topY, handleX, handleY };
  }

  /**
   * Ensure the DOM elements for a token's overlay exist and are positioned.
   * @param {TokenDict} token
   * @param {boolean} showHandle
   */
  _ensureOverlay(token, showHandle) {
    const positions = this._computePositions(token);
    const z = (token.zIndex || 0) + 300;

    this._ensureMarker(token, positions, z);
    if (showHandle) {
      this._ensureLine(token, positions, z);
      this._ensureHandle(token, positions, z);
    } else {
      this._removeLine(token.tokenId);
      this._removeHandle(token.tokenId);
    }
  }

  /**
   * Update only the positions of existing overlay elements for a token.
   * Used during drag so the captured handle element is not recreated.
   * @param {TokenDict} token
   */
  _updateOverlayPositions(token) {
    const positions = this._computePositions(token);
    const z = (token.zIndex || 0) + 300;

    const marker = document.getElementById(`rot-center-${token.tokenId}`);
    if (marker) this._positionMarker(marker, positions, z);

    const line = document.getElementById(`rot-line-${token.tokenId}`);
    if (line) this._positionLine(line, positions, z);

    const handle = document.getElementById(`rot-handle-${token.tokenId}`);
    if (handle) this._positionHandle(handle, positions, z);
  }

  /**
   * @param {TokenDict} token
   * @param {object} positions
   * @param {number} z
   */
  _ensureMarker(token, positions, z) {
    let marker = document.getElementById(`rot-center-${token.tokenId}`);
    if (!marker) {
      marker = document.createElement('div');
      marker.id = `rot-center-${token.tokenId}`;
      marker.className = 'token-rotation-center';
      marker.dataset.tokenId = token.tokenId;
      this.sceneContainer.appendChild(marker);
    }
    this._positionMarker(marker, positions, z);
  }

  /**
   * @param {HTMLElement} marker
   * @param {object} positions
   * @param {number} z
   */
  _positionMarker(marker, positions, z) {
    marker.style.left = `${positions.cx}px`;
    marker.style.top = `${positions.cy}px`;
    marker.style.zIndex = `${z}`;
  }

  /**
   * @param {TokenDict} token
   * @param {object} positions
   * @param {number} z
   */
  _ensureLine(token, positions, z) {
    let line = document.getElementById(`rot-line-${token.tokenId}`);
    if (!line) {
      line = document.createElement('div');
      line.id = `rot-line-${token.tokenId}`;
      line.className = 'token-rotation-line';
      line.dataset.tokenId = token.tokenId;
      this.sceneContainer.appendChild(line);
    }
    this._positionLine(line, positions, z);
  }

  /**
   * @param {HTMLElement} line
   * @param {object} positions
   * @param {number} z
   */
  _positionLine(line, positions, z) {
    line.style.left = `${positions.topX}px`;
    line.style.top = `${positions.topY}px`;
    line.style.width = `${this.HANDLE_OFFSET}px`;
    line.style.zIndex = `${z}`;
    line.style.transform = `rotate(${positions.rotation - 90}deg)`;
  }

  /**
   * @param {TokenDict} token
   * @param {object} positions
   * @param {number} z
   */
  _ensureHandle(token, positions, z) {
    let handle = document.getElementById(`rot-handle-${token.tokenId}`);
    if (!handle) {
      handle = document.createElement('div');
      handle.id = `rot-handle-${token.tokenId}`;
      handle.className = 'token-rotation-handle';
      handle.dataset.tokenId = token.tokenId;
      handle.addEventListener('pointerdown', (e) => this._onHandlePointerDown(e));
      this.sceneContainer.appendChild(handle);
    }
    this._positionHandle(handle, positions, z);
  }

  /**
   * @param {HTMLElement} handle
   * @param {object} positions
   * @param {number} z
   */
  _positionHandle(handle, positions, z) {
    handle.style.left = `${positions.handleX}px`;
    handle.style.top = `${positions.handleY}px`;
    handle.style.zIndex = `${z}`;
  }

  /**
   * @param {PointerEvent} event
   */
  _onHandlePointerDown(event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();

    const tokenId = event.target.dataset.tokenId;
    if (!tokenId) return;

    const token = this._getToken(tokenId);
    if (!token) return;

    // Preserve multi-select semantics when the user clicks the handle with a modifier.
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.sceneManager.toggleSelectedTokenId(tokenId);
      return;
    }

    const handleEl = /** @type {HTMLElement} */ (event.target);
    handleEl.setPointerCapture(event.pointerId);

    const rect = this.sceneContainer.getBoundingClientRect();
    const cx = (token.x + token.width / 2 + this._r().offsetX) * this._r().scale + rect.left;
    const cy = (token.y + token.height / 2 + this._r().offsetY) * this._r().scale + rect.top;

    const moveListener = (e) => this._onHandleMove(e);
    const upListener = (e) => this._onHandleUp(e);

    this._drag = {
      tokenId,
      token,
      startAngle: Math.atan2(event.clientY - cy, event.clientX - cx),
      startRotation: token.rotation || 0,
      startClientX: event.clientX,
      startClientY: event.clientY,
      pointerId: event.pointerId,
      handleEl,
      moveListeners: { move: moveListener, up: upListener },
      moved: false,
      maxMovePx: 0,
    };

    handleEl.addEventListener('pointermove', moveListener);
    handleEl.addEventListener('pointerup', upListener);
    handleEl.addEventListener('pointercancel', upListener);
  }

  /**
   * @param {PointerEvent} event
   */
  _onHandleMove(event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    event.preventDefault();

    const drag = this._drag;
    const token = drag.token;
    const rect = this.sceneContainer.getBoundingClientRect();
    const cx = (token.x + token.width / 2 + this._r().offsetX) * this._r().scale + rect.left;
    const cy = (token.y + token.height / 2 + this._r().offsetY) * this._r().scale + rect.top;

    const distFromStart = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
    drag.maxMovePx = Math.max(drag.maxMovePx, distFromStart);
    if (drag.maxMovePx > this.MOVE_THRESHOLD) drag.moved = true;

    const angle = Math.atan2(event.clientY - cy, event.clientX - cx);
    let delta = angle - drag.startAngle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;

    let rotation = drag.startRotation + (delta * 180) / Math.PI;
    if (event.shiftKey) {
      rotation = Math.round(rotation);
    }

    token.rotation = rotation;
    this.sceneRenderer.updateTokenElement(token);
    this._updateOverlayPositions(token);
  }

  /**
   * @param {PointerEvent} event
   */
  _onHandleUp(event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const drag = this._drag;

    drag.handleEl.releasePointerCapture(event.pointerId);
    drag.handleEl.removeEventListener('pointermove', drag.moveListeners.move);
    drag.handleEl.removeEventListener('pointerup', drag.moveListeners.up);
    drag.handleEl.removeEventListener('pointercancel', drag.moveListeners.up);

    if (!drag.moved) {
      // Treat as a selection click.
      this.sceneManager.selectSingleTokenId(drag.tokenId);
    } else {
      let rotation = drag.token.rotation;
      if (event.shiftKey) {
        rotation = Math.round(rotation);
      } else {
        rotation = Math.round(rotation / 15) * 15;
      }
      drag.token.rotation = rotation;
      this.sceneRenderer.updateTokenElement(drag.token);

      this.socket.emit('updateToken', {
        sceneId: drag.token.sceneId,
        tokenId: drag.tokenId,
        properties: { rotation: drag.token.rotation },
      });
    }

    this._drag = null;
    this.sync(this.sceneManager.selectedTokenIds);
  }

  _cancelDrag() {
    if (!this._drag) return;
    const drag = this._drag;
    try {
      drag.handleEl.releasePointerCapture(drag.pointerId);
    } catch {
      // Capture may already be released.
    }
    drag.handleEl.removeEventListener('pointermove', drag.moveListeners.move);
    drag.handleEl.removeEventListener('pointerup', drag.moveListeners.up);
    drag.handleEl.removeEventListener('pointercancel', drag.moveListeners.up);
    this._drag = null;
  }

  /**
   * @param {(tokenId: string) => void} callback
   */
  _eachOverlayId(callback) {
    const existing = this.sceneContainer.querySelectorAll('.token-rotation-center, .token-rotation-line, .token-rotation-handle');
    /** @type {Set<string>} */
    const seen = new Set();
    existing.forEach((el) => {
      const id = el.dataset.tokenId;
      if (id && !seen.has(id)) {
        seen.add(id);
        callback(id);
      }
    });
  }

  /**
   * @param {string} tokenId
   */
  _removeOverlay(tokenId) {
    this._removeMarker(tokenId);
    this._removeLine(tokenId);
    this._removeHandle(tokenId);
  }

  /**
   * @param {string} tokenId
   */
  _removeMarker(tokenId) {
    const el = document.getElementById(`rot-center-${tokenId}`);
    if (el) el.remove();
  }

  /**
   * @param {string} tokenId
   */
  _removeLine(tokenId) {
    const el = document.getElementById(`rot-line-${tokenId}`);
    if (el) el.remove();
  }

  /**
   * @param {string} tokenId
   */
  _removeHandle(tokenId) {
    const el = document.getElementById(`rot-handle-${tokenId}`);
    if (el) el.remove();
  }
}
