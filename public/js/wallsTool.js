// public/js/wallsTool.js
// DM wall drawing/editing tool.
// Walls are closed polygons. Clicks add vertices; clicking near the first
// vertex (or double-clicking) closes the polygon. Esc cancels.

(function () {
  'use strict';

  const GRID_SIZE = () => window.VTT_GRID_SIZE || 60;
  const CLOSE_THRESHOLD_PX = 12;
  const MIN_VERTICES = 3;

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
      this.dragging = false;
      this.dragCurrentScreen = null;

      // In-progress polygon drawing state
      this.inProgress = null;     // { points: [{x,y}, ...] }
      this.previewLine = null;    // SVG polyline of placed vertices
      this.previewCursor = null;  // SVG line from last vertex to mouse
      this.previewVertices = [];  // SVG circles for placed vertices

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
      this.bindDblClick();
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
          this.cancelPolygon();
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

    worldToScreen(wx, wy) {
      const r = this.renderer();
      const scale = r?.scale || 1;
      return {
        x: (wx + (r?.offsetX || 0)) * scale,
        y: (wy + (r?.offsetY || 0)) * scale,
      };
    }

    isActive() {
      return this.panel && !this.panel.classList.contains('panel-hidden');
    }

    // ── Mode handling ───────────────────────────────────────
    setMode(mode) {
      this.mode = mode;
      this.clearSelection();
      this.cancelPolygon();
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

    bindDblClick() {
      // Double-click closes an in-progress polygon with >= MIN_VERTICES vertices
      this.sceneContainer.addEventListener('dblclick', (e) => {
        if (!this.isActive()) return;
        if (this.mode !== 'draw') return;
        if (!this.inProgress) return;
        e.preventDefault();
        e.stopPropagation();
        this.closePolygon();
      });
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
        const x = this.snapToGrid ? snap(world.x) : world.x;
        const y = this.snapToGrid ? snap(world.y) : world.y;

        if (!this.inProgress) {
          this.inProgress = { points: [{ x, y }] };
        } else if (this.isNearFirstVertex(sx, sy)) {
          this.closePolygon();
          e.preventDefault();
          return;
        } else {
          this.inProgress.points.push({ x, y });
        }
        this.dragging = true;
        this.dragCurrentScreen = { sx, sy };
        this.updateDrawPreview(sx, sy);
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

      // Default: select a wall for editing
      const wall = this.pickWallNear(sx, sy);
      if (wall) {
        this.selectedWallId = wall.wallId;
        this.dragging = true;
        this.dragCurrentScreen = { sx, sy };
        this.updateSelectionOverlay();
        e.preventDefault();
        return;
      }
      this.clearSelection();
    }

    onMouseMove(e) {
      if (!this.isActive()) return;
      if (!this.dragging && this.mode !== 'draw') return;

      const rect = this.sceneContainer.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this.dragCurrentScreen = { sx, sy };

      if (this.mode === 'draw' && this.inProgress) {
        this.updateDrawPreview(sx, sy);
        return;
      }

      if (this.selectedWallId) {
        // Drag the whole polygon (vertices translated by the screen delta)
        const scene = this.currentScene();
        const wall = (scene?.walls || []).find(w => w.wallId === this.selectedWallId);
        if (!wall) return;
        const dxScreen = sx - (this._lastDragScreen?.sx ?? sx);
        const dyScreen = sy - (this._lastDragScreen?.sy ?? sy);
        this._lastDragScreen = { sx, sy };
        const r = this.renderer();
        const dxWorld = dxScreen / (r?.scale || 1);
        const dyWorld = dyScreen / (r?.scale || 1);
        for (const pt of wall.points) {
          pt.x += dxWorld;
          pt.y += dyWorld;
        }
        this.renderer()?.renderWallsOverlay();
        this.updateSelectionOverlay();
      }
    }

    onMouseUp(e) {
      if (!this.isActive()) return;
      this._lastDragScreen = null;
      if (!this.dragging) return;

      const scene = this.currentScene();

      if (this.selectedWallId && scene) {
        const wall = (scene.walls || []).find(w => w.wallId === this.selectedWallId);
        if (wall) {
          this.socket().emit('updateWall', {
            sceneId: scene.sceneId,
            wallId: wall.wallId,
            points: wall.points,
          });
        }
      }

      this.dragging = false;
      this.dragStartWorld = null;
      this.removeSelectionOverlay();
    }

    isNearFirstVertex(sx, sy) {
      if (!this.inProgress || this.inProgress.points.length < 2) return false;
      const first = this.inProgress.points[0];
      const screen = this.worldToScreen(first.x, first.y);
      return Math.hypot(screen.x - sx, screen.y - sy) <= CLOSE_THRESHOLD_PX;
    }

    closePolygon() {
      if (!this.inProgress) return;
      const points = this.inProgress.points;
      if (points.length < MIN_VERTICES) {
        this.cancelPolygon();
        return;
      }
      const scene = this.currentScene();
      if (!scene) {
        this.cancelPolygon();
        return;
      }
      const wall = {
        wallId: `wall-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        points: points.map(p => ({ x: p.x, y: p.y })),
      };
      this.socket().emit('addWall', { sceneId: scene.sceneId, wall });
      this.inProgress = null;
      this.removeDrawPreview();
    }

    cancelPolygon() {
      this.inProgress = null;
      this.removeDrawPreview();
    }

    // ── SVG overlay helpers ────────────────────────────────
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

    updateDrawPreview(sx, sy) {
      if (!this.inProgress) return;
      const svg = this.ensureInteractionOverlay();
      const r = this.renderer();
      const points = this.inProgress.points;

      // Build placed vertices as circles
      this.removeDrawPreview();
      this.previewVertices = [];
      for (const p of points) {
        const sp = this.worldToScreen(p.x, p.y);
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', sp.x);
        c.setAttribute('cy', sp.y);
        c.setAttribute('r', 5);
        c.classList.add('wall-endpoint-handle');
        svg.appendChild(c);
        this.previewVertices.push(c);
      }

      // Polyline connecting placed vertices
      const ptsAttr = points
        .map(p => {
          const sp = this.worldToScreen(p.x, p.y);
          return `${sp.x},${sp.y}`;
        })
        .join(' ');
      this.previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      this.previewLine.setAttribute('points', ptsAttr);
      this.previewLine.classList.add('wall-preview-line');
      svg.appendChild(this.previewLine);

      // Live line from last vertex to cursor
      if (points.length > 0) {
        const last = points[points.length - 1];
        const sp = this.worldToScreen(last.x, last.y);
        this.previewCursor = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        this.previewCursor.setAttribute('x1', sp.x);
        this.previewCursor.setAttribute('y1', sp.y);
        this.previewCursor.setAttribute('x2', sx);
        this.previewCursor.setAttribute('y2', sy);
        this.previewCursor.classList.add('wall-preview-line');
        svg.appendChild(this.previewCursor);
      }
      void r;
    }

    removeDrawPreview() {
      if (this.previewLine) {
        this.previewLine.remove();
        this.previewLine = null;
      }
      if (this.previewCursor) {
        this.previewCursor.remove();
        this.previewCursor = null;
      }
      for (const c of this.previewVertices) {
        c.remove();
      }
      this.previewVertices = [];
    }

    removeSelectionOverlay() {
      // Selection state is held in currentScene; nothing to clear on the SVG.
    }

    removePreview() {
      this.removeDrawPreview();
    }

    updateSelectionOverlay() {
      // No persistent selection overlay for polygons (mousedown selection
      // is held in `selectedWallId`); the renderer draws all walls.
    }

    clearSelection() {
      this.selectedWallId = null;
      this.dragging = false;
      this._lastDragScreen = null;
    }

    // ── Hit testing ─────────────────────────────────────────
    pickWallNear(sx, sy, threshold = 10) {
      const scene = this.currentScene();
      const r = this.renderer();
      if (!scene || !r) return null;

      const scale = r.scale || 1;
      let best = null;
      let bestDist = threshold;
      for (const wall of scene.walls || []) {
        const pts = (wall.points || []).map(p => ({
          x: (p.x + r.offsetX) * scale,
          y: (p.y + r.offsetY) * scale,
        }));
        if (pts.length === 0) continue;

        // First: hit test against each edge
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          const d = this.pointToSegmentDistance(sx, sy, a.x, a.y, b.x, b.y);
          if (d < bestDist) {
            bestDist = d;
            best = wall;
          }
        }
        // Then: inside the polygon wins over any edge near-miss
        if (this.pointInPolygon(sx, sy, pts)) {
          bestDist = 0;
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

    pointInPolygon(px, py, pts) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y;
        const xj = pts[j].x, yj = pts[j].y;
        const intersect = ((yi > py) !== (yj > py)) &&
          (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-10) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
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
        if (this.inProgress) {
          this.cancelPolygon();
        } else {
          this.setMode('none');
          this.clearSelection();
        }
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
