# Design: Fog of War – Tier 2 (Vision Radius)

## Technical Approach

Add two optional token properties, `visionRadius` (pixels, ≥0) and `isMap` (boolean), to the server-side `TokenDict` and front-end JSDoc. The back-end already persists any key/value pair passed through `updateToken` or `addToken`, so no new Socket.IO events are required. Player view renders a full-viewport fog canvas above tokens with transparent radial holes at every visible, non-map token whose `visionRadius > 0`. DM view skips the fog canvas entirely. The existing Token Status popup gains inputs for vision radius (in grid cells) and a Map toggle; setting a token as a map auto-locks it and pushes it to a background z-layer. Undo/redo continues to work because `SceneHistory` snapshots the full token list.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Fog renderer location | Extend `public/js/sceneRenderer.js` with `FogOverlay` methods | New `public/js/fogOfWar.js` module | Keeps public/js edits minimal per frontend-parity constraint and reuses the renderer's existing pan/zoom/resize lifecycle. |
| Fog composition | Canvas `destination-out` radial gradients over a dark fill layer | Multiple inverted radial gradient elements or SVG mask | `destination-out` is one draw call per vision source, naturally accumulates overlapping vision, and scales with the existing transform. |
| Vision coordinate space | Store `visionRadius` in world pixels; render holes using `(x+offsetX)*scale` | Store radius in grid cells | Avoids re-computing on every zoom and matches existing token positioning math. |
| Map z-ordering | Assign `zIndex = -1000` when `isMap` is applied | Introduce a separate DOM layer for maps | Reuses the existing z-index sort in `renderScene` with minimal code. |
| Validation | Coerce `visionRadius` to `max(0, float(...))` and `isMap` to `bool(...)` in `SceneStore.update_token` | Reject invalid updates | Matches the current permissive mutation style and prevents corrupt scene JSON. |

## Data Flow

```
DM status popup ──updateToken──┐
DM keyboard/undo ──────────────┤
Player drag (x,y only) ────────┼──► app.py update_token ──► scene JSON
Token drop/addToken ───────────┤         │
                                         ▼
                              broadcast updateToken / sceneData
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                               ▼
            DM renderer (no fog)                         Player renderer
                                                         fog overlay canvas
                                                         destination-out holes
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app.py` | Modify | Add `isMap` and `visionRadius` to `TokenDict`; validate/coerce in `update_token`; `socket_add_token_from_library` defaults unchanged. |
| `public/js/sceneManager.js` | Modify | Extend JSDoc `TokenDict` with `isMap` and `visionRadius`. |
| `public/js/sceneRenderer.js` | Modify | Add fog canvas creation, `drawFog()`, and hook into `renderScene`/`updateAllTokenElements` for players only. |
| `public/dm.html` | Modify | Add vision-radius and map-token inputs to `#token-status-popup`. |
| `public/js/tokenTool.js` | Modify | Read/write new popup fields; emit `visionRadius` in pixels (`cells * VTT_GRID_SIZE`); toggle `isMap`, `locked`, and background `zIndex`. |
| `tests/test_smoke.py` | Modify | Add smoke tests for property round-trip and player-filtered scene data. |

## Interfaces / Contracts

### Python `TokenDict`

```python
class TokenDict(_TokenDictRequired, total=False):
    name: str
    locked: bool
    isPaintTile: bool
    isAreaEffect: bool
    isMap: bool
    visionRadius: float
    ...
```

### Validation in `SceneStore.update_token`

```python
if "visionRadius" in properties:
    properties["visionRadius"] = max(0.0, float(properties["visionRadius"]))
if "isMap" in properties:
    properties["isMap"] = bool(properties["isMap"])
```

### JSDoc `TokenDict`

```js
/**
 * @property {boolean} [isMap]
 * @property {number}  [visionRadius]
 */
```

### Fog overlay CSS contract

- Canvas is appended to `#scene-container`, `position:absolute; top:0; left:0; pointer-events:none; z-index:100;`
- Canvas dimensions match viewport size; drawing uses world coordinates transformed by current pan/zoom.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit / Integration | `updateToken` persists `visionRadius` and `isMap` | Use `dm_client` to create scene, emit Socket.IO `addToken`, then `updateToken`; load scene JSON and assert values round-trip. |
| Integration | Player `sceneData` excludes hidden tokens, includes vision properties for visible tokens | Use `player_client` with active scene; emit `loadScene` and assert received token has `visionRadius`/`isMap`. |
| Regression | Existing smoke tests still pass | Run `pytest tests/test_smoke.py`. |

## Migration / Rollout

No migration required. Legacy tokens without the new keys default to `visionRadius` absent / `0` and `isMap` absent / `false`. Existing scene JSON loads and persists unchanged until a DM edits the new fields.

## Open Questions

- None.
