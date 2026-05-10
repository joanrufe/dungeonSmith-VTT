// public/js/tokenManager.js

export class TokenManager {
  constructor(sceneRenderer, socket, isDM = false) {
    this.sceneRenderer = sceneRenderer;
    this.socket = socket;
    this.isDM = isDM;
  }

  setupTokenInteractions(token) {
    if (token.isPaintTile) return;
    if (!this.isDM && token.hidden) return;

    const element = document.getElementById(`token-${token.tokenId}`);
    if (!element) return;

    if (this.isDM) {
      if (token.locked) {
        if (typeof interact !== 'undefined') interact(element).unset();
      } else {
        this._attachResize(element, token);
      }
      element.style.border = token.movableByPlayers ? '2px dashed blue' : '';
    }

    const canInteract = this.isDM || token.movableByPlayers;
    this.toggleHoverShadow(token, canInteract);
  }

  // ── Resize via interact.js (DM only) ──────────────────────
  _attachResize(element, token) {
    if (typeof interact === 'undefined') return;
    interact(element).unset();
    interact(element)
      .resizable({
        edges: { top: true, right: true, bottom: true, left: true },
        invert: 'none',
        margin: 6,
      })
      .on('resizestart', (event) => {
        token.initialAspectRatio = event.rect.width / event.rect.height;
      })
      .on('resizemove', (event) => {
        this.onResizeMove(event, token);
      });
  }

  onResizeMove(event, token) {
    const target   = event.target;
    const shiftKey = event.shiftKey;

    let dw = event.deltaRect.width  / this.sceneRenderer.scale;
    let dh = event.deltaRect.height / this.sceneRenderer.scale;

    if (!shiftKey) {
      const ar = token.initialAspectRatio;
      if (Math.abs(dw) > Math.abs(dh)) dh = dw / ar;
      else                              dw = dh * ar;
    }

    token.width  += dw;
    token.height += dh;
    token.x += event.deltaRect.left / this.sceneRenderer.scale;
    token.y += event.deltaRect.top  / this.sceneRenderer.scale;

    target.style.left   = `${(token.x + this.sceneRenderer.offsetX) * this.sceneRenderer.scale}px`;
    target.style.top    = `${(token.y + this.sceneRenderer.offsetY) * this.sceneRenderer.scale}px`;
    target.style.width  = `${token.width  * this.sceneRenderer.scale}px`;
    target.style.height = `${token.height * this.sceneRenderer.scale}px`;

    this.socket.emit('updateToken', {
      sceneId:    token.sceneId,
      tokenId:    token.tokenId,
      properties: { x: token.x, y: token.y, width: token.width, height: token.height },
    });
  }

  // ── Hover glow ─────────────────────────────────────────────
  toggleHoverShadow(token, enable) {
    const element = document.getElementById(`token-${token.tokenId}`);
    if (!element) return;

    element.addEventListener('mouseenter', () => {
      element.style.boxShadow = enable
        ? '0 0 15px 4px rgba(255, 255, 255, 0.4)'
        : 'none';
      if (enable) element.style.borderRadius = '5px';
    });

    element.addEventListener('mouseleave', () => {
      const sm = window.VTT_DM     ? window.VTT_DM.sceneManager
               : window.VTT_PLAYER ? window.VTT_PLAYER.sceneManager
               : null;
      if (sm && (sm.selectedTokenId === token.tokenId || (sm.selectedTokenIds && sm.selectedTokenIds.has(token.tokenId)))) {
        element.style.boxShadow = '0px 0px 0px 3px #00FFFF, 0px 0px 15px 5px rgba(0,255,255,0.6)';
      } else {
        element.style.boxShadow = 'none';
        element.style.borderRadius = '';
      }
    });
  }
}
