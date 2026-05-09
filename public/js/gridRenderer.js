(function () {
  const DEFAULT_COLOR = 'rgba(255,255,255,0.5)';
  const patternCache = new Map();

  function drawGrid(canvas, options = {}) {
    if (!canvas) return;

    const size = Math.max(1, Number(options.size) || 60);
    const type = options.type === 'hex' ? 'hex' : 'square';
    const color = options.color || DEFAULT_COLOR;
    const signature = `${type}:${size}:${color}:${canvas.width}x${canvas.height}`;
    if (canvas.dataset.gridSignature === signature) return;

    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pattern = getPattern(ctx, type, size, color);
    if (!pattern) return;

    ctx.save();
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    canvas.dataset.gridSignature = signature;
  }

  function getPattern(ctx, type, size, color) {
    const key = `${type}:${size}:${color}`;
    let tile = patternCache.get(key);

    if (!tile) {
      tile = type === 'hex'
        ? buildHexTile(size, color)
        : buildSquareTile(size, color);
      patternCache.set(key, tile);
    }

    return ctx.createPattern(tile, 'repeat');
  }

  function buildSquareTile(size, color) {
    const canvas = document.createElement('canvas');
    const lineWidth = 1;
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, size);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(size, 0.5);
    ctx.stroke();

    return canvas;
  }

  function buildHexTile(size, color) {
    const radius = size / 2;
    const hexHeight = Math.sqrt(3) * radius;
    const xStep = radius * 1.5;
    const tileWidth = Math.ceil(xStep * 2);
    const tileHeight = Math.ceil(hexHeight * 2);

    const canvas = document.createElement('canvas');
    canvas.width = tileWidth;
    canvas.height = tileHeight;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const points = getHexPointOffsets(radius);
    for (let x = radius - xStep * 2; x <= tileWidth + xStep * 2; x += xStep) {
      const col = Math.round((x - radius) / xStep);
      const yOffset = Math.abs(col % 2) ? hexHeight / 2 : 0;

      for (let y = radius + yOffset - hexHeight * 2; y <= tileHeight + hexHeight * 2; y += hexHeight) {
        drawHexPath(ctx, x, y, points);
      }
    }

    ctx.stroke();
    return canvas;
  }

  function getHexPointOffsets(radius) {
    const points = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.PI / 180 * (60 * i);
      points.push({
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    }
    return points;
  }

  function drawHexPath(ctx, cx, cy, points) {
    points.forEach((point, index) => {
      const x = cx + point.x;
      const y = cy + point.y;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }

  window.VTT_GRID_RENDERER = {
    drawGrid,
    clearCache() {
      patternCache.clear();
    },
  };
})();
