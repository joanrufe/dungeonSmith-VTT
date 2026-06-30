# Archive Report: undo-redo

**Change**: undo-redo
**Archived**: 2026-06-30
**SDD Cycle**: Complete ✓

## Executive Summary

Server-side undo/redo for SceneSmith-VTT implemented via the Memento pattern (state snapshots).
A `SceneHistory` helper inside `app.py` captures deep-copied token snapshots at the socket-handler
level before each DM-initiated mutation, coalesces continuous gesture events (drag/resize) into
single steps via a per-scene ~300ms inactivity window, and supports 50-step FIFO undo/redo stacks
with deferred upload deletion so undo of a delete restores a valid image. Frontend changes are
additive only: 2 tool-tray buttons, 2 keyboard shortcuts, 2 help-modal rows, and an
`undoRedoState` listener — all reusing the existing `sceneData` rebuild path.

## Change Lifecycle

| Phase | Status | Artifact |
|-------|--------|----------|
| Exploration | ✅ Complete | `exploration.md` |
| Proposal | ✅ Complete | `proposal.md` |
| Spec (scene-history) | ✅ Complete | `specs/scene-history/spec.md` |
| Design | ✅ Complete | `design.md` |
| Tasks | ✅ Complete (19/19) | `tasks.md` |
| Apply | ✅ Complete | — (code changes in `app.py`, `public/dm.html`, `public/js/sceneManager.js`, `public/js/dmControls.js`) |
| Verify | ✅ Complete | `verify-report.md` |

## Key Architecture Decisions

1. **Handler-level capture** (not SceneStore) — only the socket handler knows the actor via
   `is_dm_socket()`; player `{x,y}` moves bypass history cleanly.
2. **Scene-level coalescing** (not per-token) — a single ~300ms inactivity window per scene groups
   multi-token drags, multi-token deletes, and resize gestures into one step each.
3. **Deferred upload deletion** — `remove_token` no longer calls `delete_upload_if_unused`
   immediately; file purging waits until the owning snapshot is evicted from the 50-deep FIFO or
   its redo-stack entry is cleared.
4. **No frontend rebuild changes** — undo/redo broadcasts via existing `sceneData` path; client
   `onSceneData` handler is reused unchanged. Frontend parity preserved.

## Verification Results

| Metric | Result |
|--------|--------|
| Tasks complete | 19/19 (all [x]) |
| Build | ✅ `python -m py_compile app.py` passes |
| Spec compliance | 9/10 full, 1 partial (now fixed) |
| Verdict | PASS WITH WARNINGS |

### Remediation Applied

Two issues found in `verify-report.md` were FIXED in `app.py` during the verification phase:

1. **CRITICAL — Redo stack not cleared on new mutation after undo**: `before_mutation` now clears
   the redo stack explicitly when creating a new pending entry with no existing pending.
2. **WARNING — `history.redo` does not finalize pending**: `history.redo` now calls
   `_finalize_pending_locked` before popping the redo stack.

Both remediations were applied to `app.py` directly. The `verify-report.md` captures the original
findings but the code reflects the fixes.

### Residual Suggestions (not implemented — acceptable for v1)

| # | Suggestion | Impact |
|---|------------|--------|
| 1 | Cross-scene mismatch flag when payload `sceneId` ≠ active scene | Not triggerable from UI (frontend always sends `currentScene.sceneId`) |
| 2 | `_sweep_all_locked` may finalize other scenes' pending during `before_mutation` | Semantically correct — the pending was already expired |
| 3 | No test coverage | Project has no test infrastructure; requires separate effort |

## Archived Artifacts

```
openspec/changes/archive/2026-06-30-undo-redo/
├── exploration.md
├── proposal.md
├── specs/
│   └── scene-history/
│       └── spec.md
├── design.md
├── tasks.md
└── verify-report.md
```

## Main Spec Updated

`openspec/specs/scene-history/spec.md` created (new capability — no prior main spec existed).
Contains 10 requirements with Given/When/Then scenarios.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. Ready for the next change.
