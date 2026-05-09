# JavaScript Optimization Recommendations

Findings from a full review of all client-side JS. Ordered roughly by impact.

---

## HIGH IMPACT

### 1. Sticky Notes: `querySelector` on every animation frame

**Files:** `stickyNotes.js`, `stickyNotesPlayer.js`

Both files run a `requestAnimationFrame` loop unconditionally at 60 fps. On each frame, for every note they do a DOM `querySelector` to find its element:

```js
// runs 60x per second, for every note
const el = notesLayer.querySelector(`[data-note-id="${note.id}"]`);
```

`playerEffects.js` already solves this correctly — it stores `effect.el` directly on the data object. Do the same for notes:

```js
// on note creation / load, store the reference
note.el = makeElement(note);

// in rafSync, use it directly
if (note.el) syncEl(note.el, note, r);
```

Also: skip the entire sync pass when the renderer's scale/offsetX/offsetY haven't changed since last frame. Almost nothing needs updating when the user isn't panning or zooming.

---

### 2. Sticky Notes: RAF loop runs even when there are no notes

Both `rafSync` functions fire every frame regardless of whether `notes` is empty or whether the view has changed at all. Until there are notes on screen, every frame is wasted work. Add an early-exit:

```js
function rafSync() {
  requestAnimationFrame(rafSync);
  if (!notes.length) return;
  // ... rest of sync
}
```

---

### 3. Grid canvases are 6000×6000 pixels (144 MB of GPU memory)

**Files:** `paintMode.js`, `player.js`

Both create a 6000×6000 canvas for the grid overlay:

```js
gridCanvas.width  = 6000;
gridCanvas.height = 6000;
```

A 6000×6000 RGBA canvas is 144 MB of GPU-backed memory — just for lines. The grid is then transformed with CSS `scale()` so it covers the viewport. You only need a canvas that covers the viewport (roughly 1920×1080), plus a small tile buffer for the CSS transform phase offset. Something like `3000×2000` would be plenty for any monitor and cuts the cost to ~24 MB. Even `window.innerWidth * 2` × `window.innerHeight * 2` would be fine and adapts to the actual screen.

---

### 4. Music list rebuilds entire DOM on every track add

**File:** `musicManager.js`

`addMusicTrack()` calls `this.renderMusicList()` which does `this.musicListElement.innerHTML = ''` and recreates every row from scratch. If there are 10 tracks already loaded, adding the 11th does 11× the DOM work needed. This also resets all volume sliders to `value="50"` visually, even if the DM has adjusted them.

Fix: instead of rebuilding everything, just append a single new `<li>` in `addMusicTrack`. Only call `renderMusicList` from `deleteMusicTrack` (where position indices change and a full rebuild is reasonable).

Also related: the volume slider should be initialized to reflect the actual stored `track.volume`, not always 50:

```js
// current (wrong after any rebuild)
volumeSlider.value = 50;

// correct
volumeSlider.value = Math.round(Math.cbrt(track.volume) * 100);
```

---

### 5. Paint mode: SVG data URLs regenerated on every mousemove

**File:** `paintMode.js`

While the user holds the mouse down and drags, `handlePaint()` fires on every `mousemove`. For each cell in the brush it calls `makeSVG(activeTool)`, which builds and URL-encodes an SVG string. For a 5×5 brush that's 25 SVG strings per pixel of mouse movement.

The SVG for a given tool + gridSize never changes. Cache it:

```js
const svgCache = {};
function makeSVG(tool) {
  const key = `${tool}:${gridSize}`;
  if (!svgCache[key]) {
    // ... existing build logic ...
    svgCache[key] = result;
  }
  return svgCache[key];
}
// Clear cache when gridSize changes
function rebuildGrid() { Object.keys(svgCache).forEach(k => delete svgCache[k]); drawGrid(); }
```

---

### 6. Paint mode: socket flooded during brush drag

**File:** `paintMode.js`

Every cell touched by the brush on every `mousemove` emits `addToken` over the socket. At 60 fps with a 3×3 brush, a 1-second drag can emit 500+ socket events. The `tileMap` check avoids duplicates within the same cell, but new cells fire immediately on every frame.

A simple fix is to throttle: only emit if the cursor has moved to a new grid cell since the last emission. Track the last painted `originCol,originRow` and skip if it hasn't changed:

```js
let lastPaintKey = null;
// inside handlePaint:
const currentKey = `${originCol},${originRow}`;
if (currentKey === lastPaintKey) return;
lastPaintKey = currentKey;
// ... proceed with paint
```

Reset `lastPaintKey = null` on `mouseup`.

---

## MEDIUM IMPACT

### 7. `panZoomHandler`: mousemove listener always active on `document`

**File:** `panZoomHandler.js`

The `mousemove` handler is attached to `document` permanently at construction and checks `if (this.isPanning)` on every mouse movement — even when the user is just hovering over tokens or UI panels. The pattern used in `tokenTool.js` and `playerEffects.js` is better: only attach `mousemove`/`mouseup` to the target when the drag starts, and remove them on `mouseup`:

```js
onMouseDown(event) {
  if (event.button !== 1) return;
  this.isPanning = true;
  // ...
  document.addEventListener('mousemove', this._onMove);
  document.addEventListener('mouseup', this._onUp);
}
```

---

### 8. Dead import: `extractDominantColor` is never called

**File:** `sceneManager.js`

```js
import { extractDominantColor } from './utils.js';
```

This function is imported at the top of `sceneManager.js` but never called anywhere — `setBackgroundBasedOnTokens()` in `sceneRenderer.js` is a documented no-op. The import and `utils.js` itself are unused. Remove the import line.

---

### 9. No-op method call after every scene render

**File:** `sceneManager.js`

```js
this.sceneRenderer.setBackgroundBasedOnTokens(); // documented no-op
```

This is called after every `renderScene()` but does nothing by design. Remove the call.

---

### 10. `player.js`: redundant scene copy in `renderScene`

**File:** `player.js`

```js
function renderScene(scene) {
  const visibleTokens = scene.tokens.filter(token => !token.hidden);
  const sceneCopy = Object.assign({}, scene, { tokens: visibleTokens });
  sceneRenderer.renderScene(sceneCopy); // SceneRenderer already filters hidden tokens internally
```

`SceneRenderer.renderScene()` already filters hidden tokens for non-DM renderers (`this.tokens = scene.tokens.filter(token => !token.hidden)`). The `Object.assign` copy and pre-filter are redundant. Pass the original scene directly and use `visibleTokens` only for `setupTokenInteractions`:

```js
function renderScene(scene) {
  sceneRenderer.renderScene(scene);
  scene.tokens
    .filter(t => !t.hidden)
    .forEach(token => tokenManager.setupTokenInteractions(token));
}
```

---

## LOW IMPACT / CODE QUALITY

### 11. `buildSVG` is duplicated between DM and player effects

**Files:** `areaEffects.js`, `playerEffects.js`

Both files contain an identical `buildSVG(shape, color, ft, breathing)` function. This could live in a shared `effectsUtils.js` and be imported by both. Low priority since the logic is stable, but any future change has to be made twice.

---

### 12. Scattered polling loops for `VTT_DM` / `VTT_PLAYER`

**Files:** `paintMode.js`, `stickyNotes.js`, `stickyNotesPlayer.js`, `playerEffects.js`, `playerInitiative.js`, `initiativeTracker.js`

Every non-module script that needs the socket or renderer has its own `setTimeout` polling loop:

```js
(function tryLoad() {
  if (window.VTT_DM) { ... } else { setTimeout(tryLoad, 200); }
})();
```

These work fine, but they're scattered and all slightly different. A single utility in `dm.js`/`player.js` that fires a custom `vtt-ready` DOM event when the context is available would let all other scripts listen for it cleanly instead of polling. Low priority since the polling is cheap and reliable enough for a LAN app.

---

### 13. `musicManager.js`: `setupSocketListeners` is empty

```js
setupSocketListeners() {
  // Music control events from the server (if needed on DM side)
}
```

Dead method, called in `init()`. Remove both the method and the `init()` call to it.
