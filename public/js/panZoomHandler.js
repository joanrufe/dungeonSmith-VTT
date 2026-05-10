// public/js/panZoomHandler.js

export class PanZoomHandler {
  constructor(container, sceneRenderer) {
    this.container = container;
    this.sceneRenderer = sceneRenderer;

    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.container.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.container.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this._onMove = (event) => this.onMouseMove(event);
    this._onUp   = (event) => this.onMouseUp(event);
  }

  onWheel(event) {
    event.preventDefault();

    const rect = this.container.getBoundingClientRect();

    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate the mouse position in scene (world) coordinates before scaling
    const mouseSceneX = (mouseX / this.sceneRenderer.scale) - this.sceneRenderer.offsetX;
    const mouseSceneY = (mouseY / this.sceneRenderer.scale) - this.sceneRenderer.offsetY;

    // Adjust the scale
    const baseZoomIntensity = 0.00035; // Base zoom intensity
    // Adjust intensity proportionally to current scale
    const zoomIntensity = baseZoomIntensity * this.sceneRenderer.scale;

    const delta = event.deltaY;
    const zoom = Math.exp(-delta * zoomIntensity);

    this.sceneRenderer.scale *= zoom;
    // Limit to reasonable bounds
    this.sceneRenderer.scale = Math.min(Math.max(this.sceneRenderer.scale, 0.5), 5);

    // After adjusting the scale, recalculate the offsets so that the mouse scene position stays under the mouse pointer
    this.sceneRenderer.offsetX = (mouseX / this.sceneRenderer.scale) - mouseSceneX;
    this.sceneRenderer.offsetY = (mouseY / this.sceneRenderer.scale) - mouseSceneY;

    // Update all token positions
    this.sceneRenderer.updateAllTokenElements();
  }

  onMouseDown(event) {
    if (event.button === 1) {
      this.isPanning = true;
      this.startX = event.clientX;
      this.startY = event.clientY;
      event.preventDefault();
      document.addEventListener('mousemove', this._onMove);
      document.addEventListener('mouseup', this._onUp);
    }
  }

  onMouseMove(event) {
    const deltaX = (event.clientX - this.startX) / this.sceneRenderer.scale;
    const deltaY = (event.clientY - this.startY) / this.sceneRenderer.scale;
    this.sceneRenderer.offsetX += deltaX;
    this.sceneRenderer.offsetY += deltaY;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.sceneRenderer.updateAllTokenElements();
  }

  onMouseUp(event) {
    if (event.button === 1) {
      this.isPanning = false;
      event.preventDefault();
      document.removeEventListener('mousemove', this._onMove);
      document.removeEventListener('mouseup', this._onUp);
    }
  }

  /** Apply a view state (e.g. from DM snap-to-view). */
  applyView(scale, offsetX, offsetY) {
    this.sceneRenderer.scale   = scale;
    this.sceneRenderer.offsetX = offsetX;
    this.sceneRenderer.offsetY = offsetY;
    this.sceneRenderer.updateAllTokenElements();
  }
}