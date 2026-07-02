# Archive Report: Fog of War – Line of Sight & Walls

**Change**: fog-of-war-line-of-sight  
**Domain**: fog-of-war-line-of-sight  
**Archived**: 2026-07-02  
**Final Status**: Completed  
**Verdict**: PASS WITH WARNINGS

## Change Summary

Extended Tier 2 radial fog with invisible line-segment walls that block player line of sight. The DM can draw, edit, move endpoints, delete, and clear walls through a dedicated wall tool. Walls persist in scene JSON, participate in undo/redo history, and are stripped from player `sceneData` payloads. Player fog now renders wall-aware visibility polygons computed on the client from each token's `visionRadius` and the separate `wallsData` event.

## Key Decisions Made

- **Wall storage**: Inline `walls: WallDict[]` array inside each scene JSON, reusing the existing `SceneStore` lifecycle and duplication flow.
- **Wall synchronization**: New additive Socket.IO events (`addWall`, `updateWall`, `removeWall`, `clearWalls`) that mutate the scene, snapshot history, save, and broadcast only to the DM room.
- **Line-of-sight computation**: Performed on the player client via raycast visibility polygons cast at wall endpoints ±ε, avoiding server-side geometry exposure through `sceneData`.
- **Wall delivery to players**: Separate `wallsData` event sent on player `loadScene` and after wall mutations; `sceneData` payload contract remains unchanged and wall-free for players.
- **DM wall rendering**: SVG overlay rendered by `SceneRenderer.renderWallsOverlay`, surviving DOM wipes and visible only to DMs.
- **Snap-to-grid**: Walls snap to the grid on endpoint drag release, matching token placement UX.
- **History integration**: `SceneHistory` snapshots and restores both `tokens` and `walls`, making wall mutations undoable/redoable alongside token changes.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `app.py` | Modified | Added `WallDict`; extended `SceneDict` with optional `walls`; added DM-only wall CRUD Socket.IO handlers; stripped `walls` from player `sceneData`; emitted `wallsData` to players; extended history snapshots/undo/redo to include walls. |
| `public/js/wallsTool.js` | Created | DM wall drawing/erasing tool: tray button, floating panel, draw/erase modes, snap-to-grid, preview line, endpoint select/move, individual delete, and Clear All. |
| `public/js/sceneRenderer.js` | Modified | DM-only SVG wall overlay; ray-segment intersection helper; player `drawFog()` computes wall-aware visibility polygons. |
| `public/js/sceneManager.js` | Modified | Tracks `currentScene.walls`; handles `wallsData` and wall delta socket events; redraws overlay/fog on wall changes. |
| `public/dm.html` | Modified | Added Walls tray button and floating panel; included `wallsTool.js`. |
| `public/js/dmControls.js` | Modified | Wired wall panel toggle and `W`/`Esc` shortcuts. |
| `public/css/dm.css` | Modified | Added wall preview line, selected endpoint, and overlay styles. |
| `tests/test_smoke.py` | Modified | Added wall CRUD, payload filtering, history/undo/redo, `updateWall`, `clearWalls`, and scene duplication smoke tests. |

## Test Results

- **Build**: ✅ Passed — `python -m py_compile app.py` (`PY_COMPILE_OK`)
- **Smoke tests**: ✅ 21 passed / 0 failed / 0 skipped
- **Static frontend syntax check**: ✅ Passed — `node --check` on `wallsTool.js`, `sceneRenderer.js`, `sceneManager.js`, `player.js`, `dmControls.js`
- **Coverage**: Not configured

## Spec Compliance Summary

9/12 scenarios verified as compliant. 3 visual/canvas LOS scenarios are implemented but rely on manual/code-inspection verification:

- DM draws a wall (visual interaction, no automated UI test)
- Wall blocks sight (canvas visibility polygon, no automated test)
- Wall-aware vision / player fog overlay (canvas compositing, no automated test)

No CRITICAL issues were found in verification.

## Known Limitations

- **Visual LOS not automated**: The actual canvas line-of-sight and fog-overlay behavior has no automated test coverage. Verification is by code inspection and requires manual browser testing.
- **Wall geometry reaches players via `wallsData`**: This is an intentional design tradeoff to keep LOS computation client-side while preserving the `sceneData` contract. Absolute wall secrecy would require moving LOS computation server-side.
- **No migration required but no migration performed**: `walls` is optional; legacy scenes load as `[]` without conversion.

## Follow-up Work

| Item | Priority | Action |
|------|----------|--------|
| LOS automated coverage | Medium | Add a Playwright E2E or headless canvas-pixel test that places a wall between a vision token and a point and asserts the point remains fogged. |
| JS unit tests for LOS math | Medium | Add `tests/test_los.js` exercising `_raySegmentIntersection` and `_computeVisibilityPolygon` with simple wall configurations. |
| Help modal docs | Low | Document the `W` shortcut, draw/erase modes, and Delete behavior in `#help-modal` of `public/dm.html`. |

## Spec Promotion

The delta spec has been promoted to the main spec source of truth:

- `openspec/specs/fog-of-war-line-of-sight/spec.md`

## Audit Trail

This change was planned, implemented, verified, and archived through the full SDD cycle:

- `exploration.md`
- `proposal.md`
- `specs/fog-of-war-line-of-sight/spec.md`
- `design.md`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- `archive-report.md` (this file)

All 21 implementation tasks are marked complete.
