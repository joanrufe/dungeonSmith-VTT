# Proposal: Fog of War – Line of Sight & Walls

## Intent

Extend Tier 2 radial fog with invisible wall segments that block player line of sight. The DM draws walls on the scene; players see only the visibility polygon reachable from each vision source, clipped by those walls.

## Scope

### In Scope
- Basic line-segment walls: DM draw, edit (move endpoints), and delete.
- Walls persist in `data/scenes/{sceneId}.json` and sync through Socket.IO.
- Server strips `walls` from player `sceneData` payloads; players never receive wall geometry.
- Player fog renders visibility polygons bounded by walls and each token's `visionRadius`.
- DM wall drawing tool: tray button, floating panel, draw/erase modes, snap-to-grid, DM-only overlay.
- Walls participate in `SceneHistory` snapshots so undo/redo reverts wall changes.
- Extend pytest smoke tests for wall CRUD and player payload filtering.

### Out of Scope
- Doors, windows, or special wall types.
- Dynamic lighting colors, height, elevation, or cover rules.
- Diagonal/curved walls beyond straight line segments.
- Per-player individualized fog or fog-reveal persistence across sessions.
- Server-side visibility computation.

### Constraints
- Preserve all existing Socket.IO event and HTTP response payload shapes.
- Do not break the existing `public/js` architecture or frontend-parity constraints.
- `app.py` stays monolithic; no controllers/services split.
- `walls` array is optional; legacy scenes load as `[]` without migration.

## Capabilities

### New Capabilities
- `wall-management`: DM-only creation, editing, deletion, snapping, and visibility toggle of wall segments.
- `line-of-sight-visibility`: Client-side visibility polygon computation that clips player fog by walls.

### Modified Capabilities
- `fog-of-war-tier2`: Player fog holes SHALL become wall-aware visibility polygons instead of unobstructed radial circles.
- `scene-history`: Snapshots SHALL include the scene `walls` array so wall mutations are undoable/redoable alongside token mutations.

## Approach

Use the raycast visibility polygon approach (Approach A from exploration). The server stores only line-segment wall data; all occlusion math runs on the player client inside the existing fog canvas. For each vision source, cast rays toward every wall endpoint (plus small angular offsets), intersect each ray with all walls, and clear the nearest-hit polygon using `destination-out` compositing. This reuses the Tier 2 canvas pipeline with minimal conceptual change.

DM interaction follows the `paintMode.js` pattern: a tray button opens a floating panel, `window.VTT_ACTIVE_WALL_TOOL` guards pointer handlers, click-drag draws a segment, and erase mode/right-click removes nearby walls. Walls render as faint DM-only overlays on a separate canvas or SVG overlay.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app.py` | Modified | Add `WallDict`; extend `SceneDict` with optional `walls`; add `addWall`/`updateWall`/`removeWall` events; strip `walls` from player `sceneData`. |
| `public/js/sceneRenderer.js` | Modified | Compute wall-aware visibility polygons in `drawFog()`; keep existing fog canvas lifecycle. |
| `public/js/sceneManager.js` | Modified | Track `currentScene.walls`; wire wall socket listeners; redraw fog on wall changes. |
| `public/js/wallsTool.js` | New | DM wall drawing/erasing tool, snap-to-grid, preview, delete. |
| `public/dm.html` | Modified | Walls tray button + floating panel markup. |
| `public/js/dmControls.js` | Modified | Panel toggle wiring. |
| `public/css/dm.css` | Modified | Wall preview line/endpoint styles. |
| `tests/test_smoke.py` | Modified | Wall CRUD and player wall-filtering smoke tests. |
| `data/scenes/*.json` | No migration | New optional `walls` array written by existing save flow. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Performance with many walls + vision sources | Medium | Cache wall arrays; cap rays per source; profile before optimizing. |
| Floating-point slivers at wall endpoints | Medium | Cast three rays per endpoint (`base ± epsilon`) and include endpoint checks. |
| Walls accidentally visible to players | High | Server strips `walls` from player payloads; DM overlay never emitted via token sync. |
| Wall editing conflicts with token selection | Medium | Use `window.VTT_ACTIVE_WALL_TOOL` guard mirroring paint mode. |
| SceneHistory snapshot size growth | Low | Walls are small JSON arrays; snapshots remain in-memory only. |

## Rollback Plan

Revert `app.py` and the changed `public/js/*`, `public/dm.html`, and `public/css/dm.css` files. Remove `walls` arrays from scene JSON or leave them ignored by the reverted client. The fog canvas reverts to unobstructed radial vision holes.

## Dependencies

- Tier 2 fog canvas (`fog-of-war-tier2`) must be in place.

## Success Criteria

- [ ] DM can draw, snap, move endpoints, delete, and toggle visibility of wall segments.
- [ ] Walls persist across server restart in scene JSON and sync to other DM clients.
- [ ] Player `sceneData` never contains `walls`; players cannot see wall geometry or overlays.
- [ ] Player fog reveals only visibility polygons bounded by walls and `visionRadius`.
- [ ] Undo/redo of wall changes reverts/restores walls alongside tokens.
- [ ] Existing Socket.IO and HTTP payload shapes remain unchanged.
- [ ] New wall CRUD and player-filtering smoke tests pass; existing tests still pass.
