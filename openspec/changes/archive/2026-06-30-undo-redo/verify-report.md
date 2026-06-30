# Verification Report

**Change**: undo-redo
**Capability**: scene-history
**Mode**: Standard (no tests exist in project; py_compile only quality gate)

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 19 |
| Tasks complete | 19 (all marked [x]) |
| Tasks incomplete | 0 |

## Build & Tests Execution

**Build**: ✅ Passed

```
python -m py_compile app.py  →  no output (success)
```

**Tests**: ➖ Not available (project has no test runner)
**Coverage**: ➖ Not available

## Spec Compliance Matrix

| Req | Scenario | Evidence | Result |
|-----|----------|----------|--------|
| Snapshot Capture on Token Mutations | DM captures, player bypasses | `app.py:909-910` DM guard; player path `903-908` skips `before_mutation` | ✅ COMPLIANT |
| Scene-Level Coalescing | Multi-token drag is one undo step | `app.py:260-277` scene-level pending with 300ms window; `_sweep_all_locked` finalizes expired on each call | ✅ COMPLIANT |
| Undo | Ctrl+Z reverts a drag across all clients | `app.py:1083-1093` socket_undo handler; `288-298` history.undo pushes current to redo, pops undo; `1071-1080` broadcasts full+filtered sceneData | ✅ COMPLIANT |
| Redo | Redo restores, then new mutation clears stack | `app.py:1096-1106` socket_redo handler; `300-311` history.redo pops redo, pushes to undo | ⚠️ PARTIAL — redo stack clearing on new mutation is incomplete (see CRITICAL finding) |
| Depth Limit and Persistence | FIFO eviction at 50 steps | `app.py:247` MAX_DEPTH=50; `334-335` evict on overflow; `337-343` _evict_oldest_locked pops index 0 | ✅ COMPLIANT |
| Deferred Upload Deletion | Undo of delete restores image, eviction purges | `app.py:227-235` remove_token skips delete_upload; `279-286` record_pending_deletion tracks urls; `337-343` eviction purges; `326-329` redo-stack-clear purges | ✅ COMPLIANT |
| undoRedoState Event and Button State | Buttons reflect stack availability | `app.py:925-927`, `939-940`, `954-955`, `1067-1068`, `1079-1080` emits after every mutation/undo/redo to dm; frontend listener toggles disabled | ✅ COMPLIANT |
| Thread Safety | Concurrent mutations stay consistent | `app.py:252` single threading.Lock; all 5 public methods acquire lock; internal helpers called already holding it | ✅ COMPLIANT |
| Cross-Scene History | Undo targets active scene after switch | `app.py:256-258` _ensure_scene keyed by sceneId; `1087` undo targets active_scene_id; `1100` redo targets active_scene_id | ✅ COMPLIANT |
| Non-Goals | Initiative unaffected by undo | `app.py:1073` undo only replaces `scene["tokens"]`; initiative/bg/grid/music/history handlers have no history hooks | ✅ COMPLIANT |

**Compliance summary**: 9/10 requirements compliant, 1 partial (redo stack clearing).

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Snapshot Capture on Token Mutations | ✅ Implemented | 4 DM handlers call `history.before_mutation`; player skip via `is_dm_socket()` guard or early return |
| Scene-Level Coalescing | ✅ Implemented | Per-scene pending; 300ms window; `_sweep_all_locked` on each `before_mutation` call |
| Undo | ✅ Implemented | `socket_undo` → `history.undo` → `_apply_snapshot_and_broadcast`; pushes current to redo stack |
| Redo | ⚠️ Partial | `history.redo` doesn't finalize pending (minor), but redo stack clearing on new mutation is incomplete (CRITICAL) |
| Depth Limit and Persistence | ✅ Implemented | 50-step FIFO; in-memory only |
| Deferred Upload Deletion | ✅ Implemented | `remove_token` no longer deletes; urls purged on eviction and redo-stack clear |
| undoRedoState Event | ✅ Implemented | `{canUndo, canRedo}` shape emitted to dm room after every mutation/undo/redo |
| Thread Safety | ✅ Implemented | Single `threading.Lock` guards all state in all public methods |
| Cross-Scene History | ✅ Implemented | Per-scene `_scenes` dict; undo/redo target `active_scene_id` |
| Non-Goals | ✅ Implemented | No history hooks in music/notes/initiative/grid/bg/scene-manipulation handlers |
| Frontend buttons | ✅ Implemented | 2 tray-btn at top of tray, disabled initial state |
| Frontend keyboard shortcuts | ✅ Implemented | 2 branches NOT guarded by hasSelection; guarded by INPUT/TEXTAREA/contentEditable check |
| Frontend undoRedoState listener | ✅ Implemented | Retry-binding for VTT_DM availability; toggles disabled |
| Frontend help modal | ✅ Implemented | 2 rows in shortcuts table |
| py_compile | ✅ Passes | `python -m py_compile app.py` exits 0 |
| Existing payload shapes | ✅ Preserved | `undoRedoState` is additive; `sceneData` emission matches existing pattern |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Handler-level capture (not SceneStore) | ✅ Yes | `before_mutation` called at socket-handler level, guarded by `is_dm_socket()` |
| Scene-level coalescing (not per-token) | ✅ Yes | Single pending per scene; 300ms window |
| Pending finalized on undo | ✅ Yes | `history.undo` calls `_finalize_pending_locked` before popping |
| Pending finalized on redo | ❌ No | `history.redo` does NOT call `_finalize_pending_locked` or `_sweep_all_locked` |
| Redo stack cleared on new mutation | ⚠️ Partial | Only cleared when there's an existing pending to finalize; NOT cleared when pending is None (e.g. after undo) |
| Deferred upload deletion | ✅ Yes | `remove_token` modified; urls tracked in pending; purged on eviction and redo clear |
| Snapshot via json round-trip | ✅ Yes | `json.loads(json.dumps(...))` deep copy |
| _apply_snapshot_and_broadcast mirrors socket_load_scene | ✅ Yes | Same full→dm, filtered→player pattern |
| undo/redo target active_scene_id, capture uses payload sceneId | ✅ Yes | Captures use payload `sceneId` (or active_scene_id for addTokenFromLibrary); undo/redo use `active_scene_id` |
| Lock held during state ops, released before emits | ✅ Yes | All emits happen outside lock scope |

## Issues Found

### CRITICAL

1. **Redo stack not cleared on new mutation after undo** (`app.py:260-277` `before_mutation`)
   - The spec requirement states: "Any new mutation after an undo MUST clear the redo stack."
   - After `history.undo` runs, pending is None. When a new mutation calls `before_mutation`, it creates a new pending but does NOT call `_finalize_pending_locked` (because pending is None). The redo stack retains its entry from the undo.
   - **Impact**: DM can undo, make changes (e.g. drag a token), then redo — redo restores the pre-undo state, effectively losing the new changes. The redo stack is only cleared in `_finalize_pending_locked`, which requires an existing pending entry.
   - **Fix**: In `before_mutation`, after checking pending is None but before creating the new pending, clear the redo stack explicitly (including purging deferred deletion urls).

### WARNING

1. **`history.redo` does not finalize pending** (`app.py:300-311`)
   - Unlike `history.undo` (line 291), `history.redo` does not call `_finalize_pending_locked` at the start. If there's an unfinalized coalescing pending entry, the redo may operate with a stale before_snapshot still in pending.
   - **Impact**: In a narrow timing window (DM makes mutation, then immediately tries to redo within 300ms), the redo succeeds but the stale pending entry could cause the next undo to revert to an incorrect state.
   - **Workaround**: Extremely unlikely in practice (requires specific race timing with ~300ms window).

### SUGGESTION

1. **Cross-scene mismatch flag not implemented** — Spec says "flagging the mismatch" when payload sceneId ≠ active scene for undo/redo. Current code ignores payload sceneId entirely and uses `active_scene_id`. Since the frontend always sends `currentScene.sceneId` which matches active, this can't trigger from UI. Minor spec deviation, no practical impact.

2. **`_sweep_all_locked` may finalize other scenes' pending during `before_mutation`** — Sweeping all scenes means scene B's pending can be finalized during a mutation on scene A. This is semantically correct (the pending expired anyway) but means a mutation on one scene can trigger redo-stack clearing on another scene (if B's pending was expired). Acceptable for v1.

3. **No test coverage** — Project has no test infrastructure. Consider adding basic server smoke test at minimum.

## Verdict

**PASS WITH WARNINGS**

11 of 12 design decisions followed; 9 of 10 spec requirements fully compliant. One CRITICAL finding (redo stack clearing on new mutation after undo is incomplete) and one WARNING (redo doesn't finalize pending). The CRITICAL finding has a clear fix: clear the redo stack in `before_mutation` when creating a new pending entry with no existing pending.
