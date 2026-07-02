# Design: Fog of War – Line of Sight & Walls

## Technical Approach

Store wall segments as an optional `walls: WallDict[]` array per scene. The server persists them, sends them to DMs, and omits them from player `sceneData`. DM edits use additive events (`addWall`, `updateWall`, `removeWall`, `clearWalls`) that mutate the scene and rebroadcast to DM clients only, preserving player payload shapes.

Player client computes wall-aware visibility polygons for each vision-source token and punches them out of the fog canvas with `destination-out` compositing. Walls render as faint lines on a DM-only SVG overlay.

> Walls reach players only through a separate `wallsData` event for fog math; `sceneData` stays unchanged.

## Architecture Decisions

| Decision | Chosen | Rationale |
|----------|--------|-----------|
| Wall storage | Inline `walls` array in scene JSON | Reuses `SceneStore` lifecycle and scene duplication. |
| Wall sync | New Socket.IO events | Preserves payload shapes and per-mutation history. |
| LOS compute | Player client raycast | Avoids server work; data supplied via `wallsData`. |
| Wall delivery to players | Separate `wallsData` event | Keeps `sceneData` shape; feeds fog renderer. |
| Wall rendering | SVG overlay | Cheap and survives DOM wipe. |
| Snap-to-grid | Snap on drag end | Matches token placement UX. |

## Data Flow

DM tool emits wall events to `app.py`; the server snapshots history (tokens + walls), persists to scene JSON, broadcasts wall deltas to the DM room, and sends `wallsData` to players so the fog renderer can redraw.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app.py` | Modify | Add `WallDict`/`SceneDict.walls`; wall CRUD handlers; strip `walls` from player `sceneData`; include `walls` in history; emit `wallsData`. |
| `public/js/wallsTool.js` | Create | DM wall tool: tray button, panel, draw/erase/clear, snap, preview, endpoint move, delete. |
| `public/js/sceneRenderer.js` | Modify | DM wall SVG overlay; player `drawFog()` uses visibility polygons. |
| `public/js/sceneManager.js` | Modify | Track `currentScene.walls`; handle wall socket events; redraw overlay/fog. |
| `public/dm.html` | Modify | Walls tray button/panel, include `wallsTool.js`. |
| `public/js/dmControls.js` | Modify | Wire tray/panel toggle. |
| `public/css/dm.css` | Modify | Wall preview, selected endpoint, overlay styles. |
| `tests/test_smoke.py` | Modify | Wall CRUD, history, player payload-filtering tests. |

## Interfaces / Contracts

### Python types (`app.py`)

```python
class WallDict(TypedDict):
    wallId: str
    x1: float
    y1: float
    x2: float
    y2: float

class SceneDict(_SceneDictRequired, total=False):
    order: int
    walls: List[WallDict]
```

### Socket.IO events

| Event | Direction | Payload | Behaviour |
|-------|-----------|---------|-----------|
| `addWall` | DM → server → DM | `{sceneId, wall}` | Append wall; snapshot; save; broadcast to DM room. |
| `updateWall` | DM → server → DM | `{sceneId, wallId, x1, y1, x2, y2}` | Mutate endpoints; save; broadcast to DM room. |
| `removeWall` | DM → server → DM | `{sceneId, wallId}` | Remove wall; save; broadcast to DM room. |
| `clearWalls` | DM → server → DM | `{sceneId}` | Empty `walls`; save; broadcast to DM room. |
| `wallsData` | Server → players | `{sceneId, walls}` | Sent on player `loadScene` and after wall changes; used only for LOS math. |
| `sceneData` | Server → all | existing shape; no walls for players | Unchanged payload contract. |

### History snapshot

```python
{
    "tokens": [...],
    "walls": [...],
    "deleted_image_urls": [...],
}
```

`SceneHistory.before_mutation` snapshots both `tokens` and `walls`; undo/redo restore both.

### Visibility algorithm

For each vision source, cast rays toward every wall endpoint plus small angular offsets (`±ε`) to avoid slivers, intersect each ray with all walls, keep the nearest hit capped by `visionRadius`, sort hits by angle, and draw the resulting polygon with `destination-out` compositing.

Performance: cap rays per source and skip recomputation on pan/zoom when walls/tokens are static.

## Testing Strategy

| Layer | What to test | Approach |
|-------|--------------|----------|
| Smoke | Wall CRUD persists | Emit `addWall`, assert `scene_store.load_scene().walls`. |
| Smoke | Payload filtering | DM `loadScene` has walls; player `loadScene` lacks walls. |
| Smoke | Wall undo/redo | Add wall → `undo` removed; `redo` restored. |
| Smoke | `updateWall` / `clearWalls` | Emit events; assert scene state. |
| Manual | DM draw & player occlusion | Two browsers: wall between token and point; point stays fogged. |

## Migration / Rollout

No migration required. `walls` is optional; legacy scenes load as `[]`. Rolling back reverts the changed files; any leftover `walls` arrays in scene JSON are ignored by older code.

## Open Questions

- [ ] The spec says wall geometry must not reach players, but client-side LOS requires it. The proposed `wallsData` event preserves the `sceneData` contract. If absolute secrecy is required, LOS must move server-side.
- [ ] Should walls duplicate with scenes? Recommended: yes, via the existing deep copy in `/duplicateScene`.
