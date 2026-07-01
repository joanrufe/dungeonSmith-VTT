# Spec: Fog of War – Tier 2 (Vision Radius)

## Requirements

### Requirement: Token Vision Properties

The token schema SHALL accept optional `isMap` (boolean, default `false`) and `visionRadius` (non-negative number, default `0`). `visionRadius: 0` means no vision; `isMap` marks a background map token.

#### Scenario: Vision properties persist through update flow

- GIVEN a scene with a token
- WHEN the DM emits `updateToken { properties: { visionRadius: 150, isMap: false } }`
- THEN the server persists the properties in `data/scenes/{sceneId}.json`
- AND rebroadcasts them via `updateToken` without changing payload shape

#### Scenario: Missing vision radius means no vision

- GIVEN a token with no `visionRadius` property
- WHEN the player view renders
- THEN the token MUST NOT create a vision hole

### Requirement: Player Fog Overlay

The player view (`isDM === false`) MUST render a canvas-based fog overlay above all tokens, covering the viewport with dark fog and punching transparent circular holes centered on every non-hidden token with `visionRadius > 0`, scaled by current zoom.

#### Scenario: Vision sources reveal clear circles

- GIVEN a player view with one token whose `visionRadius` is `120` and another hidden token whose `visionRadius` is `80`
- WHEN the scene renders
- THEN the visible token clears a circle of radius `120` and the hidden token clears nothing

### Requirement: DM View Exemption

The DM view (`isDM === true`) MUST NOT render the fog overlay.

#### Scenario: DM sees through fog

- GIVEN a DM view with tokens whose `visionRadius > 0`
- WHEN the scene renders
- THEN no fog canvas is attached and all tokens remain fully visible

### Requirement: Map Token Behavior

Tokens with `isMap: true` SHALL be background maps: non-movable by players, locked by default, rendered below regular tokens, and SHALL NOT be treated as vision sources.

#### Scenario: Map token is background and not a vision source

- GIVEN a scene with an `isMap` token whose `visionRadius` is `100`, overlapped by a regular token
- WHEN the player view renders
- THEN the regular token appears above the map and no vision hole is created for the map

### Requirement: DM Vision Radius Control

The DM Token Status popup MUST expose an input to set `visionRadius` on selected token(s). The input SHALL accept a non-negative number of grid cells and emit `updateToken { properties: { visionRadius: value * VTT_GRID_SIZE } }` through the existing Socket.IO flow.

#### Scenario: DM sets vision radius in grid cells

- GIVEN the DM selects a token and opens the Token Status popup
- WHEN the DM enters `3` grid cells and applies
- THEN the client emits `updateToken { properties: { visionRadius: 3 * VTT_GRID_SIZE } }`
- AND the player view shows a new fog hole after rebroadcast

### Requirement: Socket.IO and HTTP Compatibility

No existing Socket.IO event or HTTP response payload shape SHALL change. `visionRadius` and `isMap` MUST travel as ordinary token properties inside existing `updateToken`, `addToken`, `sceneData`, and scene JSON payloads.

### Requirement: Undo/Redo Compatibility

`visionRadius` and `isMap` changes MUST participate in existing `SceneHistory` token snapshots. Undo and redo of a vision-radius change SHALL revert or restore the value like any other token property mutation.

#### Scenario: Undo reverts vision radius

- GIVEN a DM who changed a token's `visionRadius` from `0` to `120`
- WHEN the DM emits `undo`
- THEN the token's `visionRadius` returns to `0` and the player fog overlay updates

### Requirement: Test Coverage

The project SHALL add pytest smoke tests for token property persistence and fog-aware scene responses. Existing smoke tests MUST continue to pass.

#### Scenario: New properties round-trip and existing tests stay green

- GIVEN a fresh scene with a token
- WHEN a test client emits `updateToken { properties: { visionRadius: 100, isMap: true } }`
- THEN the scene JSON and `sceneData` response contain the same values
- AND existing smoke tests still pass unchanged
