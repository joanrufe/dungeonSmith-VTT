# Apply Progress — Polygon Walls & Simplified Vision

## Goal
Refactor the fog-of-war wall system in SceneSmith-VTT from "open line segments"
to "closed polygons" so that:
- a wall is always a closed shape (the user's bug: a single line segment was
  acting like an infinite blocker);
- the visibility algorithm is a simple "circle of vision radius, with wall
  polygons re-occluded as opaque masks" instead of a buggy raycast;
- the data model + DM tool + tests all stay in sync.

## What changed

### `app.py`
- New `WallPointDict` TypedDict (`x: float, y: float`).
- `WallDict` is now `{wallId: str, points: List[WallPointDict]}`.
- `SceneStore.add_wall` / `update_wall` / `remove_wall` / `clear_walls`
  operate on the polygon shape. `update_wall` now takes a `points` list
  instead of `x1,y1,x2,y2` and deep-copies each point.
- `socket_add_wall` validates that `points` is present and deep-copies the
  point list. `socket_update_wall` reads `points` from the payload and
  forwards the full updated wall to DM clients and to players via
  `wallsData`.
- Player `sceneData` is still stripped of `walls` (same as before);
  geometry is delivered only through `wallsData`.
- `SceneHistory` snapshots already used `json.loads(json.dumps(...))`, so
  the new shape deep-copies correctly with no code change.

### `public/js/wallsTool.js` (rewrite)
- Drawing model: clicking adds a vertex; clicking near the first vertex
  (within 12px) OR double-clicking closes the polygon; `Esc` cancels.
- Minimum 3 vertices to close (fewer = cancel).
- Erase mode is unchanged (clicking a polygon removes it).
- "Clear All" is unchanged.
- Snap-to-grid still works on every vertex placement.
- Drag-on-selected-polygon translates the whole polygon (adds
  `updateWall` with the new points).
- `W` keyboard shortcut (in `dmControls.js`) is untouched.
- Hit testing: edge-distance first, point-in-polygon wins (so clicking the
  interior of a polygon selects it, not just the outline).

### `public/js/sceneRenderer.js` (rewrite of visibility)
- New `drawFog`:
  1. Paint full fog with `source-over`.
  2. For each vision source, paint a radial gradient vision circle with
     `destination-out` (soft light falloff).
  3. For every wall polygon whose bounding box overlaps a vision circle,
     paint the polygon back with the fog color (`source-over`) so the
     wall's interior is cleanly re-occluded.
- The old raycast/clip visibility-polygon code is gone:
  `_computeVisibilityPolygon`, `_circlePolygon`, `_raySegmentIntersection`
  are all deleted.
- DM SVG overlay now uses `<polygon points="...">` (not `<line>`).
- The fill is `destination-out` only — the wall interior is the absence
  of light.

### `public/js/sceneManager.js`
- `WallDict` JSDoc updated to `{wallId, points: WallPointDict[]}`.
- `updateWall` socket listener now reads `points` from the payload and
  overwrites `wall.points` (instead of `x1,y1,x2,y2`).

### `public/js/player.js`
- No change needed. It forwards `wallsData` straight to `setWalls()` and
  the new shape is compatible.

### `public/dm.html`
- Walls panel hint updated: "Click to add vertices. Click the first vertex
  (or double-click) to close. Esc cancels. Click polygon to move it.
  Delete removes selected."

### `public/css/dm.css`
- `.wall-overlay-line` updated to style a filled polygon (orange fill at
  18% alpha + 70% stroke) instead of a stroke-only line.

### `tests/test_smoke.py`
- All wall tests updated to the new `{wallId, points: [...]}` shape:
  - `test_wall_add_persists`
  - `test_player_scene_data_omits_walls_but_receives_walls_data`
  - `test_dm_scene_data_includes_walls`
  - `test_update_wall` (now sends `points`)
  - `test_remove_wall`
  - `test_clear_walls`
  - `test_wall_undo_redo`
  - `test_wall_history_preserves_tokens`
  - `test_duplicate_scene_deep_copies_walls`
- All other tests (login, scenes, sticky notes, vision radius, hidden
  tokens) are untouched.

## Test results

```
$ .venv/bin/python -m pytest tests/test_smoke.py -q
.....................                                                    [100%]
21 passed in 0.09s

$ .venv/bin/python -m py_compile app.py
py_compile OK

$ node --check public/js/wallsTool.js && \
  node --check public/js/sceneRenderer.js && \
  node --check public/js/sceneManager.js && \
  node --check public/js/player.js
All JS files OK
```

## Risks / open items
- Existing saved scenes with `x1,y1,x2,y2` walls will be **silently lost**
  on next save. Acceptable per the task: "this is a development refactor".
- A wall larger than ~6000×6000 px still incurs one full fill per vision
  source per frame; for typical room-scale walls this is fine.
- Drag-to-move-polygon emits an `updateWall` even when the user only
  clicked (no drag). This is a no-op on the server, just an extra
  socket round-trip. Not worth optimizing yet.

# Apply Progress — War Fog (Per-Scene Fog Opacity)

## Goal
Add a new DM "War Fog" tool that exposes a per-scene fog-opacity slider,
persisted with the scene and broadcast to players. Lives in its own tray
button (not inside the walls panel) so future fog-related settings have
a place to grow.

## What changed

### `app.py`
- `SceneDict` TypedDict gains `fogOpacity: float` (optional, default `1.0`).
- `SceneStore.load_scene` `setdefault`s `fogOpacity: 1.0` so legacy scenes
  load with a sensible value and the renderer never sees `undefined`.
- New `SceneStore.set_fog_opacity(scene_id, value)` clamps to `[0, 1]`,
  writes to `scene["fogOpacity"]`, and saves.
- New socket handler `@socketio.on("setFogOpacity")` (DM-only):
  - Accepts `{sceneId?, fogOpacity}` (defaults to `active_scene_id`).
  - Coerces payload to `float`; non-numeric payloads are dropped silently.
  - Clamps to `[0, 1]` via `SceneStore.set_fog_opacity`.
  - Broadcasts `fogOpacity {sceneId, fogOpacity}` to **all** rooms so the
    DM slider confirms the change and the player overlay re-renders.
- Player `sceneData` filter is unchanged: `dict(scene)` already copies
  `fogOpacity` through, and only `walls` is stripped. No extra plumbing
  needed to expose the value to players.

### `public/js/sceneRenderer.js`
- Renderer now stores `this.fogOpacity = 1.0` in the constructor.
- New `setFogOpacity(v)` clamps to `[0, 1]` and calls `drawFog()`.
- `renderScene` reads `scene.fogOpacity ?? 1` and updates
  `this.fogOpacity` before painting the fog.
- `drawFog` builds a single `fogFill = "rgba(0,0,0,${this.fogOpacity})"`
  and uses it for both the base fill and the wall re-occlusion pass
  (previously both were hardcoded to `rgba(0,0,0,1)`).

### `public/js/warFogTool.js` (new)
- Standalone IIFE class `WarFogTool` mirroring the wallsTool boot
  pattern (`document.readyState` branch in the constructor).
- UI: range slider `0..1` step `0.01`, percentage display, hint copy.
- Slider `input` is throttled to 50 ms before emitting `setFogOpacity`.
- Listens for `fogOpacity` and `sceneData` so the slider always
  reflects the active scene (covers fresh loads and live updates).
- Sets `VTT_ACTIVE_WARFOG_TOOL` via `MutationObserver` while the
  panel is open, following the existing `VTT_ACTIVE_*_TOOL` convention.

### `public/js/dmControls.js`
- New `setupPanelToggle('warfog-toggle-btn', 'warfog-panel')` and
  `makeDraggable(warfog-panel)` entries.
- New `F` keyboard shortcut that toggles the War Fog panel (mirrors
  the existing `W` shortcut for walls).

### `public/js/sceneManager.js`
- New socket listener for `fogOpacity` updates `currentScene.fogOpacity`
  on the DM side; the slider UI is owned by `warFogTool` and updated
  from its own listener.

### `public/js/player.js`
- New socket listener for `fogOpacity` updates the local `currentScene`
  and calls `sceneRenderer.setFogOpacity(v)` so the player overlay
  re-renders without a full scene reload.

### `public/dm.html`
- New tray button `#warfog-toggle-btn` with `fa-cloud` icon and `Fog`
  label, title `War Fog (F)`, placed next to the Walls button.
- New `#warfog-panel` (draggable) with the slider, percentage
  display, and a short hint copy explaining the default 100% and
  why the tool exists outside the walls panel.
- New `<script src="/js/warFogTool.js">` (after `wallsTool.js`).
- Help modal gets two new rows: `W` and `F` shortcuts.

### `public/css/dm.css`
- New `#warfog-panel { top: 50px; right: 110px; width: 230px; }`
  default position (mirrors the walls panel).
- New `.warfog-opacity-row`, `.warfog-opacity-label`,
  `.warfog-opacity-display`, `.warfog-hint` styles; slider uses
  `accent-color: #ff7a18` to match the rest of the panels.

### `openspec/specs/fog-of-war-line-of-sight/spec.md`
- New "Per-Scene Fog Opacity" requirement + scenario added to the
  compatibility block, documenting the new socket event, the
  `[0, 1]` clamp, and the player visibility.

### `tests/test_smoke.py`
Seven new tests (all pass alongside the existing 21):
- `test_fog_opacity_default_is_1` — scenes with no `fogOpacity` key
  load as `1.0` and the value reaches DM `sceneData`.
- `test_player_scene_data_includes_fog_opacity` — `fogOpacity` is
  not stripped from the player filter.
- `test_dm_set_fog_opacity_persists` — DM emit round-trips through
  the store and reappears in subsequent `loadScene` payloads.
- `test_set_fog_opacity_clamped_to_unit_range` — values above 1,
  below 0, and at the boundaries are all handled.
- `test_player_receives_fog_opacity_broadcast` — player socket
  receives the `fogOpacity` event after a DM change.
- `test_set_fog_opacity_requires_dm` — player socket is ignored.
- `test_set_fog_opacity_invalid_value_ignored` — non-numeric and
  missing-key payloads leave the scene unchanged.

## Test results

```
$ .venv/bin/python -m pytest tests/test_smoke.py -q
............................                                             [100%]
28 passed in 0.15s

$ .venv/bin/python -m py_compile app.py
py_compile OK

$ for f in public/js/*.js; do node --check "$f" || echo "FAIL: $f"; done
All JS files OK
```

## Risks / open items
- The fog-fill change makes the base fill alpha-track the new
  `fogOpacity`. A vision hole still uses `destination-out` with full
  alpha at the center, so the hole itself is fully transparent at any
  fog opacity; only the surrounding fog thins or thickens. If the DM
  ever wants a "soft vision" gradient that respects opacity, the
  stops in `_drawRadialVisionHole` would need to scale with
  `this.fogOpacity`. Not done yet.
- The DM slider is purely advisory: if a stale `fogOpacity` event
  arrives after a slider change, the slider snaps to the server value.
  The throttle window is 50 ms, so a multi-frame drag could race the
  echo; the final value always lands correct because the server is
  the source of truth and we re-sync on `sceneData`.
- Existing saved scenes with no `fogOpacity` key will be silently
  re-saved with `fogOpacity: 1.0` on first load. Idempotent and
  matches the default; no user action required.

