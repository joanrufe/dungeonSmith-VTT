# Proposal: Fog of War – Tier 2 (Vision Radius)

## Intent

Give player tokens a configurable vision radius so the player view is masked by fog everywhere except within that radius. The DM continues to see the entire scene. This is the first slice of fog-of-war; walls, line-of-sight, and per-player individualized fog are deferred to later tiers.

## Scope

### In Scope
- Optional `visionRadius` token property (world pixels; `0` = no vision source).
- Optional `isMap` boolean token property to mark the background map token.
- Canvas-based fog overlay on the player page only, above all tokens.
- DM UI to set `visionRadius` on selected tokens.
- Persistence through existing `updateToken` Socket.IO flow and scene JSON.
- Undo/redo compatibility via existing `SceneHistory` token snapshots.
- Pytest smoke tests for any new endpoints; existing smoke tests must still pass.

### Out of Scope
- Wall or line-of-sight occlusion (Tier 3).
- Per-player individualized fog; the player view is the union of all vision sources.
- DM "Preview Fog" toggle (future nice-to-have, not Tier 2).
- Fog reveal state beyond what is stored in scene JSON.
- Server-side geometry or new Socket.IO events.

## Capabilities

### New Capabilities
- `fog-of-war-tier2`: Player vision-radius fog rendering and DM vision-radius controls.

### Modified Capabilities
- None. `scene-history` snapshots token properties unchanged, so the new fields inherit undo/redo behavior automatically.

## Approach

Add a single `<canvas>` overlay inside `SceneRenderer` when `isDM === false`. On each render cycle, fill the canvas with dark fog and use `destination-out` radial gradients to punch vision holes centered at each non-hidden token with `visionRadius > 0`. The canvas follows pan/zoom via the same CSS transform already used by the grid canvas.

`visionRadius` and `isMap` travel as ordinary token properties through the existing `updateToken` event, so no new Socket.IO events or schema migration are needed.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app.py` | Modified | Add `visionRadius` and `isMap` to `TokenDict` type hints only; runtime behavior stays backward-compatible. |
| `public/js/sceneRenderer.js` | Modified | Build and sync fog canvas; redraw it on every `updateAllTokenElements`. |
| `public/js/sceneManager.js` | Modified | Extend `TokenDict` JSDoc with `visionRadius` and `isMap`. |
| `public/dm.html` | Modified | Add vision radius input to Token Status popup. |
| `public/js/tokenTool.js` | Modified | Read and emit `visionRadius` on token status apply. |
| `data/scenes/*.json` | No migration | New optional fields written by existing update flow. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Performance with many vision sources | Low | Canvas 2d radial gradients are fast for typical token counts; profile before optimizing. |
| Fog canvas misaligned after window resize | Medium | Use `ResizeObserver` on `#scene-container` to recreate the canvas. |
| Map/paint/area-effect tokens treated as vision sources | Low | Exclude `isMap`, `isPaintTile`, and `isAreaEffect` from vision-source iteration. |
| UI unit confusion (pixels vs grid cells) | Medium | Expose input in grid cells and convert to world pixels using `VTT_GRID_SIZE`. |

## Rollback Plan

Revert the changed frontend files and the two `TokenDict` lines in `app.py`. The fog overlay disappears; any `visionRadius`/`isMap` values in scene JSON are ignored by older clients.

## Dependencies

None.

## Success Criteria

- [ ] Player page shows dark fog with clear circular holes around tokens with `visionRadius > 0`.
- [ ] DM page remains unmasked by default.
- [ ] DM can set and update `visionRadius` from the Token Status popup.
- [ ] `visionRadius` and `isMap` persist across server restart via scene JSON.
- [ ] Undo/redo of a vision-radius change reverts/restores the value.
- [ ] Any new endpoints have pytest smoke tests; existing smoke tests still pass.
