# Proposal: Undo/Redo for SceneSmith-VTT

## Intent

DMs cannot correct mistakes. A mis-drag, accidental delete, or wrong rotation is permanent and
broadcast to players instantly. There is no way back. This change adds server-side undo/redo of
**all token-property mutations** in the active scene, so a DM can revert the last gesture (single
or multi-token) and redo it, with every client seeing the snap-back in real time.

Full pre-agreed scope lives in `exploration.md`; this proposal operationalizes it.

## Scope

### In Scope
- Server-side Memento (state snapshots), **not** Command pattern.
- One history per scene, keyed by `sceneId`, **in-memory only** (lost on server restart —
  acceptable for trusted LAN). Max depth **50**, FIFO discard.
- Snapshot = deep copy of `scene["tokens"]` (the only part these mutations touch) taken
  **before** each DM-initiated `update_token` / `add_token` / `remove_token` / `addTokenFromLibrary`.
- All token properties are undoable: position, create/delete, rotation, layer, hide/lock,
  width/height, HP, color, effectType, movableByPlayers, add-from-library, **plus** resize,
  HP/condition status, paint tiles, and area effects (all are tokens). No property filtering.
- **Single DM only.** History is global per-scene (not per-socket). Capture at the socket-handler
  level (the only place that knows the actor via `is_dm_socket()`), not inside `SceneStore`.
- **Scene-level ~300 ms inactivity-window coalescing**, no frontend drag-end event. One full token
  drag (single or multi-token), one multi-token delete, one resize gesture = **one history step**.
- **Deferred upload deletion**: `remove_token` does NOT delete the upload file immediately; the
  file is deleted only when the owning snapshot leaves the 50-deep FIFO. Undo of a delete restores a
  valid image. Undo of an add only removes the token reference, never the upload.
- Standard redo semantics: any new mutation after an undo clears the redo stack.
- Undo/redo reverts **player-initiated token moves too** (they are part of the restored snapshot);
  initiative is NOT reverted (out of scope).
- Trigger: Ctrl+Z / Ctrl+Shift+Z (DM side) + two visible buttons in the DM tool tray.
- On undo/redo, server restores snapshot and emits full `sceneData` (full to `dm` room,
  hidden-filtered to `player` room) — same path as `socket_load_scene` → no client rebuild changes.
- Additive `undoRedoState { canUndo, canRedo }` event after each mutation/undo/redo to grey out
  buttons when the stack is empty in that direction.
- Frontend changes are **additive only**: 2 tray buttons + 2 help-modal rows in `dm.html`, 2
  keydown branches in `sceneManager.js`, 2 click handlers in `dmControls.js`. The existing
  `sceneData` listener is reused unchanged (frontend parity preserved).

### Out of Scope (deferred / non-goals)
- Music, DM sticky notes, initiative, grid toggle, background color.
- Scene create/delete/duplicate/reorder.
- Persisting history to disk (lost on restart by design).
- Per-player or per-socket history; multi-DM undo.
- `mutationBatchEnd` pointerup frontend event (≤300 ms idle timeout makes it unnecessary for v1).
- Reverting initiative on undo.
- Editing the deprecated Node backend (zero runtime effect).

## Capabilities

> No `openspec/specs/` exist yet — all capabilities are NEW.

### New Capabilities
- `scene-history`: Server-side undo/redo of token-property mutations for the active scene —
  capture, coalescing, FIFO depth limit, deferred upload deletion, undo/redo handlers, and the
  additive `undoRedoState` event.

### Modified Capabilities
- None (no existing specs to delta).

## Approach

Introduce a `SceneHistory` helper **inside `app.py`** (monolith by design; no controllers/services
split). It owns a per-`sceneId` undo stack (max 50, FIFO) and redo stack, plus a per-scene
`pending { before_snapshot, last_touch_ms }` entry for coalescing. All state guarded by a single
`threading.Lock` (`async_mode="threading"`).

**Capture**: in the four DM handlers — `socket_update_token` (781), `socket_add_token` (810),
`socket_remove_token` (820), `socket_add_token_from_library` (916) — call
`history.before_mutation(scene_id)` immediately before the `SceneStore` mutation. That call
either starts/coalesces the `pending` (within 300 ms of the last touch) or finalizes an expired
pending onto the undo stack (clearing the redo stack) and starts a new one. A lazy sweep on each
incoming mutation finalizes any expired pending so Ctrl+Z works shortly after the gesture ends.
Player `{x,y}` moves (non-DM sockets) skip capture entirely.

**Undo/redo**: two new socket handlers replace `scene["tokens"]` with the popped snapshot,
`save_scene`, and emit `sceneData` (full to `dm`, hidden-filtered to `player`) plus
`undoRedoState`. A payload `sceneId` ≠ active-scene mismatch is flagged and undo still targets the
active scene (per "global per-scene").

**Upload lifecycle**: `remove_token` stops calling `delete_upload_if_unused` immediately; the
deleted token's `imageUrl` is recorded with the snapshot and the file is purged when that step is
evicted (or on explicit purge, deferred). Undo of `addToken` removes only the token reference.

**Frontend** (additive): 2 one-shot `tray-btn`s in `#dm-tool-tray` (`dm.html`), click handlers in
`dmControls.js`, 2 Ctrl+Z / Ctrl+Shift+Z branches in `sceneManager.js:onKeyDown` (guarded by the
existing INPUT/TEXTAREA focus check), 2 rows in the help modal, and a small `undoRedoState`
listener that toggles `disabled` on the buttons.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app.py` | Modified | New `SceneHistory` helper; capture hooks in 4 handlers; `undo`/`redo` handlers; `remove_token` upload-deletion timing change; emit `sceneData` + `undoRedoState` |
| `app.py:199` (`delete_upload_if_unused`) | Modified | Called on FIFO eviction instead of inside `remove_token` |
| `public/dm.html` | Modified | 2 `tray-btn` buttons in `#dm-tool-tray`; 2 help-modal rows |
| `public/js/sceneManager.js` | Modified | Ctrl+Z / Ctrl+Shift+Z branches in `onKeyDown` (384) |
| `public/js/dmControls.js` | Modified | Click handlers for undo/redo buttons (~120) |
| `public/js/tokenTool.js` | Unchanged | No drag-end event needed |
| `public/js/sceneRenderer.js`, `tokenManager.js` | Unchanged | Existing `sceneData` rebuild path reused |
| Deprecated Node files | Unchanged | Zero runtime effect |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Memory growth from 50 deep snapshots × multiple scenes | Med | FIFO 50 cap; keep history for active scene + small LRU; snapshot is only the `tokens` list (KB-scale). Acceptable for trusted LAN |
| Thread races on history dict / coalescing timestamp (`async_mode="threading"`) | High | Single `threading.Lock` around all `SceneHistory` state; finalize sweep runs under lock |
| Undo of a delete shows a broken image (upload already deleted) | Med → eliminated | Deferred upload deletion: file deleted only when its snapshot is evicted from FIFO |
| Two distinct DM actions within ~300 ms merge into one undo step | Low | Acceptable for single-DM v1; tunable window; `mutationBatchEnd` deferred as future enhancement |
| Cross-scene undo confusion (payload `sceneId` ≠ active) | Low | Capture under payload `sceneId`; undo always targets active scene; flag mismatch in response |
| Player moves lost on DM undo | Intended | By design — undo restores the snapshot that already reflects prior player moves |
| New `undoRedoState` event breaks frontend parity | Low | It is additive, never alters existing payload shapes |

## Rollback Plan

The change is **additive**: no schema migration, no persisted state, no DB column. To revert:
1. Remove the 2 `tray-btn` buttons + 2 help rows from `public/dm.html`.
2. Revert the 2 keydown branches in `public/js/sceneManager.js`.
3. Revert the 2 click handlers + `undoRedoState` listener in `public/js/dmControls.js`.
4. In `app.py`, remove the `SceneHistory` class, the `history.before_mutation(...)` calls in the 4
   handlers, the `undo`/`redo` handlers, and restore the immediate `delete_upload_if_unused`
   call inside `remove_token`.
5. Restart `app.py` — history (in-memory only) is gone; no file repair needed.

None of these steps touch `data/scenes/*.json` (schema unchanged) or any existing event payload.
A bare `git revert` of the change commit accomplishes all of the above.

## Dependencies

- None external. Uses only stdlib (`threading`, `json`, `time`, `copy`) already imported by `app.py`.

## Success Criteria

- [ ] DM can Ctrl+Z a single-token drag and the token snaps back to its pre-drag position across all
      clients (DM + players).
- [ ] A multi-token selection drag (≥2 tokens) is ONE undo step: one Ctrl+Z reverts all of them.
- [ ] A multi-token selection delete is ONE undo step: one Ctrl+Z restores every removed token,
      images intact (deferred upload deletion working).
- [ ] Ctrl+Shift+Z redoes an undone step; a fresh mutation after undo clears the redo stack.
- [ ] Undo buttons grey out when no undo/redo is available (driven by `undoRedoState`).
- [ ] History is lost on `app.py` restart (by design) and no `data/scenes/*.json` schema changes.
- [ ] `python -m py_compile app.py` passes; no existing `sceneData` payload shape altered.
- [ ] Player `{x,y}` moves bypass capture (DM undo never targets a lone player move).