# Delta Spec: Fog of War – Line of Sight & Walls

## wall-management (NEW)

### Requirement: Wall Schema

The scene JSON schema SHALL accept an optional `walls: WallDict[]`. Each WallDict SHALL contain `wallId`, `x1`, `y1`, `x2`, `y2`. Legacy scenes without `walls` SHALL load as `[]`.

#### Scenario: Wall round-trip

- GIVEN a scene with wall `{wallId:"w1",x1:0,y1:0,x2:100,y2:0}`
- WHEN the server saves and reloads
- THEN the wall array persists unchanged

### Requirement: DM Wall Drawing

The DM MUST draw walls by click-drag. Snap-to-grid SHOULD be available.

#### Scenario: DM draws a wall

- GIVEN the wall tool is active
- WHEN the DM drags from `(50,50)` to `(150,50)`
- THEN a new WallDict is emitted and rendered

### Requirement: Wall Editing

The DM MUST select, move endpoints, delete individual walls, and clear all walls.

#### Scenario: DM deletes a wall

- GIVEN two walls
- WHEN the DM selects one and presses Delete
- THEN only that wall is removed

### Requirement: DM-Only Wall Visibility

Wall geometry MUST NOT reach players; the DM SHALL see walls as faint lines.

#### Scenario: Player sceneData excludes walls

- GIVEN a scene with walls
- WHEN `sceneData` is sent to a player
- THEN the payload MUST NOT contain `walls`

## line-of-sight-visibility (NEW)

### Requirement: Visibility Polygon

For each vision source, the player client SHALL compute a visibility polygon bounded by `visionRadius` and walls. The algorithm SHOULD cast rays `±epsilon` around wall endpoints to avoid slivers.

#### Scenario: Wall blocks sight

- GIVEN a token with `visionRadius:200` and a wall blocking a point at distance `150`
- WHEN the player view renders
- THEN that point stays in fog

## fog-of-war-tier2 (MODIFIED)

### Requirement: Player Fog Overlay

The player view MUST render a fog overlay with transparent visibility polygons for non-hidden tokens with `visionRadius > 0`, clipped by walls and scaled by zoom.
(Previously: holes were unobstructed radial circles.)

#### Scenario: Wall-aware vision

- GIVEN a token with `visionRadius:120` and a nearby wall
- WHEN the scene renders
- THEN the revealed area is a clipped polygon, not a full circle

### Requirement: Compatibility

No existing Socket.IO or HTTP payload shape SHALL change; wall mutations SHALL use additive events.
(Previously: no wall fields existed.)

#### Scenario: Player payload shape unchanged

- GIVEN a scene with walls and tokens
- WHEN `sceneData` reaches a player
- THEN token payloads and top-level keys match pre-wall shapes

### Requirement: Test Coverage

The project SHALL add pytest smoke tests for wall CRUD, filtering, and occlusion. Existing tests MUST pass.
(Previously: tests covered only token vision properties.)

#### Scenario: Wall tests pass

- GIVEN a fresh scene with walls
- WHEN tests run wall CRUD and player filtering
- THEN DM payloads contain walls, player payloads omit them, and tests pass

## scene-history (MODIFIED)

### Requirement: Snapshot Capture

Snapshots MUST deep-copy `tokens` and `walls` before DM-initiated mutations.
(Previously: only `tokens` were captured.)

#### Scenario: Wall change captures previous walls

- GIVEN a scene with walls
- WHEN the DM adds a wall
- THEN the snapshot contains the prior `walls` array

### Requirement: Undo

`undo` MUST restore `tokens` and `walls`, save, and broadcast `sceneData`.
(Previously: only `tokens` were restored.)

#### Scenario: Undo reverts wall addition

- GIVEN a DM who added a wall
- WHEN `undo` is emitted
- THEN the wall disappears

### Requirement: Redo

`redo` MUST restore `tokens` and `walls` identically to undo.
(Previously: only `tokens` were restored.)

#### Scenario: Redo restores deleted wall

- GIVEN a DM who undid a wall deletion
- WHEN `redo` is emitted
- THEN the wall reappears

### Requirement: Non-Goals

Music, notes, initiative, grid, background color, and scene CRUD MUST NOT enter history; walls ARE in scope.
(Previously: walls were not mentioned.)

#### Scenario: Initiative unaffected

- GIVEN initiative updated then a wall added
- WHEN `undo` is emitted
- THEN the wall reverts but initiative is unchanged
