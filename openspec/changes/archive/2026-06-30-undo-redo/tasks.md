# Tasks: Undo/Redo for SceneSmith-VTT

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~175 |
| Files touched | 4 (`app.py`, `public/dm.html`, `public/js/sceneManager.js`, `public/js/dmControls.js`) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR, 3 work-unit commits |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Commit | Notes |
|------|------|--------|-------|
| 1 | `SceneHistory` + hooks + `remove_token` mod | 1 | Server foundation; standalone |
| 2 | Undo/redo handlers + broadcast + state emits | 2 | Server runtime; depends on Unit 1 |
| 3 | Frontend buttons/shortcuts/listeners | 3 | Client wiring; depends on Unit 2 |

## Phase 1: Foundation — SceneHistory class

- [x] 1.1 Add `import threading` to `app.py` after line 7
- [x] 1.2 Create `SceneHistory` class after `SceneStore` (line 235): `MAX_DEPTH=50`, `COALESCE_WINDOW_MS=300`, `__init__(store)` with `_lock`/`_scenes={}`; `_ensure_scene` (lazily create `{undo:[],redo:[],pending:None}`); `_sweep_all_locked` (finalize expired pending)
- [x] 1.3 Implement `before_mutation(scene_id)` (lock: sweep, coalesce within 300ms or finalize+start new pending with `json`-deep-copied before-snapshot) and `record_pending_deletion(scene_id, url)` (append to `pending["deleted_image_urls"]`)
- [x] 1.4 Implement `_finalize_pending_locked` (purge redo-stack urls, push pending onto undo, clear redo, evict if >50) and `_evict_oldest_locked` (`undo.pop(0)`, purge urls via `store.delete_upload_if_unused`)
- [x] 1.5 Implement `undo`/`redo`/`state` public methods (per design.md); instantiate `history = SceneHistory(scene_store)` after line 238

## Phase 2: Capture hooks + remove_token modification

- [x] 2.1 `SceneStore.remove_token` (app.py:233): drop the `delete_upload_if_unused` call; keep `return removed`
- [x] 2.2 `socket_update_token` (793): insert `if is_dm_socket(): history.before_mutation(scene_id)` before `scene_store.update_token`; player path (788-792) bypasses
- [x] 2.3 `socket_add_token` (815) and `socket_add_token_from_library` (935): insert `history.before_mutation(scene_id)` before each `scene_store.add_token`
- [x] 2.4 `socket_remove_token` (825): `history.before_mutation` before `scene_store.remove_token`; after, call `history.record_pending_deletion(scene_id, removed.get("imageUrl"))`

## Phase 3: Undo/redo handlers + broadcast

- [x] 3.1 Add module helper `_apply_snapshot_and_broadcast(scene_id, snapshot)`: replace tokens, `save_scene`, emit `sceneData` to `dm` + hidden-filtered to `player` (mirror `socket_load_scene` 758-767), emit `undoRedoState` to `dm`
- [x] 3.2 Add `@socketio.on("undo")` and `@socketio.on("redo")` handlers: DM-only, target `scene_store.active_scene_id`, call `history.undo`/`redo`, no-op if None, else broadcast via helper
- [x] 3.3 After each DM mutation (2.2-2.4), emit `undoRedoState {canUndo,canRedo}` to `dm` via `history.state(scene_id)`

## Phase 4: Frontend (additive only)

- [x] 4.1 Add 2 `tray-btn` (`#undo-btn` `fa-rotate-left`, `#redo-btn` `fa-rotate-right`) at top of `#dm-tool-tray` in `public/dm.html` (line 107), both `disabled`
- [x] 4.2 Add 2 help rows (`Ctrl+Z`, `Ctrl+Shift+Z`) to keyboard table in `public/dm.html` (after line 91)
- [x] 4.3 Add `Ctrl+Z`/`Ctrl+Shift+Z` branches in `sceneManager.js:onKeyDown` (after line 399): `preventDefault` + `socket.emit('undo'/'redo',{sceneId})` guarded by `this.currentScene`
- [x] 4.4 Add undo/redo click handlers + `socket.on('undoRedoState')` listener in `public/js/dmControls.js` (after line 120), toggling `disabled`

## Phase 5: Verification

- [x] 5.1 `python -m py_compile app.py` MUST pass (only quality gate)
- [x] 5.2 No existing payload shape altered; `sceneData` listener (sceneManager.js:31) unchanged — parity preserved
- [x] 5.3 Spec scenarios: multi-token drag = one step; undo-of-delete restores image, eviction purges; new mutation clears redo; initiative untouched
