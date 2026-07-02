// public/js/warFogTool.js
// DM "War Fog" tool: per-scene fog overlay opacity slider.
// Lives outside the walls panel because fog rendering is a different concern
// from wall geometry and we want room to add more fog-related settings here
// (e.g. explore radius, vision FX) without touching wallsTool.

(function () {
  'use strict';

  const EMIT_THROTTLE_MS = 50;

  class WarFogTool {
    constructor() {
      this.panel = null;
      this.btn = null;
      this.slider = null;
      this.display = null;
      this.observer = null;
      this.emitTimer = null;

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        this.init();
      }
    }

    init() {
      this.panel = document.getElementById('warfog-panel');
      this.btn = document.getElementById('warfog-toggle-btn');
      this.slider = document.getElementById('warfog-opacity-slider');
      this.display = document.getElementById('warfog-opacity-display');
      if (!this.panel || !this.slider) return;

      this.bindPanel();
      this.bindSocket();
      this.observePanelVisibility();
    }

    // ── UI bindings ─────────────────────────────────────────
    bindPanel() {
      this.slider.addEventListener('input', () => this.onSliderInput());
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

    isActive() {
      return this.panel && !this.panel.classList.contains('panel-hidden');
    }

    setSliderValue(v) {
      const clamped = Math.max(0, Math.min(1, Number(v) || 0));
      this.slider.value = String(clamped);
      this.updateDisplay(clamped);
    }

    updateDisplay(v) {
      if (this.display) this.display.textContent = `${Math.round(v * 100)}%`;
    }

    syncFromScene() {
      const scene = this.currentScene();
      if (!scene) return;
      this.setSliderValue(scene.fogOpacity ?? 1);
    }

    onSliderInput() {
      const v = parseFloat(this.slider.value);
      this.updateDisplay(v);
      const sm = this.sceneManager();
      if (!sm || !sm.currentScene) return;
      const scene = sm.currentScene;
      // Keep the local copy in sync so the panel matches even before the
      // server echoes the broadcast back.
      scene.fogOpacity = v;

      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        sm.socket.emit('setFogOpacity', { sceneId: scene.sceneId, fogOpacity: v });
      }, EMIT_THROTTLE_MS);
    }

    // ── Server feedback ─────────────────────────────────────
    bindSocket() {
      // Wait for the module-loaded scene manager before wiring up.
      const wire = () => {
        if (!window.VTT_DM) { setTimeout(wire, 150); return; }
        const sm = window.VTT_DM.sceneManager;
        sm.socket.on('fogOpacity', (payload) => {
          const scene = this.currentScene();
          if (!scene || !payload) return;
          if (payload.sceneId && payload.sceneId !== scene.sceneId) return;
          const v = Math.max(0, Math.min(1, Number(payload.fogOpacity) || 0));
          scene.fogOpacity = v;
          this.setSliderValue(v);
        });
        // Re-sync the slider whenever the DM loads a new scene.
        sm.socket.on('sceneData', (scene) => {
          this.setSliderValue(scene.fogOpacity ?? 1);
        });
        // Also try to pull the value right now in case a scene is already loaded.
        this.syncFromScene();
      };
      wire();
    }

    // ── Tool active flag ────────────────────────────────────
    observePanelVisibility() {
      if (!this.panel || !window.MutationObserver) return;
      const syncFlag = () => {
        const active = this.isActive();
        window.VTT_ACTIVE_WARFOG_TOOL = active ? true : null;
      };
      syncFlag();
      this.observer = new MutationObserver(syncFlag);
      this.observer.observe(this.panel, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.VTT_WARFOG_TOOL = new WarFogTool();
})();
