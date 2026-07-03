// tests/js/rotationOverlayMath.test.mjs
// These tests run under Node and exercise the pure geometry helper.

import { computeRotationOverlayPositions, snapRotation } from '../../public/js/rotationOverlayMath.js';
import assert from 'node:assert';

function approx(actual, expected, epsilon = 1e-6) {
  const diff = Math.abs(actual - expected);
  if (diff > epsilon) {
    throw new Error(`expected ${expected} ± ${epsilon}, got ${actual}`);
  }
}

// ── computeRotationOverlayPositions ───────────────────────────────────────

{
  const token = {
    x: 100,
    y: 100,
    width: 60,
    height: 60,
    rotation: 0,
  };
  const p = computeRotationOverlayPositions(token, 1, 0, 0);

  // Center of a 60×60 token at (100, 100).
  approx(p.cx, 130);
  approx(p.cy, 130);
  // With no rotation the handle sits above the top edge.
  approx(p.topX, 130);
  approx(p.topY, 100);
  approx(p.handleX, 130);
  approx(p.handleY, 100 - 24);
}

{
  const token = {
    x: 0,
    y: 0,
    width: 40,
    height: 80,
    rotation: 90,
  };
  // Zoomed in 2× and panned by (10, 20).
  const p = computeRotationOverlayPositions(token, 2, 10, 20, 24);

  // Center: ((0 + 40/2 + 10) * 2, (0 + 80/2 + 20) * 2)
  approx(p.cx, 60);
  approx(p.cy, 120);

  // 90° rotation points the top edge to the right.
  // Half-height (long side) scaled: (80/2) * 2 = 80.
  approx(p.topX, 140);
  approx(p.topY, 120);
  approx(p.handleX, 140 + 24);
  approx(p.handleY, 120);
}

{
  // Handle offset is configurable.
  const token = {
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    rotation: 180,
  };
  const p = computeRotationOverlayPositions(token, 1, 0, 0, 10);

  approx(p.topX, 20);
  approx(p.topY, 40);
  approx(p.handleX, 20);
  approx(p.handleY, 50);
}

// ── snapRotation ─────────────────────────────────────────────────────────

assert.equal(snapRotation(37, false), 30, 'default snaps to nearest 15°');
assert.equal(snapRotation(38, false), 45, 'default snaps up to next 15°');
assert.equal(snapRotation(44, false), 45, 'default snaps up near boundary');
assert.equal(snapRotation(-7, false), 0, 'default snaps negative toward zero');
assert.equal(snapRotation(37.6, true), 38, 'Shift disables snap and rounds to integer');
assert.equal(snapRotation(37.2, true), 37, 'Shift rounds down to integer');
assert.equal(snapRotation(-37.6, true), -38, 'Shift keeps sign when rounding');

console.log('rotationOverlayMath tests passed');
