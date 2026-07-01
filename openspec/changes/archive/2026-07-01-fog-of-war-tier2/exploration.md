# Exploration: Fog of War – Tier 2 (Vision Radius)

**Change:** fog-of-war-tier2  
**Date:** 2026-07-01  
**Status:** Ready for Proposal

---

## Problem Statement & Scope

SceneSmith-VTT has no fog of war concept today. Tokens are placed on a flat scene; players see all
non-hidden tokens. Tier 2 goal: give one or more "PC tokens" a vision radius so the player view is
masked except for the lit area around those tokens. Walls / line-of-sight are explicitly **deferred
to Tier 3**.

**In scope for Tier 2:**
- A circular (or configurable-radius) fog mask visible only on the player view.
- One or more tokens can be designated as "vision sources" with a `visionRadius` property (pixels in
  world space, proportional to grid cells).
- The DM always sees through the fog (no masking on `dm.html`).
- The fog state is **pure client-side rendering** — no new server state needed. The `visionRadius`
  property is stored on tokens and flows through the existing `updateToken` / `sceneData` machinery.
- A **map token** concept is needed to anchor the coordinate space. The user's suggestion:
  a special token property (`isMap: true`) that marks a "background image" token as the canonical
  map. This avoids adding a first-class map entity to the server schema.

**Out of scope (Tier 3+):**
- Wall / obstacle line-of-sight blocking.
- Multiple overlapping vision shapes (penumbra, dim-light).
- Fog reveal persistence across sessions.

---

## Current State

### Token Schema (`app.py` + `sceneManager.js` typedef)

All fields are optional except the required core:
```
tokenId, sceneId, imageUrl, mediaType, x, y, width, height, rotation, zIndex,
movableByPlayers, hidden

Optional: name, locked, isPaintTile, isAreaEffect, areaShape,
          hpCurrent, hpMax, conditionText, conditionColor, conditionFontSize
```

`app.py:update_token()` uses `token.update(properties)` — it accepts any key/value pair.
The TypedDict (`TokenDict`, `total=False` for optional fields) means new optional properties
like `visionRadius`, `isMap`, or `isFogSource` are accepted without schema migration.

### Rendering Architecture

- **`SceneRenderer`** (`sceneRenderer.js`): DOM-based renderer. Tokens become `<img>` or `<video>`
  elements appended to `#scene-container`. No canvas per token. Canvas elements currently used only
  for the grid overlay (`paint-grid-canvas`, `player-grid-canvas`).
- **`SceneRenderer.updateAllTokenElements()`**: called on every pan/zoom. This is the hook to
  synchronize a fog overlay canvas.
- **No fog canvas exists today.** The closest analogue is the grid canvas approach: a full-viewport
  `<canvas>` appended to `#scene-container` with `pointer-events:none` and a z-index above tokens.
- **z-index layering today:**
  - `scene-bg-el`: `z-index: -9999`
  - Paint tiles: `z-index: -10` (default, configurable)
  - Regular tokens: `zIndex` from the token (1–N)
  - Grid canvas: `z-index: 1`, `opacity: 0.35`
  - Area effects: z-index from token (SVG-based, rendered as tokens)
  - HP bars, condition labels: no explicit z-index (natural stacking)
  - A fog canvas would need to sit **above all tokens** (high z-index, e.g. 9000) on the player
    page only.

### DM vs Player Differentiation

- `SceneRenderer(container, isDM)` — the `isDM` flag is already used to skip hidden tokens.
- `dm.js` → `new SceneRenderer(sceneContainer, true)`.
- `player.js` → `new SceneRenderer(sceneContainer, false)`.
- The fog canvas should only be appended and drawn when `isDM === false` (or a DM-toggle is off).

### Socket.IO / Update Flow

```
DM browser
  └── socket.emit('updateToken', { sceneId, tokenId, properties: { visionRadius: 120 } })
        └── app.py: socket_update_token()
              └── token.update(properties)        ← persists visionRadius to scene JSON
              └── emit('updateToken', ...) → all clients
                    └── player.js / sceneManager.js: Object.assign(token, properties)
                          └── sceneRenderer.updateTokenElement(token)
                                └── ← HERE: fog canvas must be redrawn
```

No new Socket.IO events are required. `visionRadius` flows as a token property exactly like
`hpCurrent` or `rotation`.

### Undo/Redo (Memento)

`SceneHistory` snapshots `scene["tokens"]` as a JSON deep-copy. Since `visionRadius` and `isMap`
are token properties, they are **automatically included in undo snapshots** at no cost. Undo/redo
of a vision-radius change works out of the box.

### Pan/Zoom

`PanZoomHandler` mutates `sceneRenderer.offsetX/Y` and `sceneRenderer.scale`, then calls
`sceneRenderer.updateAllTokenElements()`. Any fog canvas must be repositioned/redrawn in that call.
The grid canvas pattern (CSS `transform` approach) is a reference for how to handle this.

---

## Affected Areas

- `app.py` — Add `visionRadius: Optional[float]` and `isMap: Optional[bool]` to `TokenDict`
  (documentation/type hint only; runtime behavior is backward-compatible).
- `public/js/sceneRenderer.js` — Core change: add fog overlay canvas, draw/redraw it on every
  `updateAllTokenElements()` call. Add `_syncFogCanvas()` method.
- `public/js/sceneManager.js` — `TokenDict` JSDoc typedef needs `visionRadius` and `isMap`.
- `public/js/dm.html` — DM UI: add a "Vision Radius" input to the Token Status popup (or a
  dedicated toggle in the tools tray). Also a DM "Preview Fog" toggle to see the player view.
- `public/js/tokenTool.js` — Token Status popup `tsp-apply` handler: read and emit `visionRadius`.
- `public/js/dmControls.js` — Optional: add fog toggle button to tools tray.
- `public/js/dm.js` — No change expected.
- `public/js/player.js` — No change expected (fog is rendered inside `SceneRenderer`).
- `data/scenes/*.json` — New optional token fields; backward-compatible.

---

## Approaches

### Approach A — Pure Canvas Fog Overlay (Recommended)

Add a single `<canvas id="fog-canvas">` to `#scene-container` on the player page, above all tokens
(z-index ~9000). On every render cycle (`updateAllTokenElements`, `renderScene`), call
`_syncFogCanvas()`:

1. Fill the entire canvas with an opaque dark color (e.g. `rgba(0,0,0,0.92)`).
2. For each token where `token.visionRadius > 0`, set `ctx.globalCompositeOperation = 'destination-out'`
   and draw a radial gradient circle centered on the token's screen position with radius
   `token.visionRadius * scale`. This punches a "hole" through the dark overlay.
3. Reset `globalCompositeOperation`.

The canvas repositions via CSS transform on pan/zoom (same as `player-grid-canvas`).

**Pros:**
- Clean isolation — fog is one canvas, no impact on token DOM elements.
- Radial gradient allows soft edges (dim-light outer ring) at no extra cost.
- Multiple vision sources trivially handled by iterating all tokens with `visionRadius > 0`.
- Undo/redo free (visionRadius is already in token snapshot).
- DM never sees it (canvas only appended when `isDM === false`).
- No new server events, no schema migration.

**Cons:**
- `_syncFogCanvas()` runs on every pan/zoom frame — must be fast. For <50 tokens this is trivial
  on canvas 2d; only a concern with hundreds of sources.
- Canvas must be resized on window resize (ResizeObserver or `window.resize` listener).
- Soft-edge radius needs a UX decision (hard cutoff vs. gradient).

**Effort:** Medium (1–2 days)

---

### Approach B — CSS `clip-path` / `mask-image` per Token

For each token with `visionRadius > 0`, apply a CSS radial-gradient mask or clip-path to reveal
a circular area. The container itself gets a dark `::before` pseudo-element or overlay `<div>`.

**Pros:**
- No canvas; pure CSS.
- GPU-accelerated compositing.

**Cons:**
- CSS masks on multiple overlapping elements are notoriously hard to compose correctly — you can't
  easily "union" multiple clip regions.
- Requires CSS changes to `#scene-container` which may break existing paint tile / area-effect
  z-index stacking.
- Hard to implement soft edges with multiple sources without a canvas anyway.
- Very fragile with pan/zoom since every token position and the overlay div must stay in sync.

**Effort:** High, and less reliable than canvas.

---

### Approach C — Server-side Fog Mask (Computed & Broadcast)

Server computes the visible region as a polygon/circle list and broadcasts a `fogUpdate` event.
Players draw the fog based on server state.

**Pros:**
- Authoritative — players can't tamper with fog visibility.
- Enables future Tier 3 wall occlusion on the server.

**Cons:**
- Heavy scope increase: new socket event, new server state, server-side geometry.
- Breaks the project's "client-side rendering, server-authoritative data" split — fog rendering
  detail doesn't need server authority at Tier 2.
- Contradicts the existing pattern: DM already controls what players see via `hidden` flags.
- `app.py` stays monolithic by design (per `openspec/config.yaml` constraints); adding geometry
  computation would bloat it further.
- Fog "trust" is not a concern for a local/trusted game (per `README.md` security stance).

**Effort:** Very High. Deferred to Tier 3 when walls make server-side raycasting worthwhile.

---

## Recommended Approach

**Approach A — Pure Canvas Fog Overlay.**

It follows the exact same pattern already established by `player-grid-canvas`:
- A full-viewport canvas appended to `#scene-container`.
- Positioned via CSS transform matching the renderer's offset/scale.
- Drawn/redrawn via a renderer method called from `updateAllTokenElements()`.

The `visionRadius` property flows for free through the existing token update/undo pipeline.
The DM sees no fog by default; a DM "preview" toggle is an optional nice-to-have.

### Token Property Additions

```json
{
  "tokenId": "...",
  "isMap": true,           // optional: marks this token as the scene background map
  "visionRadius": 150      // optional: world-space radius in pixels; 0 = no vision source
}
```

`isMap` is a soft marker used client-side to:
1. Prevent accidental deletion / movement of the map token.
2. Anchor the fog-drawing coordinate reference.

It does NOT change server-side routing — `isMap` flows through `updateToken` like any other property.

### Fog Canvas Rendering Pseudocode

```javascript
// In SceneRenderer._syncFogCanvas() — player page only
_syncFogCanvas() {
  if (this.isDM) return;
  const visionTokens = this.tokens.filter(t => t.visionRadius > 0 && !t.hidden);
  if (!visionTokens.length) { /* hide canvas */ return; }

  const ctx = this.fogCanvas.getContext('2d');
  ctx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);

  // 1. Fill with dark fog
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  ctx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);

  // 2. Punch holes for each vision source
  ctx.globalCompositeOperation = 'destination-out';
  for (const token of visionTokens) {
    const cx = (token.x + token.width / 2 + this.offsetX) * this.scale;
    const cy = (token.y + token.height / 2 + this.offsetY) * this.scale;
    const r  = token.visionRadius * this.scale;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');    // fully clear at inner edge
    grad.addColorStop(1, 'rgba(0,0,0,0)');    // feathered outer edge
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
```

---

## Risks and Open Questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| Performance on high-zoom with many tokens | Low | Cap token count in practice; canvas 2d is fast for <50 radial grads |
| Fog canvas size after window resize | Medium | Add `ResizeObserver` on `#scene-container`; recreate canvas on resize |
| DM accidentally seeing fog (if DM-preview is added) | Low | Toggle is opt-in; default is "DM sees all" |
| Token dragging updates fog in real-time (latency) | Low | Client applies position locally before server round-trip; fog redraws on every `pointermove` emit |
| Map token concept: no first-class map today | Medium | `isMap` property is purely cosmetic at Tier 2; DM must mark one token manually. Document the convention. |
| `visionRadius` units (pixels vs grid cells) | Open | Recommend storing in **world pixels** (consistent with x/y/width/height); expose in UI as "grid cells" with a formula: `radius = N * VTT_GRID_SIZE` |
| Multiple players each with their own vision | Open | With one fog canvas for all players, the union of all visionRadius tokens is shown. Per-player individualized fog is Tier 4+. |
| Area effect tokens also checked for visionRadius | Low | Filter by `!token.isAreaEffect && !token.isPaintTile` |

---

## Files Likely to Change

| File | Change |
|------|--------|
| `app.py` | Add `visionRadius: Optional[float]` and `isMap: Optional[bool]` to `TokenDict` (type hints only) |
| `public/js/sceneRenderer.js` | Add `_buildFogCanvas()`, `_syncFogCanvas()`, call from `renderScene()` and `updateAllTokenElements()` |
| `public/js/sceneManager.js` | Add `visionRadius` and `isMap` to `@typedef TokenDict` JSDoc |
| `public/dm.html` | Add vision radius input field in Token Status popup; optional DM "Preview Fog" toggle in tray |
| `public/js/tokenTool.js` | `tsp-apply` handler: read and emit `visionRadius` property |
| `public/css/styles.css` (or `dm.css`) | Minor: style for vision radius input in popup |
| `data/scenes/*.json` | No migration needed; new properties are optional |

---

## Ready for Proposal

**Yes.** The approach is clear, the scope is bounded, and all integration points are identified.

The proposal should confirm:
1. Whether the DM also gets a "Preview Fog" button to see the player view (nice-to-have).
2. Whether `visionRadius` UI uses raw pixels or grid-cell count with auto-conversion.
3. Whether `isMap` also affects DM behavior (e.g. prevents deletion/movement without an extra step).
