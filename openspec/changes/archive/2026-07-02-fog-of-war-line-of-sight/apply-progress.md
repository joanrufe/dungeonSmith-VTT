# Apply Progress: Fog of War – Line of Sight & Walls

**Change**: fog-of-war-line-of-sight  
**Mode**: Standard (strict_tdd not active)  
**Status**: All tasks complete. Ready for verify.

## Completed Tasks

### Phase 1: Backend foundation
- [x] 1.1 Add `WallDict` TypedDict and optional `walls: List[WallDict]` to `SceneDict` in `app.py`.
- [x] 1.2 Default missing `walls` to `[]` in `SceneStore.load_scene`.
- [x] 1.3 Add `addWall`, `updateWall`, `removeWall`, `clearWalls` Socket.IO handlers in `app.py` (DM-only, snapshot, save, broadcast to DM room).
- [x] 1.4 Strip `walls` from player payloads in `socket_load_scene`; emit `wallsData` to players.
- [x] 1.5 Extend `SceneHistory` snapshots and undo/redo to include `walls`; update `_apply_snapshot_and_broadcast`.
- [x] 1.6 Ensure `duplicateScene` deep-copies `walls`.

### Phase 2: DM wall tool & UI
- [x] 2.1 Add Walls tray button and floating panel to `public/dm.html`; include `public/js/wallsTool.js`.
- [x] 2.2 Wire panel toggle and `W`/`Esc` shortcuts in `public/js/dmControls.js`.
- [x] 2.3 Create `public/js/wallsTool.js`: draw mode, erase mode, snap-to-grid, preview line, emit `addWall`.
- [x] 2.4 Add endpoint select/move and individual wall delete in `public/js/wallsTool.js`.
- [x] 2.5 Add Clear All button and emit `clearWalls` in `public/js/wallsTool.js`.
- [x] 2.6 Add wall preview/selected endpoint styles in `public/css/dm.css`.

### Phase 3: Rendering & LOS
- [x] 3.1 Add DM-only SVG wall overlay to `public/js/sceneRenderer.js`.
- [x] 3.2 Add ray-segment intersection helper in `public/js/sceneRenderer.js`.
- [x] 3.3 Compute wall-aware visibility polygons in `drawFog()` for players (cast rays at endpoints ±ε).
- [x] 3.4 Cache walls in renderer and redraw fog when walls/tokens change.
- [x] 3.5 Handle `wallsData` and wall delta socket events in `public/js/sceneManager.js`; keep `currentScene.walls` updated.

### Phase 4: Testing & verification
- [x] 4.1 Add pytest smoke tests for wall CRUD and persistence in `tests/test_smoke.py`.
- [x] 4.2 Add smoke tests verifying player `sceneData` omits `walls` and DM `sceneData` includes them.
- [x] 4.3 Add smoke tests for wall undo/redo, `updateWall`, and `clearWalls`.
- [x] 4.4 Run `python -m py_compile app.py` and pytest; fix regressions.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `app.py` | Modified | Added `WallDict`/`SceneDict.walls`; wall CRUD handlers; player payload filtering; `wallsData` emit; `SceneHistory` includes walls; `duplicateScene` deep-copies walls. |
| `public/dm.html` | Modified | Added Walls tray button, floating Walls panel, and `wallsTool.js` script include. |
| `public/js/dmControls.js` | Modified | Wired Walls panel toggle/draggable and `W` shortcut. |
| `public/js/wallsTool.js` | Created | DM wall tool: draw/erase/snap-to-grid, preview line, endpoint select/move, individual delete, Clear All. |
| `public/js/sceneRenderer.js` | Modified | DM SVG wall overlay; ray-segment intersection; wall-aware visibility polygons in `drawFog()`. |
| `public/js/sceneManager.js` | Modified | Tracks `currentScene.walls`; handles `addWall`/`updateWall`/`removeWall`/`clearWalls`/`wallsData` socket events. |
| `public/js/player.js` | Modified | Listens for `wallsData` and feeds wall geometry to the renderer for LOS. |
| `public/css/dm.css` | Modified | Styles for Walls panel, overlay lines, preview line, and endpoint handles. |
| `tests/test_smoke.py` | Modified | Added wall CRUD, payload filtering, undo/redo, duplicate, and history isolation smoke tests. |
| `openspec/changes/fog-of-war-line-of-sight/tasks.md` | Modified | Marked all tasks `[x]`. |

## Deviations from Design

None — implementation matches the design. One minor frontend choice: player `wallsData` is also consumed by `sceneManager.js` for completeness, but the primary player path is `player.js`.

## Issues Found

None.

## Verification

```text
python -m py_compile app.py   # OK
.venv/bin/pytest -q           # 21 passed
```

## Workload / PR Boundary

- Mode: single PR (size within the 1,200-line project budget; explicit `single-pr-default` decision recorded in session context)
- Current work unit: Full change (all phases)
- Boundary: Implements backend, DM tool, player LOS, and tests end-to-end
- Estimated review budget impact: ~850–1,000 changed lines, within the 1,200-line budget

## Remaining Tasks

None. Ready for `sdd-verify`.
