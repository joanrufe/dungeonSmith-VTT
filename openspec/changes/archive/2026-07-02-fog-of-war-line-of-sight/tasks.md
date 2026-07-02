# Tasks: Fog of War – Line of Sight & Walls

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800–1,000 |
| 400-line budget risk | High |
| 1,200-line project budget risk | Low |
| Chained PRs recommended | Yes |
| Suggested split | PR1 backend+history+tests; PR2 DM wall tool+UI; PR3 player LOS+DM overlay |
| Delivery strategy | single-pr-default |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Server wall schema, CRUD, history, filtering, tests | PR 1 | base: main |
| 2 | DM wall drawing/editing tool and UI wiring | PR 2 | depends on PR 1 |
| 3 | DM wall overlay and player visibility polygons | PR 3 | depends on PR 1/2 |

## Phase 1: Backend foundation

- [x] 1.1 Add `WallDict` TypedDict and optional `walls: List[WallDict]` to `SceneDict` in `app.py`.
- [x] 1.2 Default missing `walls` to `[]` in `SceneStore.load_scene`.
- [x] 1.3 Add `addWall`, `updateWall`, `removeWall`, `clearWalls` Socket.IO handlers in `app.py` (DM-only, snapshot, save, broadcast to DM room).
- [x] 1.4 Strip `walls` from player payloads in `socket_load_scene`; emit `wallsData` to players.
- [x] 1.5 Extend `SceneHistory` snapshots and undo/redo to include `walls`; update `_apply_snapshot_and_broadcast`.
- [x] 1.6 Ensure `duplicateScene` deep-copies `walls`.

## Phase 2: DM wall tool & UI

- [x] 2.1 Add Walls tray button and floating panel to `public/dm.html`; include `public/js/wallsTool.js`.
- [x] 2.2 Wire panel toggle and `W`/`Esc` shortcuts in `public/js/dmControls.js`.
- [x] 2.3 Create `public/js/wallsTool.js`: draw mode, erase mode, snap-to-grid, preview line, emit `addWall`.
- [x] 2.4 Add endpoint select/move and individual wall delete in `public/js/wallsTool.js`.
- [x] 2.5 Add Clear All button and emit `clearWalls` in `public/js/wallsTool.js`.
- [x] 2.6 Add wall preview/selected endpoint styles in `public/css/dm.css`.

## Phase 3: Rendering & LOS

- [x] 3.1 Add DM-only SVG wall overlay to `public/js/sceneRenderer.js`.
- [x] 3.2 Add ray-segment intersection helper in `public/js/sceneRenderer.js`.
- [x] 3.3 Compute wall-aware visibility polygons in `drawFog()` for players (cast rays at endpoints ±ε).
- [x] 3.4 Cache walls in renderer and redraw fog when walls/tokens change.
- [x] 3.5 Handle `wallsData` and wall delta socket events in `public/js/sceneManager.js`; keep `currentScene.walls` updated.

## Phase 4: Testing & verification

- [x] 4.1 Add pytest smoke tests for wall CRUD and persistence in `tests/test_smoke.py`.
- [x] 4.2 Add smoke tests verifying player `sceneData` omits `walls` and DM `sceneData` includes them.
- [x] 4.3 Add smoke tests for wall undo/redo, `updateWall`, and `clearWalls`.
- [x] 4.4 Run `python -m py_compile app.py` and pytest; fix regressions.
