// public/js/rotationOverlayMath.js
// Pure geometry helpers for the rotation overlay. Kept separate to stay testable.

/** @typedef {import('./sceneManager.js').TokenDict} TokenDict */

/**
 * Compute the screen-space positions of the rotation marker, line, and drag handle.
 *
 * @param {TokenDict} token
 * @param {number} scale
 * @param {number} offsetX
 * @param {number} offsetY
 * @param {number} [handleOffset]
 * @returns {{
 *   cx: number,
 *   cy: number,
 *   rotation: number,
 *   topX: number,
 *   topY: number,
 *   handleX: number,
 *   handleY: number,
 * }}
 */
export function computeRotationOverlayPositions(token, scale, offsetX, offsetY, handleOffset = 24) {
  const cx = (token.x + token.width / 2 + offsetX) * scale;
  const cy = (token.y + token.height / 2 + offsetY) * scale;
  const rotation = token.rotation || 0;
  const rad = (rotation * Math.PI) / 180;

  // Unit vector pointing to the token's rotated top edge.
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);

  const halfH = (token.height / 2) * scale;
  const topX = cx + dirX * halfH;
  const topY = cy + dirY * halfH;
  const handleX = topX + dirX * handleOffset;
  const handleY = topY + dirY * handleOffset;

  return { cx, cy, rotation, topX, topY, handleX, handleY };
}

/**
 * Snap a rotation value to the user-facing precision.
 *
 * @param {number} rotation
 * @param {boolean} shiftKey
 * @returns {number}
 */
export function snapRotation(rotation, shiftKey) {
  if (shiftKey) {
    return Math.round(rotation);
  }
  return Math.round(rotation / 15) * 15;
}
