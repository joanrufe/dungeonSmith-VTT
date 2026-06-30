# Delta for scene-history

## ADDED Requirements

### Requirement: Snapshot Capture on Token Mutations

The system MUST deep-copy scene `tokens` before each DM-initiated
`updateToken`/`addToken`/`removeToken`/`addTokenFromLibrary` at the
socket-handler level; player `{x,y}` moves bypass capture. All token properties
SHALL be undoable; snapshots keyed by payload `sceneId`.

#### Scenario: DM captures, player bypasses

- GIVEN a DM socket and a player socket on a scene with a `movableByPlayers` token
- WHEN the DM emits `updateToken` then the player emits `updateToken {x,y}`
- THEN only the DM mutation records a pre-mutation snapshot, keyed by payload `sceneId`

### Requirement: Scene-Level Coalescing

Same-scene mutations within a ~300 ms inactivity window SHALL collapse into ONE
step via a per-scene `pending { before_snapshot, last_touch_ms }`; a lazy sweep
finalizes expired pending on each incoming mutation.

#### Scenario: Multi-token drag is one undo step

- GIVEN a DM selecting tokens A and B
- WHEN the DM drags both, emitting many `updateToken` within 300 ms
- THEN all emits collapse into one step with the pre-drag snapshot

### Requirement: Undo

An `undo` handler (DM-only, Ctrl+Z + tool-tray button) MUST pop the active
scene's snapshot, replace `scene["tokens"]`, `save_scene`, and broadcast
`sceneData` (full to `dm`, hidden-filtered to `player`) to ALL clients. Player
moves in a restored snapshot revert; initiative MUST NOT. An empty stack is a
no-op.

#### Scenario: Ctrl+Z reverts a drag across all clients

- GIVEN a DM with one undo step and connected players
- WHEN the DM emits `undo`
- THEN the token snaps back and every client receives `sceneData` and rebuilds

### Requirement: Redo

A `redo` handler (DM-only, Ctrl+Shift+Z + tool-tray button) MUST pop the redo
stack and restore identically to undo. Any new mutation after an undo MUST
clear the redo stack.

#### Scenario: Redo restores, then new mutation clears stack

- GIVEN a DM who undid one step (redo stack non-empty)
- WHEN the DM emits `redo` then performs a new `updateToken`
- THEN the undone state is restored and broadcast, then the redo stack clears

### Requirement: Depth Limit and Persistence

The undo stack MUST cap at 50 steps per scene, FIFO-discarding the oldest on
overflow. History is in-memory only, MUST NOT persist to disk, and is lost on
server restart.

#### Scenario: FIFO eviction at 50 steps

- GIVEN a scene whose undo stack is full at 50 steps
- WHEN a mutation adds a 51st step
- THEN the oldest step is discarded and the stack stays 50 deep

### Requirement: Deferred Upload Deletion

`removeToken` MUST NOT delete the upload immediately; the removed `imageUrl`
SHALL purge only when its snapshot leaves history (FIFO eviction or redo-stack
clearing). Undo of a delete restores a valid image; undo of an add removes only
the token reference.

#### Scenario: Undo of delete restores image, eviction purges

- GIVEN a DM who removed a token with an uploaded image
- WHEN the DM undoes before eviction, then 50 more mutations evict the snapshot
- THEN the image is restored on undo and the file is purged on eviction

### Requirement: undoRedoState Event and Button State

After each mutation/undo/redo the server MUST emit additive
`undoRedoState { canUndo, canRedo }` to the DM without altering existing payload
shapes. Buttons SHALL be disabled (greyed, non-clickable) when no history exists
in that direction.

#### Scenario: Buttons reflect stack availability

- GIVEN a DM with one undo step and an empty redo stack
- WHEN the server emits `undoRedoState { canUndo: true, canRedo: false }`
- THEN undo is enabled and redo is greyed and non-clickable

### Requirement: Thread Safety

A single `threading.Lock` MUST guard all history state (per-scene stacks,
coalescing `pending`, timestamps); all capture, sweep, undo, and redo SHALL run
under it.

#### Scenario: Concurrent mutations stay consistent

- GIVEN two DM mutations on separate worker threads
- WHEN both attempt to capture near-simultaneously
- THEN the lock serializes them and history stays consistent

### Requirement: Cross-Scene History

History MUST be keyed by `sceneId`, global per-scene (not per-socket). Undo/redo
SHALL target the active scene; a payload `sceneId` ≠ active scene captures under
the payload id but undoes the active scene, flagging the mismatch.

#### Scenario: Undo targets active scene after switch

- GIVEN the DM switched from scene A (with history) to scene B
- WHEN the DM emits `undo`
- THEN scene B's last step is undone, not scene A's

### Requirement: Non-Goals

Music, DM sticky notes, initiative, grid toggle, background color, and scene
create/delete/duplicate/reorder MUST NOT enter token-property history.
Initiative SHALL NOT revert on undo.

#### Scenario: Initiative unaffected by undo

- GIVEN a DM who updated initiative then moved a token
- WHEN the DM emits `undo`
- THEN the token move reverts but initiative state is unchanged
