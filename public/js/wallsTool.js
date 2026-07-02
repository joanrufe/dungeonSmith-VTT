// public/js/wallsTool.js
// DM wall drawing/editing tool.

(function () {
  'use strict';

  const GRID_SIZE = () => window.VTT_GRID_SIZE || 60;

  function snap(value) {
    const size = GRID_SIZE();
    return Math.round(value / size) * size;
  }

  class WallsTool {
    constructor() {
      this.panel = null;
      this.btn = null;
      this.sceneContainer = null;

      this.mode = 'none'; // 'draw' | 'erase' | 'none'
      this.snapToGrid = false;

      this.selectedWallId = null;
      this.selectedEndpoint = null; // 'start' | 'end'
      this.dragging = false;
      this.dragStartWorld = null;
      this.dragCurrentWorld = null;

      this.previewLine = null;
      this.handleStart = null;
      this.handleEnd = null;

      this.observer = null;
      this.boundKeydown = this.onKeyDown.bind(this);

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        this.init();
      }
    }

    init() {
      this.panel = document.getElementById('walls-panel');
      this.btn = document.getElementById('walls-toggle-btn');
      this.sceneContainer = document.getElementById('scene-container');
      if (!this.panel || !this.sceneContainer) return;

      this.bindPanel();
      this.bindMouse();
      document.addEventListener('keydown', this.boundKeydown, true);
      this.observePanelVisibility();
    }

    // ── UI bindings ─────────────────────────────────────────
    bindPanel() {
      const drawBtn = document.getElementById('walls-draw-btn');
      const eraseBtn = document.getElementById('walls-erase-btn');
      const clearBtn = document.getElementById('walls-clear-btn');
      const snapToggle = document.getElementById('walls-snap-toggle');

      drawBtn?.addEventListener('click', () => this.setMode(this.mode === 'draw' ? 'none' : 'draw'));
      eraseBtn?.addEventListener('click', () => this.setMode(this.mode === 'erase' ? 'none' : 'erase'));
      snapToggle?.addEventListener('change', (e) => { this.snapToGrid = e.target.checked; });

      clearBtn?.addEventListener('click', () => {
        const scene = this.currentScene();
        if (!scene) return;
        if (!confirm('Clear all walls from this scene?')) return;
        this.socket().emit('clearWalls', { sceneId: scene.sceneId });
      });
    }

    observePanelVisibility() {
      if (!this.panel || !window.MutationObserver) return;
      this.observer = new MutationObserver(() => {
        if (this.panel.classList.contains('panel-hidden')) {
          this.setMode('none');
          this.clearSelection();
        }
      });
      this.observer.observe(this.panel, { attributes: true, attributeFilter: ['class'] });
    }

    // ── Helpers ─────────────────────────────────────────────
    socket() {
      return window.VTT_DM?.socket;
    }

    sceneManager() {
      return window.VTT_DM?.sceneManager;
    }

    currentScene() {
      return this.sceneManager()?.currentScene;
    }

    renderer() {
      return this.sceneManager()?.sceneRenderer;
    }

    screenToWorld(sx, sy) {
      const r = this.renderer();
      const scale = r?.scale || 1;
      const offsetX = r?.offsetX || 0;
      const offsetY = r?.offsetY || 0;
      return {
        x: (sx / scale) - offsetX,
        y: (sy / scale) - offsetY,
      };
    }

    isActive() {
      return this.panel && !this.panel.classList.contains('panel-hidden');
    }

    // ── Mode handling ───────────────────────────────────────
    setMode(mode) {
      this.mode = mode;
      this.clearSelection();
      this.removePreview();

      const drawBtn = document.getElementById('walls-draw-btn');
      const eraseBtn = document.getElementById('walls-erase-btn');
      drawBtn?.classList.toggle('active-tool-btn', mode === 'draw');
      eraseBtn?.classList.toggle('active-tool-btn', mode === 'erase');
    }

    // ── Mouse interaction ───────────────────────────────────
    bindMouse() {
      this.sceneContainer.addEventListener('mousedown', (e) => this.onMouseDown(e));
      window.addEventListener('mousemove', (e) => this.onMouseMove(e));
      window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    }

    onMouseDown(e) {
      if (!this.isActive()) return;
      if (e.button !== 0) return;

      const scene = this.currentScene();
      if (!scene) return;

      // Only operate when the click started inside the scene container
      const rect = this.sceneContainer.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.mode === 'draw') {
        const world = this.screenToWorld(sx, sy);
        this.dragStartWorld = {
          x: this.snapToGrid ? snap(world.x) : world.x,
          y: this.snapToGrid ? snap(world.y) : world.y,
        };
        this.dragging = true;
        this.updatePreview(sx, sy);
        e.preventDefault();
        return;
      }

      if (this.mode === 'erase') {
        const wall = this.pickWallNear(sx, sy);
        if (wall) {
          this.socket().emit('removeWall', { sceneId: scene.sceneId, wallId: wall.wallId });
        }
        e.preventDefault();
        return;
      }

      // Default: select endpoint or wall
      const endpoint = this.pickEndpointNear(sx, sy);
      if (endpoint) {
        this.selectedWallId = endpoint.wall.wallId;
        this.selectedEndpoint = endpoint.which;
        this.dragging = true;
        this.updateSelectionOverlay();
        e.preventDefault();
        return;
      }

      const wall = this.pickWallNear(sx, sy);
      if (wall) {
        this.selectedWallId = wall.wallId;
        this.selectedEndpoint = null;
        this.updateSelectionOverlay();
        e.preventDefault();
      }
    }

    onMouseMove(e) {
      if (!this.isActive()) return;
      if (!this.dragging) return;

      const rect = this.sceneContainer.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.mode === 'draw') {
        this.updatePreview(sx, sy);
        return;
      }

      if (this.selectedWallId && this.selectedEndpoint) {
        const scene = this.currentScene();
        const wall = (scene?.walls || []).find(w => w.wallId === this.selectedWallId);
        if (wall) {
          const world = this.screenToWorld(sx, sy);
          const x = this.snapToGrid ? snap(world.x) : world.x;
          const y = this.snapToGrid ? snap(world.y) : world.y;
          if (this.selectedEndpoint === 'start') {
            wall.x1 = x; wall.y1 = y;
          } else {
            wall.x2 = x; wall.y2 = y;
          }
          this.renderer()?.renderWallsOverlay();
          this.updateSelectionOverlay();
        }
      }
    }

    onMouseUp(e) {
      if (!this.isActive()) return;
      if (!this.dragging) return;

      const scene = this.currentScene();
      if (!scene) {
        this.cancelDrag();
        return;
      }

      const rect = this.sceneContainer.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.mode === 'draw') {
        const world = this.screenToWorld(sx, sy);
        const x2 = this.snapToGrid ? snap(world.x) : world.x;
        const y2 = this.snapToGrid ? snap(world.y) : world.y;

        const dx = x2 - this.dragStartWorld.x;
        const dy = y2 - this.dragStartWorld.y;
        const minLen = 2;
        if (Math.hypot(dx, dy) >= minLen) {
          const wall = {
            wallId: `wall-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            x1: this.dragStartWorld.x,
            y1: this.dragStartWorld.y,
            x2,
            y2,
          };
          this.socket().emit('addWall', { sceneId: scene.sceneId, wall });
        }
        this.cancelDrag();
        return;
      }

      if (this.selectedWallId && this.selectedEndpoint) {
        const wall = (scene.walls || []).find(w => w.wallId === this.selectedWallId);
        if (wall) {
          this.socket().emit('updateWall', {
            sceneId: scene.sceneId,
            wallId: wall.wallId,
            x1: wall.x1,
            y1: wall.y1,
            x2: wall.x2,
            y2: wall.y2,
          });
        }
      }

      this.dragging = false;
      this.dragStartWorld = null;
      this.removePreview();
    }

    cancelDrag() {
      this.dragging = false;
      this.dragStartWorld = null;
      this.removePreview();
    }

    // ── Preview / selection overlay ─────────────────────────
    ensureInteractionOverlay() {
      let svg = document.getElementById('walls-interaction-overlay');
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'walls-interaction-overlay';
        svg.style.cssText = [
          'position:absolute',
          'top:0', 'left:0',
          'width:100%', 'height:100%',
          'pointer-events:none',
          'z-index:201',
        ].join(';');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        this.sceneContainer.appendChild(svg);
      }
      return svg;
    }

    updatePreview(sx, sy) {
      if (this.mode !== 'draw' || !this.dragStartWorld) return;
      const r = this.renderer();
      const x1 = (this.dragStartWorld.x + r.offsetX) * r.scale;
      const y1 = (this.dragStartWorld.y + r.offsetY) * r.scale;

      const world = this.screenToWorld(sx, sy);
      const x2 = (world.x + r.offsetX) * r.scale;
      const y2 = (world.y + r.offsetY) * r.scale;

      const svg = this.ensureInteractionOverlay();
      if (!this.previewLine) {
        this.previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        this.previewLine.classList.add('wall-preview-line');
        svg.appendChild(this.previewLine);
      }
      this.previewLine.setAttribute('x1', x1);
      this.previewLine.setAttribute('y1', y1);
      this.previewLine.setAttribute('x2', x2);
      this.previewLine.setAttribute('y2', y2);
    }

    removePreview() {
      if (this.previewLine) {
        this.previewLine.remove();
        this.previewLine = null;
      }
      if (this.handleStart) {
        this.handleStart.remove();
        this.handleStart = null;
      }
      if (this.handleEnd) {
        this.handleEnd.remove();
        this.handleEnd = null;
      }
    }

    updateSelectionOverlay() {
      this.removePreview();
      if (!this.selectedWallId) return;
      const scene = this.currentScene();
      const wall = (scene?.walls || []).find(w => w.wallId === this.selectedWallId);
      if (!wall) {
        this.clearSelection();
        return;
      }

      const r = this.renderer();
      const x1 = (wall.x1 + r.offsetX) * r.scale;
      const y1 = (wall.y1 + r.offsetY) * r.scale;
      const x2 = (wall.x2 + r.offsetX) * r.scale;
      const y2 = (wall.y2 + r.offsetY) * r.scale;

      const svg = this.ensureInteractionOverlay();
      this.handleStart = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      this.handleStart.setAttribute('cx', x1);
      this.handleStart.setAttribute('cy', y1);
      this.handleStart.setAttribute('r', 6);
      this.handleStart.classList.add('wall-endpoint-handle');
      if (this.selectedEndpoint === 'start') this.handleStart.classList.add('wall-selected-endpoint');
      svg.appendChild(this.handleStart);

      this.handleEnd = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      this.handleEnd.setAttribute('cx', x2);
      this.handleEnd.setAttribute('cy', y2);
      this.handleEnd.setAttribute('r', 6);
      this.handleEnd.classList.add('wall-endpoint-handle');
      if (this.selectedEndpoint === 'end') this.handleEnd.classList.add('wall-selected-endpoint');
      svg.appendChild(this.handleEnd);
    }

    clearSelection() {
      this.selectedWallId = null;
      this.selectedEndpoint = null;
      this.removePreview();
    }

    // ── Hit testing ─────────────────────────────────────────
    pickEndpointNear(sx, sy, threshold = 10) {
      const scene = this.currentScene();
      const r = this.renderer();
      if (!scene || !r) return null;

      for (const wall of scene.walls || []) {
        const x1 = (wall.x1 + r.offsetX) * r.scale;
        const y1 = (wall.y1 + r.offsetY) * r.scale;
        const x2 = (wall.x2 + r.offsetX) * r.scale;
        const y2 = (wall.y2 + r.offsetY) * r.scale;
        if (Math.hypot(x1 - sx, y1 - sy) <= threshold) {
          return { wall, which: 'start' };
        }
        if (Math.hypot(x2 - sx, y2 - sy) <= threshold) {
          return { wall, which: 'end' };
        }
      }
      return null;
    }

    pickWallNear(sx, sy, threshold = 8) {
      const scene = this.currentScene();
      const r = this.renderer();
      if (!scene || !r) return null;

      let best = null;
      let bestDist = threshold;
      for (const wall of scene.walls || []) {
        const x1 = (wall.x1 + r.offsetX) * r.scale;
        const y1 = (wall.y1 + r.offsetY) * r.scale;
        const x2 = (wall.x2 + r.offsetX) * r.scale;
        const y2 = (wall.y2 + r.offsetY) * r.scale;
        const dist = this.pointToSegmentDistance(sx, sy, x1, y1, x2, y2);
        if (dist < bestDist) {
          bestDist = dist;
          best = wall;
        }
      }
      return best;
    }

    pointToSegmentDistance(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * dx + (py - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    deleteSelectedWall() {
      if (!this.selectedWallId) return;
      const scene = this.currentScene();
      if (!scene) return;
      this.socket().emit('removeWall', { sceneId: scene.sceneId, wallId: this.selectedWallId });
      this.clearSelection();
    }

    // ── Keyboard shortcuts ──────────────────────────────────
    onKeyDown(e) {
      if (!this.isActive()) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (document.activeElement?.contentEditable === 'true') return;

      if (e.key === 'Escape') {
        this.setMode('none');
        this.clearSelection();
        e.stopPropagation();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedWallId) {
        this.deleteSelectedWall();
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  window.VTT_WALLS_TOOL = new WallsTool();
})();
