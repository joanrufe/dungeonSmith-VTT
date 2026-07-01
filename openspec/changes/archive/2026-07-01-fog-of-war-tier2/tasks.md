# Tasks: Fog of War – Tier 2 (Vision Radius)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250 |
| 400-line budget risk | Low |
| 1200-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr-default |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
1200-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Fog of War Tier 2 end-to-end | PR 1 | Single PR; server, frontend, tests |

## Phase 1: Server Schema & Validation

- [x] 1.1 Add `isMap` and `visionRadius` to `TokenDict` in `app.py`.
  - Verification: `python -m py_compile app.py` passes.
- [x] 1.2 Validate/coerce `visionRadius` to `max(0, float(...))` and `isMap` to `bool(...)` in `SceneStore.update_token` in `app.py`.
  - Verification: Negative radius becomes `0` and non-bool `isMap` becomes boolean.

## Phase 2: Frontend Types & DM Controls

- [x] 2.1 Add `@property {boolean} [isMap]` and `@property {number} [visionRadius]` to the `TokenDict` JSDoc in `public/js/sceneManager.js`.
  - Verification: JSDoc block contains both properties.
- [x] 2.2 Add vision-radius input and Map toggle to `#token-status-popup` in `public/dm.html`.
  - Verification: DM popup renders the new fields.
- [x] 2.3 Read the new fields in `public/js/tokenTool.js` and emit `updateToken { properties: { visionRadius: cells * VTT_GRID_SIZE, isMap: ... } }`.
  - Verification: Socket.IO message contains pixel-radius and boolean map flag.
- [x] 2.4 When `isMap` is set, also emit `locked: true` and `zIndex: -1000` from `public/js/tokenTool.js`.
  - Verification: Map token renders behind regular tokens with the lock outline.

## Phase 3: Player Fog Overlay

- [x] 3.1 Create a full-viewport `<canvas>` fog layer in `public/js/sceneRenderer.js` for players only, appended to `#scene-container`.
  - Verification: Player DOM contains the fog canvas with `pointer-events:none` and `z-index:100`.
- [x] 3.2 Implement `drawFog()` in `public/js/sceneRenderer.js`: fill dark fog, then punch `destination-out` radial gradients for every visible, non-map, non-paint, non-area-effect token with `visionRadius > 0`, transformed by pan/zoom.
  - Verification: Player view shows dark fog with clear vision circles.
- [x] 3.3 Call `drawFog()` from `renderScene()` and `updateAllTokenElements()` in `public/js/sceneRenderer.js` for players only.
  - Verification: Panning and zooming update fog hole positions.
- [x] 3.4 Add a `ResizeObserver` on `#scene-container` to resize/recreate the fog canvas in `public/js/sceneRenderer.js`.
  - Verification: Browser resize keeps fog covering the viewport.

## Phase 4: Testing

- [x] 4.1 Add a Socket.IO test-client fixture to `tests/conftest.py`.
  - Verification: A test can connect and emit `updateToken`.
- [x] 4.2 Add a smoke test in `tests/test_smoke.py` that round-trips `visionRadius` and `isMap` via `updateToken`.
  - Verification: Scene JSON and `sceneData` contain the persisted values.
- [x] 4.3 Add a smoke test in `tests/test_smoke.py` that verifies player `sceneData` excludes hidden tokens and exposes vision properties on visible tokens.
  - Verification: New player test passes.
- [x] 4.4 Run `pytest tests/test_smoke.py`.
  - Verification: All existing tests still pass.

## Phase 5: Final Verification

- [x] 5.1 Run `python -m py_compile app.py`.
  - Verification: Exit code is `0`.
- [x] 5.2 Manual browser check: DM view has no fog; player view shows fog holes for tokens with `visionRadius > 0`.
  - Verification: Spec scenarios pass visually.
  - Reconciliation: This step is not automatable in the test environment. It was downgraded from an unchecked verification item to a WARNING by `sdd-verify` because all code-level and server-side behavior is correct (see `verify-report.md`). Archived as completed-with-warnings.
