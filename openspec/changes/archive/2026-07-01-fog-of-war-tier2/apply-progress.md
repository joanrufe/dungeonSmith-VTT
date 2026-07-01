# Apply Progress: Fog of War – Tier 2 (Vision Radius)

**Change**: fog-of-war-tier2
**Mode**: Standard (strict_tdd: false)
**Status**: 15/16 tasks complete — ready for verify (task 5.2 is a manual browser check)

## Completed Tasks

- [x] 1.1 Add `isMap` and `visionRadius` to `TokenDict` in `app.py`
- [x] 1.2 Validate/coerce `visionRadius` and `isMap` in `SceneStore.update_token`
- [x] 2.1 Add JSDoc properties to `TokenDict` in `public/js/sceneManager.js`
- [x] 2.2 Add vision-radius input and Map toggle to `#token-status-popup` in `public/dm.html`
- [x] 2.3 Read new fields and emit `visionRadius` (pixels) and `isMap` from `tokenTool.js`
- [x] 2.4 When `isMap` is set, emit `locked: true` and `zIndex: -1000`
- [x] 3.1 Create full-viewport fog `<canvas>` in `sceneRenderer.js` for players only
- [x] 3.2 Implement `drawFog()` with dark fill + `destination-out` radial gradients
- [x] 3.3 Call `drawFog()` from `renderScene()` and `updateAllTokenElements()` (players only)
- [x] 3.4 Add `ResizeObserver` to keep fog canvas sized to viewport
- [x] 4.1 Add `dm_socket` and `player_socket` fixtures to `tests/conftest.py`
- [x] 4.2 Add `test_vision_radius_and_is_map_round_trip` smoke test
- [x] 4.3 Add `test_player_scene_data_excludes_hidden_exposes_vision` smoke test
- [x] 4.4 Run `pytest tests/test_smoke.py` — 12/12 passed
- [x] 5.1 Run `python -m py_compile app.py` — exit code 0
- [ ] 5.2 Manual browser check (not automated — left for sdd-verify)

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `app.py` | Modified | Added `isMap: bool` and `visionRadius: float` to `TokenDict`; added coerce/validate logic in `SceneStore.update_token` |
| `public/js/sceneManager.js` | Modified | Extended `TokenDict` JSDoc with `@property {boolean} [isMap]` and `@property {number} [visionRadius]` |
| `public/dm.html` | Modified | Added Vision (cells input) and Map (checkbox) rows to `#token-status-popup` |
| `public/js/tokenTool.js` | Modified | Reads `tsp-vision-radius` and `tsp-is-map`; populates them on open; emits `visionRadius` (cells×gridSize), `isMap`, `locked`, `zIndex` when map flag is set |
| `public/js/sceneRenderer.js` | Modified | Added `_ensureFogCanvas()`, `_resizeFogCanvas()`, `_attachFogResizeObserver()`, `drawFog()`; hooked into `renderScene()` and `updateAllTokenElements()` for player view |
| `tests/conftest.py` | Modified | Added `dm_socket` and `player_socket` fixtures using `SocketIOTestClient` |
| `tests/test_smoke.py` | Modified | Added 3 new fog-of-war smoke tests |

## Test Results

```
12 passed in 0.09s
```

All 9 original tests + 3 new fog tests pass.

## Deviations from Design

None — implementation matches `design.md` exactly.

## Workload / PR Boundary

- Mode: single PR
- Estimated changed lines: ~220 (within 250-line forecast, within 1200-line budget)
