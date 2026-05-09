// public/js/diceRoller.js
// ES Module — deferred by spec, runs after HTML is parsed.
import DiceBox from '/lib/dice-box-threejs/dice-box-threejs.es.js';

// ── DOM refs ──────────────────────────────────────────────
const statusEl       = document.getElementById('dice-status');
const resultLog      = document.getElementById('dice-result-log');
const silentCheck    = document.getElementById('dice-silent-check');
const colorsetSelect = document.getElementById('dice-colorset-select');
const customInput    = document.getElementById('dice-custom-input');
const customBtn      = document.getElementById('dice-custom-roll-btn');

let diceBox        = null;
let socket         = null;
let autoClearTimer = null;
let pendingResult  = null; // result stored until onRollComplete fires

// ── Helpers ───────────────────────────────────────────────
function updateStatus(text, color = '#888') {
  if (statusEl) { statusEl.innerText = text; statusEl.style.color = color; }
}

function showFlourish(text, color) {
  if (window.VTT_CALLOUTS) {
    window.VTT_CALLOUTS.show(text, { type: 'roll', color });
  }
}

function showResult(text, color = '#4CAF50') {
  if (resultLog) { resultLog.innerText = `Last Roll: ${text}`; resultLog.style.color = color; }
  showFlourish(text, color);
}

// ── Socket discovery ──────────────────────────────────────
function findSocket() {
  if (window.VTT_DM?.socket) {
    socket = window.VTT_DM.socket;
  } else if (window.VTT_PLAYER?.socket) {
    socket = window.VTT_PLAYER.socket;
  } else {
    setTimeout(findSocket, 500);
    return;
  }

  if (!socket._diceAttached) {
    socket._diceAttached = true;
    // Server sends { notation, colorset } — apply roller's style then animate
    socket.on('diceRolled', async (data) => {
      if (!diceBox) return;
      const notation = typeof data === 'string' ? data : data.notation;
      const colorset = typeof data === 'object' ? (data.colorset || 'white') : 'white';
      try {
        await diceBox.updateConfig({ theme_colorset: colorset, theme_texture: '' });
      } catch (_) {}
      diceBox.roll(notation);
    });
    socket.on('diceCleared', () => { if (diceBox) diceBox.clearDice(); });
    // Store result — displayed when onRollComplete fires (after dice settle)
    socket.on('diceResult', (data) => { pendingResult = data; });
  }
}

// ── DiceBox initialisation ────────────────────────────────
async function initDiceBox() {
  updateStatus('Initializing…');

  try {
    if (diceBox) { try { diceBox.clearDice(); } catch (_) {} diceBox = null; }

    const instance = new DiceBox('#dice-box-container', {
      assetPath:          '/lib/dice-box-threejs/assets/',
      theme_colorset:     colorsetSelect?.value ?? 'white',
      theme_texture:      '',
      theme_material:     'glass',
      gravity_multiplier: 400,
      baseScale:          100,
      strength:           1,
      shadows:            true,
      sounds:             false,
      onRollComplete: () => {
        // Show result after dice physically settle — same timing on all clients
        if (pendingResult) {
          showResult(pendingResult.text, pendingResult.color);
          pendingResult = null;
        }
        // Auto-clear after 30 s
        clearTimeout(autoClearTimer);
        autoClearTimer = setTimeout(() => {
          if (diceBox) diceBox.clearDice();
          if (socket && !silentCheck?.checked) socket.emit('clearDice');
        }, 30000);
      },
    });

    await instance.initialize();
    diceBox = instance;
    updateStatus('Ready', '#4CAF50');
  } catch (err) {
    diceBox = null;
    updateStatus('Error – see console', '#f44336');
    console.error('[DiceRoller] init failed:', err);
  }
}

// ── Roll handler ──────────────────────────────────────────
function handleRoll(notation) {
  if (!notation) return;
  if (!socket) { updateStatus('Not connected…', '#f44336'); return; }
  if (silentCheck?.checked) {
    // Silent mode: local animation only, no broadcast, show flourish locally
    if (diceBox) diceBox.roll(notation);
    const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(notation.trim());
    if (match) {
      const qty      = Math.min(parseInt(match[1]), 20);
      const sides    = parseInt(match[2]);
      const modifier = match[3] ? parseInt(match[3]) : 0;
      const total    = Array.from({ length: qty }, () => Math.floor(Math.random() * sides) + 1)
                           .reduce((a, b) => a + b, 0) + modifier;
      const modStr   = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
      showFlourish(`${qty}d${sides}${modStr} = ${total}`, '#4CAF50');
    }
    return;
  }
  // Send notation + this client's current colorset so all clients see the roller's dice
  socket.emit('rollDice', {
    notation,
    colorset: colorsetSelect?.value ?? 'white',
  });
}

// ── Button listeners ──────────────────────────────────────
document.querySelectorAll('.dice-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const notation = btn.dataset.dice;
    if (notation === 'clear') {
      if (diceBox) diceBox.clearDice();
      if (socket) socket.emit('clearDice');
      return;
    }
    handleRoll(notation);
  });
});

if (customBtn && customInput) {
  customBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleRoll(customInput.value.trim());
  });
  customInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRoll(customInput.value.trim());
  });
}

// Update colorset on change without destroying/recreating the whole instance
async function updateTheme() {
  if (!diceBox) { await initDiceBox(); return; }
  try {
    await diceBox.updateConfig({
      theme_colorset: colorsetSelect?.value ?? 'white',
      theme_texture:  '',
    });
  } catch (err) {
    console.error('[DiceRoller] updateConfig failed:', err);
  }
}

if (colorsetSelect) colorsetSelect.addEventListener('change', updateTheme);

// ── Boot ──────────────────────────────────────────────────
findSocket();
requestAnimationFrame(() => initDiceBox());
