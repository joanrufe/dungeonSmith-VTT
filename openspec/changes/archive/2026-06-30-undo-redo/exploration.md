# Exploration: Undo/Redo for SceneSmith-VTT

**Change**: undo-redo
**Approach (pre-agreed)**: Server-side Memento (state snapshots). Single DM. History global
per-scene, in-memory only, 50-step FIFO. Triggered by Ctrl+Z / Ctrl+Shift+Z + two DM tool-tray
buttons. On undo/redo the server restores the snapshot and emits the full scene state via the
existing `sceneData` path so the client rebuilds without frontend changes.
**Mode**: openspec

---

## Current State

The server is a single monolithic `app.py` (Flask + Flask-SocketIO, `async_mode="threading"`).
`SceneStore` (app.py:126) holds scenes in `self.scenes` (dict by `sceneId`) and persists each to
`data/scenes/{sceneId}.json` via `save_scene()` (app.py:146). Every token mutation funnels through
**three `SceneStore` methods** — `update_token`, `add_token`, `remove_token` — called from **four
Socket.IO handlers**. The frontend is framework-less vanilla JS; tokens are dragged with native
Pointer Events (`tokenTool.js`), which floods the server with `updateToken {x,y}` events during a
drag and emits **no drag-end signal**.

---

## Token Mutation Map (server)

| Socket handler | app.py | SceneStore method | In-memory mutate | Disk persist | Emits |
|---|---|---|---|---|---|
| `updateToken` | 780 | `update_token` (211) | `token.update(properties)` (216) | `save_scene` (217) | `updateToken` to dm/player (798-806); or `addToken`/`removeToken` to player on hidden toggle (801/798) |
| `addToken` | 809 | `add_token` (221) | `scene["tokens"].append(token)` (223) | `save_scene` (224) | `addToken` broadcast (816) |
| `removeToken` | 819 | `remove_token` (226) | `tokens.pop(index)` (231) | `save_scene` (232) | `removeToken` broadcast (826); **also deletes upload file** via `delete_upload_if_unused` (233) |
| `addTokenFromLibrary` | 915 | `add_token` (935) | (same as addToken) | `save_scene` | `addToken` broadcast (936); operates on `active_scene_id` only |

**Actor gating**: `updateToken` allows non-DM sockets but restricts them to `{x,y}` on tokens with
`movableByPlayers` (app.py:788-792). `addToken`, `removeToken`, `addTokenFromLibrary` are DM-only
(`is_dm_socket()`). Paint tiles and area effects are stored as tokens and enter through
`addToken`/`removeToken` too (`paintMode.js:433,459,129`; `areaEffects.js:127`).

**Out-of-scope mutations (confirmed)**: `changeScene` (772) sets `active_scene_id` only — no token
change. `delete_scene` (172), `update_scene_order` (180), `createScene`, `duplicateScene` are
scene-level, excluded per agreed scope. The `/updateScene` HTTP route (357) does a full-scene
replace but is **not called anywhere in `public/js`** (grep: 0 matches) — it is dead for
interactive token edits, so it can be ignored for history capture.

**Client `sceneData` rebuild path** (the one undo/redo must reuse): `socket_load_scene` (758)
emits the full scene to DM, a hidden-filtered copy to players (763-767). `SceneManager.onSceneData`
(sceneManager.js:237) clears selection, re-renders all tokens, rebinds interactions — a full
rebuild. This is exactly the "restore snapshot + emit sceneData" path the agreed approach requires.

---

## Frontend Integration Points

### Keyboard shortcuts — `public/js/sceneManager.js`
- `onKeyDown` (sceneManager.js:384) is the single DM keydown handler. It already guards against
  `INPUT`/`TEXTAREA`/`contentEditable` focus (385-387) — so undo will correctly be disabled while
  editing a sticky note, matching the existing convention.
- Existing Ctrl pattern: `event.ctrlKey && event.key.toLowerCase() === 'd'` for duplicate (396).
  Add two branches alongside it:
  - `event.ctrlKey && !event.shiftKey && key === 'z'` → `socket.emit('undo', { sceneId })` + `preventDefault`.
  - `event.ctrlKey && event.shiftKey && key === 'z'` (or `key === 'y'`) → `socket.emit('redo', { sceneId })` + `preventDefault`.
  - `sceneId` = `this.currentScene.sceneId`. No-op if no current scene.
- `setupKeyListeners` (79) registers the single `document` listener; no new listener needed.

### Buttons — `public/dm.html` + `public/js/dmControls.js`
- The DM tool tray is `#dm-tool-tray` (dm.html:107-114), a vertical rail of `tray-btn` buttons
  (Init, Paint, Effects, Notes, Dice, Music). Toggled by `#dm-tools-tray-btn`
  (dmControls.js:115-120) which flips `tray-hidden`. **Add two `tray-btn` buttons** (Undo / Redo,
  e.g. `fa-rotate-left` / `fa-rotate-right`) at the top of `#dm-tool-tray`. They are one-shot
  actions, not panel toggles, so their click handler emits `undo`/`redo` and does not toggle a panel.
- Wire click handlers in `dmControls.js` next to the tray wiring (~line 120), using
  `window.VTT_DM.socket` / `window.VTT_DM.sceneManager.currentScene.sceneId` (dm.js:18 exposes
  both). Add `disabled` styling when the stack is empty — the server can push a small
  `undoRedoState` event (`{ canUndo, canRedo }`) after each mutation/undo/redo to toggle button
  state; this is an **additive** event, not a payload change to existing events.
- Help modal (dm.html:80-102): add two rows documenting Ctrl+Z / Ctrl+Shift+Z.

### Net frontend change
Only **additive**: 2 buttons + 2 help rows in `dm.html`, 2 keydown branches in `sceneManager.js`,
2 click handlers in `dmControls.js`. The `sceneData` listener (sceneManager.js:31) is reused
unchanged → **frontend parity preserved**.

---

## Integration Point for Snapshot Capture

**Recommendation: capture at the Socket.IO handler level, not at `SceneStore`.**

Rationale:
- The agreed scope is **single-DM**: only DM-initiated mutations should enter history. The handler
  is the only place that knows the actor (`is_dm_socket()`). `SceneStore.update_token` cannot
  distinguish a DM move from a player move without a flag argument — which erases the
  "single chokepoint" simplicity argument.
- All token mutations (including paint tiles and area effects, which originate in `paintMode.js` /
  `areaEffects.js`) flow through the same four handlers, so handler-level capture still covers
  100% of live token mutations.
- The dead `/updateScene` HTTP route is naturally ignored.

Rejected alternative — wrap `SceneStore` methods: would also capture player `{x,y}` moves
(contaminating the DM's undo stack) and the unused `/updateScene` bulk path. Only viable if a
`record_history`/`actor` flag is threaded from every handler — equivalent to handler-level capture
with extra plumbing.

**Capture mechanics**: introduce a `SceneHistory` helper (kept inside `app.py` per the monolithic
convention; config rule forbids a controllers/services split). Immediately **before** each
`scene_store.update_token/add_token/remove_token` call in the four DM handlers, call
`history.capture(scene_id)` which deep-copies `scene["tokens"]` (the only mutable part; `sceneId`/
`sceneName`/`order` are untouched by these mutations) into a pending snapshot. A snapshot is a
`json.loads(json.dumps(tokens))` list. Undo/redo replace `scene["tokens"]`, call `save_scene`, and
emit `sceneData` (full to `dm` room, hidden-filtered to `player` room — mirroring
`socket_load_scene`).

---

## Drag Coalescing Strategy

**Problem**: `tokenTool.js` `onMove` (line 89) fires on every `pointermove` (~60 Hz) and emits one
`updateToken {x,y}` **per token in the selection** per frame. A 1-second single-token drag ≈ 60
emits; a 3-token drag ≈ 180. The `onUp` handler (133) only releases pointer capture — **there is no
drag-end socket event**, and the last `onMove` emit is the final position. Per `onResizeMove`
(tokenManager.js:71) resize is identical (continuous `{x,y,width,height}` emits).

**Recommendation: server-side, scene-level inactivity-window coalescing. No frontend drag-end
event.**

- Maintain a per-scene `pending` entry: `{ before_snapshot, last_touch_ms }`.
- On each DM `updateToken`/`addToken`/`removeToken`:
  - If a `pending` exists for that scene and `now - last_touch_ms < WINDOW` → **coalesce**: do not
    push a new snapshot; just update `last_touch_ms = now` and let the mutation proceed. The
    `before_snapshot` (taken before the first mutation of the burst) is preserved.
  - Else (no pending, or window expired, or a different scene) → finalize any expired `pending`
    (push its `before_snapshot` onto the undo stack, clear redo stack), then start a new `pending`
    with a fresh `before_snapshot`.
- A low-overhead sweep (e.g. on every incoming mutation, plus a single `threading.Timer` or a
  lazy check) finalizes a `pending` once `now - last_touch_ms >= WINDOW`, pushing the step so
  Ctrl+Z works shortly after the gesture ends.
- **WINDOW ≈ 300 ms** (tunable). This naturally groups:
  - a single-token drag (many `{x,y}`) → **one step**; ✓
  - a multi-token selection drag (many `{x,y}` across tokenIds) → **one step** (keyed by scene, not
    tokenId, so the whole gesture collapses); ✓
  - a multi-token selection delete (`deleteSelectedToken` loops and emits one `removeToken` per
    token, sceneManager.js:613-633) → **one step**; ✓
  - a discrete single action (one emit then idle) → **one step**; ✓
  - rapid Q/E rotation repeats → one step (acceptable).

**Why not key by tokenId** (literally "temporal window + tokenId" from the scope): per-tokenId
keying would split a multi-token selection drag into N steps, violating "a full token drag = ONE
history step." Scene-level keying is the correct granularity for multi-token gestures. The scope's
"tokenId" hint assumed single-token drags; scene-level keying is a strict superset that also
handles multi-token drags and multi-token deletes uniformly.

**Tradeoff**: two distinct actions performed within ~300 ms with no pause merge into one undo
step. For a single DM this is rare and acceptable for v1.

**Optional enhancement (deferred)**: emit a `mutationBatchEnd` on `pointerup` in `tokenTool.js` to
finalize the step instantly. This is a small additive frontend change; **not required** for v1
because the idle timeout already bounds the wait to ~300 ms. Flag for the propose phase.

**Multi-token delete**: handled automatically by scene-level coalescing (above) — the burst of
`removeToken` events within the window becomes one step. No special-case code needed. ✓

---

## Risks

- **Memory per snapshot / large scenes**: a snapshot is a deep copy of the whole `tokens` list.
  For a 100-token scene (~tens of KB each) × 50 steps × N scenes, memory can reach single-digit MB.
  **Mitigation**: keep history only for the active scene (or a small LRU of recently-active
  scenes); cap at 50 FIFO. Acceptable for trusted-LAN. Design decision for propose phase: per-scene
  dict vs. active-scene-only.
- **Undo of a removed token whose upload was deleted**: `remove_token` calls
  `delete_upload_if_unused` (app.py:233) which **deletes the image file on disk**. Undoing that
  removeToken restores the token dict with its `imageUrl`, but the file is gone → broken image.
  **Mitigation (recommended)**: when history is enabled, **do not delete uploads inside
  `remove_token`**; instead delete them only when the corresponding history step is evicted from
  the 50-deep FIFO (or on explicit "purge"). This preserves undo correctness at the cost of keeping
  files ~50 steps longer. Key design decision for propose phase.
- **Undo of addToken / addTokenFromLibrary**: should NOT delete the just-uploaded file (re-uploading
  is annoying and the file may be a fresh upload). Recommend: undo of add only removes the token
  reference, never the upload. Consistent with the deferred-deletion rule above.
- **Undo across a scene switch**: history is per-scene; Ctrl+Z targets the **active** scene's
  history. Switching from A→B and pressing Ctrl+Z undoes B's last action, not A's (correct per
  "global per-scene"). Key history by the `sceneId` in the mutation payload; undo/redo target
  `scene_store.active_scene_id`. Edge case: a mutation whose payload `sceneId` ≠ active scene
  (possible via `updateToken` on a non-active scene) — recommend capturing under the payload
  `sceneId` but only undoing the active scene; flag the mismatch.
- **Player moves**: handler-level capture (DM-only) excludes player `{x,y}` moves from history, so
  DM Ctrl+Z never undoes a player's move — matches single-DM scope. A DM undo restores the
  pre-DM-action snapshot, which already reflects any prior player moves. Correct.
- **Scope ambiguity (flag for propose)**: the enumerated undoable list ("move, create, delete,
  rotate, layer, hide/lock, add-from-library") does not explicitly mention **resize** (continuous
  `{x,y,width,height}`), **HP/condition status** (`tokenTool.js` status popup, 191), or
  **paint tiles / area effects** (which ARE tokens). Simplest consistent rule: treat *all*
  `updateToken`/`addToken`/`removeToken` mutations as undoable (they are all "token state and
  properties"), with coalescing only for continuous gestures. If the user wants a narrower set
  (e.g. exclude HP/condition or exclude paint/effects), the history hook must filter by property
  keys / `isPaintTile` / `isAreaEffect`. Needs user confirmation in the propose phase.
- **Threading**: `async_mode="threading"` means socket handlers run on worker threads; the history
  dict and the coalescing timestamp must be guarded by a `threading.Lock` to avoid races between
  concurrent DM actions and the finalize sweep. Low complexity but mandatory.
- **Button state sync**: without a `canUndo/canRedo` signal the buttons can't reflect availability.
  An additive `undoRedoState` event after each mutation/undo/redo solves this without altering
  existing payload shapes (parity-safe).

---

## Affected Areas

- `app.py` — new `SceneHistory` helper; hooks in `socket_update_token` (780),
  `socket_add_token` (809), `socket_remove_token` (819), `socket_add_token_from_library` (915);
  new `undo`/`redo` socket handlers; modify `remove_token` upload-deletion timing; emit
  `undoRedoState` and `sceneData` (full to `dm`, filtered to `player`).
- `public/dm.html` — two `tray-btn` buttons in `#dm-tool-tray`; two help-modal rows.
- `public/js/sceneManager.js` — two Ctrl+Z / Ctrl+Shift+Z branches in `onKeyDown` (384).
- `public/js/dmControls.js` — click handlers for the two new buttons (~line 120).
- No change to `public/js/tokenTool.js`, `tokenManager.js`, `sceneRenderer.js`, or the existing
  `sceneData` listener — drag/resize keep emitting `updateToken` as today.

---

## Recommendation

1. **Capture at the socket handler level** (DM-only) via a `SceneHistory` helper in `app.py`.
2. **Snapshot = deep copy of `scene["tokens"]`**; undo/redo replace tokens, `save_scene`, emit
   `sceneData` (full to `dm`, hidden-filtered to `player`).
3. **Coalesce by scene-level ~300 ms inactivity window** — no frontend drag-end event, handles
   single-token drag, multi-token drag, and multi-token delete uniformly.
4. **Defer upload-file deletion** for `removeToken` until the history step is evicted, so undo of a
   delete restores a valid image.
5. **Frontend: additive only** — two tray buttons, two keydown branches, two click handlers; reuse
   the existing `sceneData` rebuild path.

---

## Ready for Proposal

**Yes.** The exploration confirms the pre-agreed approach is viable with minimal, parity-safe
frontend changes. Two scope points need user confirmation in `sdd-propose`:
1. Whether resize, HP/condition status, and paint tiles / area effects are undoable (recommend:
   yes — all token-property mutations), or whether the history hook should filter them out.
2. Whether to defer upload-file deletion for `removeToken` until history eviction (recommend: yes,
   to keep undo of delete valid), accepting that files linger up to 50 steps.
