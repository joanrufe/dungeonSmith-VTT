# Exploration: Fog of War – Line of Sight & Walls

**Change:** fog-of-war-line-of-sight  
**Date:** 2026-07-02  
**Status:** Ready for Proposal

---

## Problem Statement & Scope

Tier 2 (`fog-of-war-tier2`, archived 2026-07-01) added a canvas-based fog overlay and a per-token `visionRadius`. Player vision is currently an unobstructed radial circle. This change adds **walls** that are invisible to players but block line of sight, so the area revealed around a vision source is clipped by obstacles.

**In scope:**
- DM can draw, edit, and delete straight wall segments.
- Walls are never visible to players.
- Walls occlude player vision: the fog clears only where a vision source has an unobstructed path.
- Walls persist in scene JSON and sync through Socket.IO.
- DM sees walls as faint editable overlays.

**Out of scope:**
- Diagonal/curved walls (initially), doors/windows, hidden DM-only vision sources, per-player individualized fog, fog-reveal persistence across sessions.

---

## Current State

### Fog Rendering (Tier 2)

`public/js/sceneRenderer.js` already implements a player-only fog canvas:
- Canvas appended to `#scene-container` when `!this.isDM`, `z-index:100`, `pointer-events:none`.
- `drawFog()` fills with `rgba(0,0,0,0.92)` then uses `globalCompositeOperation = 'destination-out'` to punch radial-gradient holes for every token with `visionRadius > 0`.
- Redrawn on every pan/zoom/token move via `updateAllTokenElements()`.

### Scene & Token Schema

`app.py` `SceneDict` currently has `sceneId`, `sceneName`, `tokens`, optional `order`. `TokenDict` accepts any extra key through `token.update(properties)`, including `visionRadius` and `isMap`.

### Player Filtering

`app.py:socket_load_scene` filters hidden tokens for players but otherwise sends the full scene. Walls would need to be stripped from player payloads.

### DM Tools Pattern

`public/js/paintMode.js` shows the established pattern for a DM-only drawing tool: tool activation via tray button, `window.VTT_ACTIVE_PAINT_TOOL`, click-drag on `#scene-container`, emit `addToken`/`removeToken`, preview overlay. `areaEffects.js` shows another interactive placement pattern.

---

## Affected Areas

- `app.py` — New `WallDict` type, optional `walls` on `SceneDict`, wall CRUD socket events, player scene filtering must strip walls.
- `public/js/sceneRenderer.js` — Replace pure radial fog holes with wall-aware visibility polygons; keep the `drawFog()` lifecycle.
- `public/js/sceneManager.js` — Hold `currentScene.walls`, add wall socket listeners, update wall state on mutations.
- `public/js/wallsTool.js` (new) — DM wall drawing/editing interaction, snap-to-grid, preview, delete.
- `public/dm.html` — Walls tray button + floating panel.
- `public/js/dmControls.js` — Panel toggle wiring.
- `public/css/dm.css` — Wall preview/overlay styles.
- `data/scenes/*.json` — New optional `walls` array; backward-compatible.

---

## Candidate Approaches

### Approach A — Raycast Visibility Polygon (Recommended)

For each vision source, cast rays toward every wall endpoint (plus small angular offsets around each endpoint) and find the nearest wall intersection. Connect the nearest intersection points into a polygon; clear that polygon from the fog canvas.

- **Pros:** Straightforward to implement with the existing canvas API; produces smooth arbitrary visibility boundaries; naturally composes with `destination-out`; easy to cap at `visionRadius`.
- **Cons:** Edge cases at T-junctions or collinear walls can leak tiny slivers unless extra rays are added; cost grows as `O(V × W)` per frame, but still fine for typical VTT scenes (<50 walls, <10 sources).
- **Effort:** Medium.

### Approach B — Angular Sweep Visibility Polygon

Sort all wall endpoints by angle around the vision source, sweep around maintaining the nearest active wall in a structure, and emit the visibility polygon directly.

- **Pros:** Mathematically robust; no sliver leaks; handles overlapping and collinear walls correctly.
- **Cons:** Significantly more code and harder to debug; overkill for a first wall implementation.
- **Effort:** High.

### Approach C — Grid-Based Shadow Casting

Discretize the scene into grid cells, mark cells touched by wall segments as blocked, and run a 2D shadow-casting routine to decide which cells are visible.

- **Pros:** Simple integer math; aligns naturally with snap-to-grid drawing.
- **Cons:** Blocky, aliased edges that do not align with arbitrary wall angles; requires choosing a resolution; mismatched with the existing smooth radial fog.
- **Effort:** Medium, but poor visual fit.

---

## Recommended Approach

**Approach A — Raycast Visibility Polygon.**

It reuses the existing canvas fog pipeline with minimal conceptual change: instead of clearing a circle, clear the visibility polygon. The server only stores line segments; all visibility math stays client-side, preserving the trust model and frontend-parity constraint.

### Wall Data Model

```python
class WallDict(TypedDict):
    wallId: str
    x1: float
    y1: float
    x2: float
    y2: float
```

Stored on the scene:

```json
{
  "sceneId": "...",
  "sceneName": "...",
  "tokens": [...],
  "walls": [
    { "wallId": "w-123", "x1": 120, "y1": 200, "x2": 300, "y2": 200 }
  ]
}
```

`walls` is optional and defaults to `[]`; legacy scenes load without migration.

### Visibility Polygon Sketch

```javascript
// For a single vision source at (sx, sy) with radius r
const angles = new Set();
for (const wall of walls) {
  for (const pt of [{x: wall.x1, y: wall.y1}, {x: wall.x2, y: wall.y2}]) {
    const base = Math.atan2(pt.y - sy, pt.x - sx);
    angles.add(base - EPSILON);
    angles.add(base);
    angles.add(base + EPSILON);
  }
}

const points = [];
for (const a of angles) {
  const ray = { x: sx + Math.cos(a) * r, y: sy + Math.sin(a) * r };
  let nearest = ray;
  for (const wall of walls) {
    const hit = raySegmentIntersection(sx, sy, ray.x, ray.y, wall);
    if (hit && dist(hit, source) < dist(nearest, source)) nearest = hit;
  }
  points.push(nearest);
}
// Sort points radially, then fill polygon
```

The polygon can be filled with a radial gradient fade at the outer radius to preserve the soft edge from Tier 2.

---

## UI/UX for Drawing Walls

- **Tool activation:** Add a "Walls" button to the right tools tray (`#dm-tool-tray`) that opens a small floating panel (`#walls-panel`), following the pattern used by Paint, Effects, and Notes.
- **Modes:** "Draw" (default) and "Erase". A snap-to-grid checkbox mirrors the paint/grid tools.
- **Drawing:** In draw mode, the DM clicks and drags on `#scene-container`. A preview line follows the cursor; on release, the segment is emitted as `addWall`.
- **Visual feedback:** Walls render as thin semi-transparent red/magenta lines with small endpoint handles **only for the DM**. Players never see them.
- **Deletion:** Erase mode turns the cursor into an eraser; clicking near a wall segment removes it. Alternatively, right-click a wall to delete.
- **Keyboard:** `W` toggles the walls panel; `Esc` deactivates the tool.
- **Snap:** Hold a modifier or enable the snap checkbox to quantize both endpoints to `VTT_GRID_SIZE`.

---

## Integration with Existing Fog Canvas & `visionRadius`

1. `drawFog()` continues to run only on the player page.
2. It still iterates tokens with `visionRadius > 0`.
3. For each vision source, instead of drawing a circle, compute the visibility polygon bounded by walls and `visionRadius`.
4. Use `destination-out` to clear each polygon; overlapping sources naturally union.
5. Provide `drawFog()` access to the current wall list via `this.currentScene.walls` or a cached array.
6. Redraw fog when:
   - Tokens move or change `visionRadius` (already hooked).
   - Walls are added, removed, or edited (new socket events + local preview).
   - Pan/zoom changes (already hooked).

---

## Risks and Open Questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| Performance with many walls + vision sources | Medium | Cache wall segments per scene; cap ray count; profile before optimizing. |
| Floating-point leaks at wall endpoints | Medium | Cast three rays per endpoint (base ± epsilon) and include endpoint-to-endpoint checks. |
| Walls visible to players | High | Server strips `walls` from player `sceneData`; DM wall elements are never emitted via token sync. |
| Scene JSON backward compatibility | Low | `walls` is optional; legacy files load as `[]`. |
| Wall editing UX conflicts with token selection | Medium | `window.VTT_ACTIVE_WALL_TOOL` guard in `tokenTool.js`/`sceneManager.js` pointer handlers, mirroring paint mode. |
| Undo/redo scope | Medium | `SceneHistory` currently snapshots only tokens. Walls must be included in snapshots or use a separate history; recommend extending snapshots to include `walls`. |

### Open Questions

1. Should walls be included in `SceneHistory` undo/redo snapshots alongside tokens?
2. Should doors be represented as a special wall type, or deferred?
3. Should walls render beneath, above, or on a separate overlay canvas from tokens?

---

## Files Likely to Change

| File | Change |
|------|--------|
| `app.py` | Add `WallDict`; extend `SceneDict` with optional `walls`; add `addWall`, `updateWall`, `removeWall` socket events; strip walls from player `sceneData`. |
| `public/js/sceneRenderer.js` | Compute visibility polygons in `drawFog()`; accept wall list. |
| `public/js/sceneManager.js` | Manage `currentScene.walls`; wire wall socket listeners; redraw fog on wall changes. |
| `public/js/wallsTool.js` | New DM wall drawing/erasing tool. |
| `public/dm.html` | Walls tray button + floating panel markup. |
| `public/js/dmControls.js` | Toggle wiring for walls panel. |
| `public/css/dm.css` | Wall preview line/endpoint styles. |
| `tests/test_smoke.py` | Add wall CRUD and player-filtering smoke tests. |

---

## Ready for Proposal

**Yes.** The Tier 2 fog canvas provides a clear integration point, and a raycast visibility polygon is a well-understood next step. The proposal should confirm:

1. Whether wall undo/redo is included in the initial slice.
2. Whether doors/windows are deferred entirely.
3. The exact DM wall-editing interaction (drag-to-draw vs. click endpoint-to-endpoint).
