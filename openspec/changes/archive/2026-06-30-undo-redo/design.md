# Design: Undo/Redo for SceneSmith-VTT

**Change**: undo-redo
**Capability**: scene-history (NEW)
**Approach**: Server-side Memento via a `SceneHistory` helper inside `app.py`

---

## Architecture Overview

A single `SceneHistory` instance lives at module scope in `app.py` (next to
`scene_store = SceneStore()` at line 238). It owns, per `sceneId`:

- An **undo stack** (list of snapshots, max 50, FIFO).
- A **redo stack** (list of snapshots).
- A **pending** entry `{ before_snapshot, last_touch_ms }` for coalescing.
- A set of **pending-deletion `imageUrl`s** associated with each snapshot.

All `SceneHistory` state is guarded by a single `threading.Lock`.

Snapshot capture happens at the **socket-handler level** (DM-only), not inside
`SceneStore`. The handler is the only place that knows the actor via
`is_dm_socket()`. Player `{x,y}` moves bypass capture entirely.

On undo/redo, the server replaces `scene["tokens"]` with the popped snapshot,
calls `save_scene`, and emits `sceneData` (full to `dm`, hidden-filtered to
`player`) — the exact same path as `socket_load_scene` (line 758). The client
rebuilds via the existing `onSceneData` handler (sceneManager.js:237). No
frontend rebuild logic changes.

---

## Data Structures

### Snapshot

```python
# A snapshot is a deep copy of the scene's tokens list at a point in time.
# Deep copy via json round-trip (already used throughout app.py for persistence).
snapshot = json.loads(json.dumps(scene["tokens"]))
```

Each entry in the undo/redo stack is:

```python
{
    "tokens": <deep-copied tokens list>,
    "deleted_image_urls": <list of imageUrl strings to purge on eviction>
}
```

The `deleted_image_urls` list is populated only when the snapshot captures a
`removeToken` mutation — it records the `imageUrl` of the removed token(s) so
that the upload file can be purged when this snapshot is evicted from the FIFO
or cleared from the redo stack.

### SceneHistory class

```python
class SceneHistory:
    MAX_DEPTH = 50
    COALESCE_WINDOW_MS = 300

    def __init__(self, store):
        self._store = store          # reference to SceneStore
        self._lock = threading.Lock()
        self._scenes = {}            # sceneId -> { "undo": [], "redo": [], "pending": None }

    def before_mutation(self, scene_id):
        """Called in DM handlers before the SceneStore mutation."""
        ...

    def undo(self, scene_id):
        """Pop undo stack, push current state to redo, return snapshot."""
        ...

    def redo(self, scene_id):
        """Pop redo stack, push current state to undo, return snapshot."""
        ...

    def state(self, scene_id):
        """Return (can_undo, can_redo) for the undoRedoState event."""
        ...

    def _finalize_pending(self, scene_id):
        """Push pending snapshot onto undo stack, clear redo, evict if over 50."""
        ...

    def _evict_oldest(self, scene_id):
        """Pop oldest undo entry; purge its deleted_image_urls from disk."""
        ...

    def _ensure_scene(self, scene_id):
        """Lazily create the per-scene history dict entry."""
        ...
```

### Per-scene state

```python
self._scenes[scene_id] = {
    "undo": [],          # list of snapshot dicts (oldest first)
    "redo": [],          # list of snapshot dicts
    "pending": None      # { "before_snapshot": [...], "last_touch_ms": float, "deleted_image_urls": [] }
}
```

---

## Snapshot Capture Flow

### Where: four DM-only socket handlers

| Handler | app.py line | SceneStore method |
|---|---|---|
| `socket_update_token` | 780 | `update_token` (211) |
| `socket_add_token` | 809 | `add_token` (221) |
| `socket_remove_token` | 819 | `remove_token` (226) |
| `socket_add_token_from_library` | 915 | `add_token` (935) |

### How: `before_mutation(scene_id)`

In each DM handler, immediately **before** the `scene_store.update_token /
add_token / remove_token` call, insert:

```python
history.before_mutation(scene_id)
```

Player `{x,y}` moves (non-DM sockets in `socket_update_token`, lines 788-792)
skip the call — they never reach `before_mutation`.

### `before_mutation` internal logic

```python
def before_mutation(self, scene_id):
    now = time.time() * 1000  # milliseconds
    with self._lock:
        entry = self._ensure_scene(scene_id)
        pending = entry["pending"]

        # Finalize any expired pending for OTHER scenes (lazy sweep)
        self._sweep_all_locked()

        if pending is not None and (now - pending["last_touch_ms"]) < self.COALESCE_WINDOW_MS:
            # Within window: coalesce — update timestamp, do NOT push new snapshot
            pending["last_touch_ms"] = now
            return

        # Window expired or no pending: finalize existing pending, start new one
        if pending is not None:
            self._finalize_pending_locked(scene_id)

        # Take snapshot of current tokens BEFORE the mutation
        scene = self._store.scenes.get(scene_id) or self._store.load_scene(scene_id)
        entry["pending"] = {
            "before_snapshot": json.loads(json.dumps(scene.get("tokens", []))),
            "last_touch_ms": now,
            "deleted_image_urls": [],
        }
```

### `removeToken` special case: record deferred deletion

When `before_mutation` is called from `socket_remove_token`, the snapshot is
taken **before** the removal — so the removed token is still in the snapshot.
After the `scene_store.remove_token` call completes, the handler must record
the removed token's `imageUrl` in the pending entry:

```python
# In socket_remove_token, AFTER scene_store.remove_token:
removed_token = scene_store.remove_token(scene_id, token_id)
if removed_token:
    history.record_pending_deletion(scene_id, removed_token.get("imageUrl"))
    # NOTE: remove_token no longer calls delete_upload_if_unused itself
```

`record_pending_deletion` appends the `imageUrl` to
`pending["deleted_image_urls"]` under the lock. The file is NOT deleted yet.

---

## Coalescing Design

### Mechanism: scene-level ~300ms inactivity window

- Each scene has a single `pending` entry.
- On each DM mutation, if `pending` exists and `now - last_touch_ms < 300ms`,
  the mutation **coalesces** — only the timestamp updates, no new snapshot is
  pushed. The `before_snapshot` (taken before the first mutation of the burst)
  is preserved.
- When `now - last_touch_ms >= 300ms` (or there is no pending), the expired
  pending is finalized (pushed onto the undo stack, redo cleared) and a new
  pending starts.

### Lazy sweep

There is no background timer. Finalization happens lazily:
- On every `before_mutation` call, `_sweep_all_locked()` checks all scenes for
  expired pending entries and finalizes them.
- On every `undo` / `redo` / `state` call, the active scene's pending is
  finalized first (if expired).

This means a step becomes undoable at most ~300ms after the gesture ends. For a
single-DM trusted-LAN app this latency is imperceptible.

### What it groups uniformly

| Gesture | Emit pattern | Result |
|---|---|---|
| Single-token drag | many `updateToken {x,y}` at ~60Hz | 1 step |
| Multi-token selection drag | many `updateToken {x,y}` per token at ~60Hz | 1 step (scene-level, not per-token) |
| Multi-token selection delete | one `removeToken` per token in a burst | 1 step |
| Resize gesture | many `updateToken {x,y,width,height}` | 1 step |
| Q/E rotation repeat | many `updateToken {rotation}` | 1 step |
| Discrete single action (one emit, then idle) | one emit | 1 step |

### Tradeoff

Two distinct DM actions performed within ~300ms with no pause merge into one
undo step. For a single DM this is rare and acceptable for v1. The window is
tunable via `COALESCE_WINDOW_MS`.

---

## Undo Flow

### New socket handler: `undo`

```python
@socketio.on("undo")
def socket_undo(data):
    if not is_dm_socket():
        return
    scene_id = scene_store.active_scene_id
    if not scene_id:
        return
    snapshot = history.undo(scene_id)
    if snapshot is None:
        return  # empty stack, no-op
    _apply_snapshot_and_broadcast(scene_id, snapshot)
```

### `history.undo` internal logic

```python
def undo(self, scene_id):
    with self._lock:
        entry = self._ensure_scene(scene_id)
        self._finalize_pending_locked(scene_id)  # flush any active coalescing window
        if not entry["undo"]:
            return None
        # Push CURRENT state to redo (so redo can restore it)
        scene = self._store.scenes.get(scene_id) or self._store.load_scene(scene_id)
        current = json.loads(json.dumps(scene.get("tokens", [])))
        entry["redo"].append({"tokens": current, "deleted_image_urls": []})
        # Pop the previous snapshot
        return entry["undo"].pop()
```

### `_apply_snapshot_and_broadcast` (shared by undo and redo)

```python
def _apply_snapshot_and_broadcast(scene_id, snapshot):
    scene = scene_store.scenes.get(scene_id) or scene_store.load_scene(scene_id)
    scene["tokens"] = snapshot["tokens"]
    scene_store.save_scene(scene)
    # Full scene to DM room
    socketio.emit("sceneData", scene, to="dm")
    # Hidden-filtered to player room
    filtered = dict(scene)
    filtered["tokens"] = [t for t in scene.get("tokens", []) if not t.get("hidden")]
    socketio.emit("sceneData", filtered, to="player")
    # Button state
    can_undo, can_redo = history.state(scene_id)
    emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")
```

This mirrors `socket_load_scene` (line 758-769) exactly — same filtering, same
`sceneData` event. The client's `onSceneData` handler (sceneManager.js:237)
does a full rebuild (clears selection, re-renders all tokens, rebinds
interactions). **No frontend rebuild changes needed.**

---

## Redo Flow

### New socket handler: `redo`

```python
@socketio.on("redo")
def socket_redo(data):
    if not is_dm_socket():
        return
    scene_id = scene_store.active_scene_id
    if not scene_id:
        return
    snapshot = history.redo(scene_id)
    if snapshot is None:
        return  # empty redo stack, no-op
    _apply_snapshot_and_broadcast(scene_id, snapshot)
```

### `history.redo` internal logic

```python
def redo(self, scene_id):
    with self._lock:
        entry = self._ensure_scene(scene_id)
        if not entry["redo"]:
            return None
        # Push CURRENT state to undo (so undo can restore it)
        scene = self._store.scenes.get(scene_id) or self._store.load_scene(scene_id)
        current = json.loads(json.dumps(scene.get("tokens", [])))
        entry["undo"].append({"tokens": current, "deleted_image_urls": []})
        # Evict if over 50 (shouldn't happen via redo, but defensive)
        if len(entry["undo"]) > self.MAX_DEPTH:
            self._evict_oldest_locked(scene_id)
        # Pop the redo snapshot
        return entry["redo"].pop()
```

---

## Redo Stack Clearing

On any **new mutation** (via `before_mutation` → `_finalize_pending_locked`),
the redo stack for that scene is cleared:

```python
def _finalize_pending_locked(self, scene_id):
    entry = self._scenes[scene_id]
    pending = entry["pending"]
    if pending is None:
        return
    entry["pending"] = None
    # Purge any deferred-deletion images from this snapshot
    # (they were deferred during removeToken; now the step is committed)
    for url in pending["deleted_image_urls"]:
        self._store.delete_upload_if_unused(url)
    # Push onto undo stack
    entry["undo"].append({
        "tokens": pending["before_snapshot"],
        "deleted_image_urls": pending["deleted_image_urls"],
    })
    # Clear redo stack — standard semantics
    entry["redo"].clear()
    # Evict oldest if over 50
    if len(entry["undo"]) > self.MAX_DEPTH:
        self._evict_oldest_locked(scene_id)
```

**Wait — correction on deletion timing.** The `deleted_image_urls` in a
snapshot should NOT be purged when the snapshot is *committed* to the undo
stack. They must survive until the snapshot is *evicted* (leaves the FIFO),
because undo of a remove must restore the image. The purge happens in
`_evict_oldest_locked`:

```python
def _evict_oldest_locked(self, scene_id):
    entry = self._scenes[scene_id]
    if not entry["undo"]:
        return
    evicted = entry["undo"].pop(0)  # FIFO — oldest first
    for url in evicted.get("deleted_image_urls", []):
        self._store.delete_upload_if_unused(url)
```

And when the redo stack is cleared, any `deleted_image_urls` in the cleared
redo entries are also purged (those snapshots will never be restored):

```python
# In _finalize_pending_locked, BEFORE entry["redo"].clear():
for redone in entry["redo"]:
    for url in redone.get("deleted_image_urls", []):
        self._store.delete_upload_if_unused(url)
entry["redo"].clear()
```

---

## Deferred Upload Deletion

### Current behavior (app.py:226-235)

`remove_token` calls `delete_upload_if_unused(removed.get("imageUrl"))`
immediately after popping the token from the list and saving. The file is
gone the moment the token is removed.

### New behavior

`remove_token` **stops** calling `delete_upload_if_unused`. The file deletion
is deferred to one of two events:

1. **FIFO eviction**: when the snapshot containing the removed token is
   evicted from the undo stack (the 51st step pushes out the oldest). At that
   point the token is truly gone — no undo can restore it, so the file is safe
   to delete. Handled in `_evict_oldest_locked`.

2. **Redo stack clearing**: when a new mutation clears the redo stack and the
   removed token's snapshot was in the redo stack. At that point neither undo
   nor redo can restore it. Handled in `_finalize_pending_locked`.

### `remove_token` modification

```python
def remove_token(self, scene_id, token_id):
    scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
    tokens = scene.setdefault("tokens", [])
    for index, token in enumerate(tokens):
        if token.get("tokenId") == token_id:
            removed = tokens.pop(index)
            self.save_scene(scene)
            # NO LONGER: self.delete_upload_if_unused(removed.get("imageUrl"))
            # Deletion is deferred to history eviction (see SceneHistory)
            return removed
    return None
```

The `socket_remove_token` handler calls
`history.record_pending_deletion(scene_id, removed.get("imageUrl"))` after
`remove_token` returns, so the `imageUrl` is tracked in the pending entry and
flows into the snapshot when the coalescing window finalizes.

### Edge cases

- **Undo of add**: removes only the token reference from `scene["tokens"]`. The
  upload file is never deleted (it was a fresh add, not a remove). Correct —
  no `deleted_image_urls` involved.
- **Undo of remove**: restores the token (with its `imageUrl`) from the
  snapshot. The file is still on disk because deletion was deferred. Image is
  valid. Correct.
- **Redo of remove**: re-removes the token. The file is still on disk (the
  snapshot's `deleted_image_urls` hasn't been purged yet — it's in the redo
  stack). Image is valid if the user undoes again. Correct.

---

## Depth Limit and FIFO

The undo stack caps at `MAX_DEPTH = 50`. On overflow, the oldest entry (index
0) is popped via `_evict_oldest_locked`, which purges its `deleted_image_urls`
from disk. This is the only path that deletes upload files for removed tokens.

The redo stack has no depth limit — it can never exceed the number of undos
performed since the last mutation, which is bounded by the undo stack depth
(50).

---

## Thread Safety

`async_mode="threading"` (app.py:245) means socket handlers run on worker
threads. A single `threading.Lock` (`self._lock`) guards **all** `SceneHistory`
state:

- The per-scene `_scenes` dict (creation, read, mutation).
- The undo and redo stacks (push, pop, clear).
- The `pending` entry (create, update, finalize).
- The `deleted_image_urls` lists.

Every public method (`before_mutation`, `undo`, `redo`, `state`,
`record_pending_deletion`) acquires the lock for its entire operation. Internal
helpers (`_finalize_pending_locked`, `_evict_oldest_locked`, `_sweep_all_locked`)
are called **already holding the lock** (suffix `_locked`).

The lock is never held while emitting Socket.IO events — emissions happen
after the lock is released, in the handler. This prevents deadlocks if an
emit triggers a synchronous handler (unlikely in threading mode, but
defensive).

---

## Cross-Scene Behavior

History is keyed by `sceneId`. `before_mutation` captures under the payload's
`sceneId`. Undo/redo always target `scene_store.active_scene_id`.

### Normal case

Payload `sceneId` == active scene → capture and undo target the same scene.

### Mismatch case

Payload `sceneId` != active scene (possible via `updateToken` on a non-active
scene). The snapshot is captured under the payload `sceneId`'s history.
Undo targets the **active** scene's history, not the payload's. The mismatch
is flagged by returning a sentinel in the undo response (e.g.
`{"mismatch": true}`) so the frontend can inform the DM, or simply by the undo
no-oping if the active scene has no history.

For v1 (single DM, LAN), the mismatch is rare and the behavior is safe: the DM
is almost always operating on the active scene.

---

## undoRedoState Event

### Payload shape

```json
{ "canUndo": true, "canRedo": false }
```

### When emitted

- After every DM mutation (in `before_mutation` or `_finalize_pending`).
- After every `undo` / `redo` (in `_apply_snapshot_and_broadcast`).

### Target

DM room only (`to="dm"`). Players do not need button state.

### Frontend handling

A new listener in `dmControls.js` (or `sceneManager.js`):

```javascript
socket.on('undoRedoState', ({ canUndo, canRedo }) => {
  document.getElementById('undo-btn').disabled = !canUndo;
  document.getElementById('redo-btn').disabled = !canRedo;
});
```

This is **additive** — it does not alter any existing event payload.

---

## Frontend Changes (Additive Only)

### 1. DM tool tray buttons — `public/dm.html` (line 107)

Add two `tray-btn` buttons at the **top** of `#dm-tool-tray` (before the Init
button). These are one-shot actions, not panel toggles:

```html
<div id="dm-tool-tray" class="tray-hidden">
  <button id="undo-btn" class="tray-btn" title="Undo (Ctrl+Z)" disabled>
    <i class="fa-solid fa-rotate-left"></i><span>Undo</span>
  </button>
  <button id="redo-btn" class="tray-btn" title="Redo (Ctrl+Shift+Z)" disabled>
    <i class="fa-solid fa-rotate-right"></i><span>Redo</span>
  </button>
  <button id="init-toggle-btn"  class="tray-btn" ...>
  <!-- ... existing buttons unchanged ... -->
</div>
```

The `disabled` attribute is set initially; the `undoRedoState` listener
toggles it.

### 2. Help modal rows — `public/dm.html` (line 80-102)

Add two rows to the keyboard shortcuts table:

```html
<tr><td><kbd>Ctrl+Z</kbd></td><td>Undo last action</td></tr>
<tr><td><kbd>Ctrl+Shift+Z</kbd></td><td>Redo last undone action</td></tr>
```

### 3. Keyboard shortcuts — `public/js/sceneManager.js` (onKeyDown, line 384)

Add two branches. They are **not** guarded by `hasSelection()` — undo/redo
should work even with no token selected. They are guarded by the existing
INPUT/TEXTAREA/contentEditable focus check (lines 385-387), so undo is
disabled while editing a sticky note.

```javascript
// After the existing Ctrl+D branch (line 396-399), before the 'i' branch:
} else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
  event.preventDefault();
  if (this.currentScene) {
    this.socket.emit('undo', { sceneId: this.currentScene.sceneId });
  }
} else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z') {
  event.preventDefault();
  if (this.currentScene) {
    this.socket.emit('redo', { sceneId: this.currentScene.sceneId });
  }
}
```

### 4. Click handlers + state listener — `public/js/dmControls.js` (~line 120)

Add after the tray toggle wiring (line 120):

```javascript
// ── Undo / Redo one-shot buttons ──────────────────────
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
undoBtn.addEventListener('click', () => {
  const sm = window.VTT_DM.sceneManager;
  if (sm.currentScene) sm.socket.emit('undo', { sceneId: sm.currentScene.sceneId });
});
redoBtn.addEventListener('click', () => {
  const sm = window.VTT_DM.sceneManager;
  if (sm.currentScene) sm.socket.emit('redo', { sceneId: sm.currentScene.sceneId });
});

// ── Button state from server ──────────────────────────
window.VTT_DM.socket.on('undoRedoState', ({ canUndo, canRedo }) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
});
```

### 5. What does NOT change

- `public/js/tokenTool.js` — no drag-end event needed.
- `public/js/tokenManager.js` — resize keeps emitting `updateToken` as today.
- `public/js/sceneRenderer.js` — rendering unchanged.
- The existing `sceneData` listener (sceneManager.js:31) — reused unchanged.
- All existing Socket.IO event payload shapes — unchanged.

**Frontend parity preserved.**

---

## Architecture Decision: Why Handler-Level Capture

**Decision**: capture at the socket-handler level (DM-only), not inside
`SceneStore` methods.

**Rationale**:
- The handler is the only place that knows the actor (`is_dm_socket()`).
  `SceneStore.update_token` cannot distinguish a DM move from a player move
  without a flag argument — which erases the "single chokepoint" simplicity.
- All token mutations (including paint tiles and area effects, which originate
  in `paintMode.js` / `areaEffects.js`) flow through the same four handlers,
  so handler-level capture covers 100% of live token mutations.
- The dead `/updateScene` HTTP route is naturally ignored.

**Rejected alternative**: wrap `SceneStore` methods. Would also capture
player `{x,y}` moves (contaminating the DM's undo stack) and the unused
`/updateScene` bulk path. Only viable if a `record_history`/`actor` flag is
threaded from every handler — equivalent to handler-level capture with extra
plumbing.

---

## Architecture Decision: Why Scene-Level Coalescing (Not per-Token)

**Decision**: coalesce by scene-level inactivity window, not per-tokenId.

**Rationale**:
- Per-tokenId keying would split a multi-token selection drag into N steps,
  violating "a full token drag = ONE history step."
- Scene-level keying is a strict superset: it handles single-token drags,
  multi-token drags, and multi-token deletes uniformly.
- The scope's original "tokenId" hint assumed single-token drags; scene-level
  keying is the correct granularity for multi-token gestures.

---

## Rollback Plan

The change is **additive**: no schema migration, no persisted state, no DB
column. To revert:

1. Remove the 2 `tray-btn` buttons + 2 help rows from `public/dm.html`.
2. Revert the 2 keydown branches in `public/js/sceneManager.js`.
3. Revert the 2 click handlers + `undoRedoState` listener in
   `public/js/dmControls.js`.
4. In `app.py`, remove the `SceneHistory` class, the
   `history.before_mutation(...)` calls in the 4 handlers, the `undo`/`redo`
   handlers, and restore the immediate `delete_upload_if_unused` call inside
   `remove_token`.
5. Restart `app.py` — history (in-memory only) is gone; no file repair needed.

None of these steps touch `data/scenes/*.json` (schema unchanged) or any
existing event payload. A bare `git revert` of the change commit accomplishes
all of the above.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Memory growth: 50 snapshots × N scenes × tokens-list size | Medium | FIFO 50 cap; snapshot is only the `tokens` list (KB-scale per scene). For trusted LAN with one active scene, memory is bounded. Can add active-scene-only or LRU if needed. |
| Thread races on history state (`async_mode="threading"`) | High | Single `threading.Lock` around all `SceneHistory` state; all public methods acquire it. |
| Undo of delete shows broken image | Eliminated | Deferred upload deletion: file purged only on FIFO eviction or redo-stack clearing. |
| Two DM actions within ~300ms merge into one step | Low | Acceptable for single-DM v1; window tunable via `COALESCE_WINDOW_MS`. |
| Cross-scene undo confusion (payload sceneId ≠ active) | Low | Capture under payload sceneId; undo targets active scene. Rare in single-DM usage. |
| `delete_upload_if_unused` called outside lock during eviction | Low | Called from `_evict_oldest_locked` while holding the lock. The method does disk I/O (file scan + unlink) — could block other history operations briefly. Acceptable for LAN; can move to a background thread if profiling shows contention. |
| Lock held during `delete_upload_if_unused` (disk I/O) | Medium | `is_image_used_elsewhere` scans all scene JSON files on disk. Under lock, this blocks concurrent history ops. For LAN with few scenes this is fast. If it becomes a bottleneck, defer the purge to a background queue. |
