(function () {
  const config = {
    colors: {
      initiative: '#ff7a18',
      roll: '#ff7a18',
    },
    outline: {
      color: '#000000',
      size: 3,
    },
    durationMs: 3500,
  };

  function show(text, options = {}) {
    const overlay = document.getElementById('player-flourish');
    const name = document.getElementById('player-flourish-name');
    if (!overlay || !name) return;

    const type = options.type || 'initiative';
    const color = options.color || config.colors[type] || config.colors.initiative;

    name.textContent = text;
    name.style.color = color;
    applyTextOutline(name, color, {
      color: options.outlineColor || config.outline.color,
      size: options.outlineSize || config.outline.size,
    });

    overlay.classList.remove('hidden');
    name.style.animation = 'none';
    void name.offsetWidth;
    name.style.animation = '';

    clearTimeout(window._flourishTimer);
    window._flourishTimer = setTimeout(
      () => overlay.classList.add('hidden'),
      options.durationMs || config.durationMs
    );
  }

  function applyTextOutline(element, glowColor, outline) {
    const color = outline.color;
    const size = Number.parseInt(outline.size, 10) || 3;
    const offsets = [
      [-size, -size], [0, -size], [size, -size],
      [-size, 0],                 [size, 0],
      [-size, size],  [0, size],  [size, size],
    ];

    element.style.textShadow = [
      ...offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`),
      `0 0 10px ${glowColor}`,
      `0 0 28px ${glowColor}`,
    ].join(', ');
  }

  window.VTT_CALLOUT_CONFIG = config;
  window.VTT_CALLOUTS = { show };
})();
