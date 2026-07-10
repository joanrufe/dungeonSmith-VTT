// public/js/player.js

import { SceneRenderer } from './sceneRenderer.js';
import { PanZoomHandler } from './panZoomHandler.js';
import { TokenManager } from './tokenManager.js';

const socket = io({ query: { role: 'player' } });

let currentScene = null;
let pendingSnapView = null;

const sceneContainer = document.getElementById('scene-container');
const sceneRenderer = new SceneRenderer(sceneContainer, false);
const panZoomHandler = new PanZoomHandler(sceneContainer, sceneRenderer);
const tokenManager = new TokenManager(sceneRenderer, socket, false);

// Expose globally for shared tools (ping, dice roller, tokenTool)
window.VTT_PLAYER = {
  socket: socket,
  get currentScene() { return currentScene; },
  sceneRenderer: sceneRenderer,
  drawPing: function(data) {
    const pingEl = document.createElement('div');
    pingEl.className = 'scene-ping';
    pingEl.style.position = 'absolute';
    // Calculate current screen bounds for this ping's absolute world position
    const px = (data.x + sceneRenderer.offsetX) * sceneRenderer.scale;
    const py = (data.y + sceneRenderer.offsetY) * sceneRenderer.scale;
    pingEl.style.left = `${px}px`;
    pingEl.style.top = `${py}px`;
    pingEl.style.transform = 'translate(-50%, -50%)';
    pingEl.style.borderColor = data.color;
    
    // Parse hex to rgba for background
    const isGreen = data.color === '#00FF00';
    pingEl.style.backgroundColor = isGreen ? 'rgba(0, 255, 0, 0.4)' : 'rgba(0, 170, 255, 0.4)';

    sceneContainer.appendChild(pingEl);

    setTimeout(() => {
      if (pingEl.parentNode) pingEl.remove();
    }, 1000);
  }
};

// Music management properties
const musicTracks = {}; // Object to store tracks by trackId

// Receive active scene ID from server
socket.on('activeSceneId', (sceneId) => {
  if (sceneId) {
    loadScene(sceneId);
  }
});

// Function to load a scene
function loadScene(sceneId) {
  socket.emit('loadScene', { sceneId: sceneId });
}

// Handle receiving scene data
socket.on('sceneData', (scene) => {
  currentScene = scene;
  currentScene.walls = [];
  sceneRenderer.walls = [];
  renderScene(scene);

  if (pendingSnapView && pendingSnapView.sceneId === scene.sceneId) {
    panZoomHandler.applyView(pendingSnapView.scale, pendingSnapView.offsetX, pendingSnapView.offsetY);
    pendingSnapView = null;
  }
});

// Wall geometry is delivered separately so player LOS works while the
// main sceneData contract stays wall-free.
socket.on('wallsData', ({ sceneId, walls }) => {
  if (!currentScene || currentScene.sceneId !== sceneId) return;
  currentScene.walls = walls || [];
  sceneRenderer.setWalls(currentScene.walls);
});

// Per-scene fog opacity (DM-controlled). Initial value comes in via
// sceneData.fogOpacity; this handler keeps it current after DM changes.
socket.on('fogOpacity', ({ sceneId, fogOpacity }) => {
  if (!currentScene || currentScene.sceneId !== sceneId) return;
  const v = Math.max(0, Math.min(1, Number(fogOpacity) || 0));
  currentScene.fogOpacity = v;
  sceneRenderer.setFogOpacity(v);
});

// Function to render a scene
function renderScene(scene) {
  sceneRenderer._expandedConditionTokens.clear();
  _conditionsModalTokenId = null;
  _hideConditionsModal();
  sceneRenderer.renderScene(scene);
  scene.tokens
    .filter(t => !t.hidden && t.visibleToPlayers !== false)
    .forEach(token => tokenManager.setupTokenInteractions(token));
}

// Handle token updates from the server
socket.on('updateToken', ({ sceneId, tokenId, properties }) => {
  if (!currentScene || currentScene.sceneId !== sceneId) return;

  // Find the token in currentScene.tokens
  let token = currentScene.tokens.find(t => t.tokenId === tokenId);

  if (token) {
    // Token exists, update its properties
    Object.assign(token, properties);

    // Update the DOM element
    sceneRenderer.updateTokenElement(token);

    // Redraw fog: token position or vision radius may have changed
    sceneRenderer.drawFog();

    // Keep the conditions modal in sync; collapse if the token is hidden.
    if (token.hidden || token.visibleToPlayers === false) {
      if (sceneRenderer._expandedConditionTokens.has(tokenId)) {
        _toggleTokenConditionsExpanded(tokenId);
      }
    } else if ('conditions' in properties && _conditionsModalTokenId === tokenId) {
      _showConditionsModal(tokenId);
    }

    // Only re-setup interactions when interaction-relevant props change
    if ('movableByPlayers' in properties || 'hidden' in properties || 'visibleToPlayers' in properties) {
      tokenManager.setupTokenInteractions(token);
    }
  } else {
    // Token might have been unhidden
    if (!properties.hidden && properties.visibleToPlayers !== false) {
      // Add the token to the scene
      token = { tokenId, sceneId, ...properties };
      currentScene.tokens.push(token);

      // Render the token
      sceneRenderer.renderToken(token);

      // Setup interactions
      tokenManager.setupTokenInteractions(token);

      // New token may be a vision source
      sceneRenderer.drawFog();
    }
  }
});

// Handle addition of new tokens
socket.on('addToken', ({ sceneId, token }) => {
  if (!currentScene || currentScene.sceneId !== sceneId) return;
  if (token.hidden || token.visibleToPlayers === false) return;

  // Add the new token to the scene's token list
  currentScene.tokens.push(token);

  // Add the new token to the sceneRenderer's tokens array
  sceneRenderer.tokens.push(token);

  // Render the new token
  sceneRenderer.renderToken(token);

  // Setup interactions
  if (token.movableByPlayers) {
    tokenManager.setupTokenInteractions(token);
  } else {
    tokenManager.toggleHoverShadow(token, false);
  }

  // New token may be a vision source
  sceneRenderer.drawFog();
});

// Handle removal of tokens
socket.on('removeToken', ({ sceneId, tokenId }) => {
  if (!currentScene || currentScene.sceneId !== sceneId) return;

  // Remove from currentScene.tokens
  currentScene.tokens = currentScene.tokens.filter(t => t.tokenId !== tokenId);
  // Remove from sceneRenderer.tokens
  sceneRenderer.tokens = sceneRenderer.tokens.filter(t => t.tokenId !== tokenId);

  // Remove from DOM
  const element = document.getElementById(`token-${tokenId}`);
  if (element && element.parentNode === sceneContainer) {
    sceneContainer.removeChild(element);
  }

  sceneRenderer._expandedConditionTokens.delete(tokenId);
  if (_conditionsModalTokenId === tokenId) {
    _hideConditionsModal();
  }

  // Removed token may have been a vision source
  sceneRenderer.drawFog();
});

// === Music Handling Code ===

// Keep track of whether audio has been enabled by the user
let audioEnabled = false;

// Handle audio enable button
const enableAudioButton = document.getElementById('enable-audio-button');
enableAudioButton.addEventListener('click', () => {
  audioEnabled = true;
  enableAudioButton.style.display = 'none';

  // Hide the audio overlay if applicable
  const audioOverlay = document.getElementById('audio-overlay');
  if (audioOverlay) {
    audioOverlay.style.display = 'none';
  }

  // Play any tracks that are currently playing
  for (const trackId in musicTracks) {
    const track = musicTracks[trackId];
    if (track.isPlaying) {
      track.audioElement.play().catch((error) => {
        console.error('Error playing audio:', error);
      });
    }
  }
});

// Handle new track addition
socket.on('addTrack', (data) => {
  const { trackId, musicUrl, name } = data;

  // Avoid adding the same track multiple times
  if (musicTracks[trackId]) return;

  const audioElement = new Audio(musicUrl);
  audioElement.loop = true;
  audioElement.volume = 1.0;

  const track = {
    trackId: trackId,
    name: name,
    audioElement: audioElement,
    isPlaying: false,
    volume: 1.0,
  };

  musicTracks[trackId] = track;

  // If audio is enabled and the track is supposed to be playing, start playing
});

// Handle track deletion
socket.on('deleteTrack', (data) => {
  const { trackId } = data;
  const track = musicTracks[trackId];
  if (track) {
    track.audioElement.pause();
    track.audioElement.src = '';
    delete musicTracks[trackId];
  }
});

// Handle play track
socket.on('playTrack', (data) => {
  const { trackId, musicUrl, currentTime, volume } = data;
  let track = musicTracks[trackId];

  if (!track) {
    // If the track doesn't exist, create it
    const audioElement = new Audio(musicUrl);
    audioElement.loop = true;
    audioElement.volume = volume !== undefined ? volume : 0.5; // Set volume from DM or default

    track = {
      trackId: trackId,
      audioElement: audioElement,
      isPlaying: false,
      volume: audioElement.volume,
    };

    musicTracks[trackId] = track;
  } else {
    // If the track already exists, update the volume if provided
    if (volume !== undefined) {
      track.audioElement.volume = volume;
      track.volume = volume;
    }
  }

  track.audioElement.currentTime = currentTime || 0;
  track.isPlaying = true;

  if (audioEnabled) {
    track.audioElement.play().catch((error) => {
      console.error('Error playing audio:', error);
    });
  }
});

// Handle pause track
socket.on('pauseTrack', (data) => {
  const { trackId, currentTime } = data;
  const track = musicTracks[trackId];
  if (track) {
    track.audioElement.pause();
    track.audioElement.currentTime = currentTime || 0;
    track.isPlaying = false;
  }
});

// Handle set track volume
socket.on('setTrackVolume', (data) => {
  const { trackId, volume } = data;
  const track = musicTracks[trackId];
  if (track) {
    track.audioElement.volume = volume;
    track.volume = volume;
  }
});

// Ensure audio elements are not autoplaying without user interaction
document.addEventListener('DOMContentLoaded', () => {
  // Check if audio has already been enabled
  if (!audioEnabled) {
    enableAudioButton.style.display = 'block';
  }
});

// ─── Snap to View ──────────────────────────────────────────────────────────
socket.on('snapView', ({ sceneId, scale, offsetX, offsetY }) => {
  if (sceneId && (!currentScene || currentScene.sceneId !== sceneId)) {
    pendingSnapView = { sceneId, scale, offsetX, offsetY };
    loadScene(sceneId);
    return;
  }

  panZoomHandler.applyView(scale, offsetX, offsetY);
});

// ─── Background Color Sync ────────────────────────────────────────────────
socket.on('setBgColor', ({ color }) => {
  // Route through renderer so the z-indexed bg-div is used (not container backgroundColor,
  // which would hide children with negative z-index like paint tiles)
  sceneRenderer.setBackgroundColor(color);
});

// ─── Grid Overlay (player side) ───────────────────────────────────────────
let playerGridCanvas = null;
window.VTT_GRID_SIZE = 60;
window.VTT_GRID_TYPE = 'square';

function buildPlayerGrid(size, gridType = 'square') {
  if (playerGridCanvas) playerGridCanvas.remove();
  playerGridCanvas = document.createElement('canvas');
  playerGridCanvas.id = 'player-grid-canvas';
  const w = window.innerWidth * 2;
  const h = window.innerHeight * 2;
  playerGridCanvas.style.cssText = `
    position:absolute; top:0; left:0;
    pointer-events:none; z-index:1; opacity:.35;
    width:${w}px; height:${h}px;`;
  playerGridCanvas.width  = w;
  playerGridCanvas.height = h;
  drawPlayerGrid(size, gridType);
  sceneContainer.appendChild(playerGridCanvas);
}

function drawPlayerGrid(size, gridType = 'square') {
  if (!playerGridCanvas) return;
  if (!window.VTT_GRID_RENDERER) return;
  window.VTT_GRID_RENDERER.drawGrid(playerGridCanvas, {
    size,
    type: gridType,
    color: 'rgba(255,255,255,0.5)',
  });
}

socket.on('toggleGrid', ({ visible, gridSize, gridType }) => {
  window.VTT_GRID_SIZE = gridSize || window.VTT_GRID_SIZE || 60;
  window.VTT_GRID_TYPE = gridType || window.VTT_GRID_TYPE || 'square';
  if (visible) {
    if (!playerGridCanvas || !sceneContainer.contains(playerGridCanvas)) {
      buildPlayerGrid(window.VTT_GRID_SIZE, window.VTT_GRID_TYPE);
    } else {
      drawPlayerGrid(window.VTT_GRID_SIZE, window.VTT_GRID_TYPE); // redraw in case size changed
      playerGridCanvas.style.display = '';
    }
  } else {
    // Hide
    if (playerGridCanvas) playerGridCanvas.style.display = 'none';
  }
});

// ─── Token conditions expansion (Player Side) ────────────────────────────
let _conditionsModalTokenId = null;
let _conditionsLongPressHandled = false;
let _longPressTimer = null;
let _longPressStart = null;
const CONDITIONS_LONG_PRESS_MS = 600;
const CONDITIONS_LONG_PRESS_THRESHOLD_PX = 10;

function _tokenFromEventTarget(target) {
  const el = target.closest('.token');
  if (!el) return null;
  const tokenId = el.dataset.tokenId;
  return currentScene?.tokens.find(t => t.tokenId === tokenId) || null;
}

function _collapseTokenConditions(tokenId) {
  if (sceneRenderer._expandedConditionTokens.has(tokenId)) {
    sceneRenderer._expandedConditionTokens.delete(tokenId);
    const token = currentScene?.tokens.find(t => t.tokenId === tokenId);
    if (token) sceneRenderer.updateTokenElement(token);
  }
}

function _hideConditionsModal() {
  const modal = document.getElementById('token-conditions-modal');
  modal?.classList.add('hidden');
  _conditionsModalTokenId = null;
}

function _showConditionsModal(tokenId) {
  const token = currentScene?.tokens.find(t => t.tokenId === tokenId);
  if (!token) return;
  const modal = document.getElementById('token-conditions-modal');
  if (!modal) return;
  const list = modal.querySelector('.token-conditions-list');
  if (!list) return;
  list.innerHTML = '';
  (token.conditions || []).forEach((cond) => {
    const item = document.createElement('div');
    item.className = 'token-condition-modal-item';
    item.textContent = cond.text || '';
    item.style.color = cond.color || '#ffffff';
    list.appendChild(item);
  });
  modal.classList.remove('hidden');
  _conditionsModalTokenId = tokenId;
}

function _toggleTokenConditionsExpanded(tokenId) {
  const already = sceneRenderer._expandedConditionTokens.has(tokenId);
  // Collapse any other expanded token so only one modal is open at a time.
  Array.from(sceneRenderer._expandedConditionTokens).forEach((id) => {
    sceneRenderer._expandedConditionTokens.delete(id);
    const t = currentScene?.tokens.find(tok => tok.tokenId === id);
    if (t) sceneRenderer.updateTokenElement(t);
  });
  _hideConditionsModal();
  if (!already) {
    sceneRenderer._expandedConditionTokens.add(tokenId);
    const token = currentScene?.tokens.find(t => t.tokenId === tokenId);
    if (token) sceneRenderer.updateTokenElement(token);
    _showConditionsModal(tokenId);
  }
}

function _clearConditionsLongPress() {
  if (_longPressTimer) {
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
  }
  _longPressStart = null;
}

sceneContainer.addEventListener('contextmenu', (event) => {
  const token = _tokenFromEventTarget(event.target);
  if (!token || !token.conditions?.length) return;
  event.preventDefault();
  if (_conditionsLongPressHandled) {
    _conditionsLongPressHandled = false;
    return;
  }
  _toggleTokenConditionsExpanded(token.tokenId);
});

sceneContainer.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) return;
  const token = _tokenFromEventTarget(event.touches[0].target);
  if (!token || !token.conditions?.length) return;
  const touch = event.touches[0];
  _longPressStart = { x: touch.clientX, y: touch.clientY, tokenId: token.tokenId };
  _conditionsLongPressHandled = false;
  _longPressTimer = setTimeout(() => {
    _longPressTimer = null;
    _conditionsLongPressHandled = true;
    _toggleTokenConditionsExpanded(token.tokenId);
  }, CONDITIONS_LONG_PRESS_MS);
}, { passive: true });

sceneContainer.addEventListener('touchmove', (event) => {
  if (!_longPressStart) return;
  const touch = event.touches[0];
  const dx = touch.clientX - _longPressStart.x;
  const dy = touch.clientY - _longPressStart.y;
  if (Math.hypot(dx, dy) > CONDITIONS_LONG_PRESS_THRESHOLD_PX) {
    _clearConditionsLongPress();
  }
}, { passive: true });

sceneContainer.addEventListener('touchend', () => _clearConditionsLongPress());
sceneContainer.addEventListener('touchcancel', () => _clearConditionsLongPress());

function _setupConditionsModal() {
  const modal = document.getElementById('token-conditions-modal');
  if (!modal) return;
  const closeBtn = modal.querySelector('.token-conditions-close');
  const collapseCurrent = () => {
    if (_conditionsModalTokenId) {
      _collapseTokenConditions(_conditionsModalTokenId);
      _hideConditionsModal();
    }
  };
  closeBtn?.addEventListener('click', collapseCurrent);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) collapseCurrent();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') collapseCurrent();
  });
}
_setupConditionsModal();

// ─── Double Click Ping (Player Side) ──────────────────────────────────────
sceneContainer.addEventListener('dblclick', (event) => {
  // Don't ping on sticky notes (they handle their own dblclick for editing)
  if (event.target.closest('.sticky-note')) return;
  // Don't ping on UI elements outside the scene
  if (!sceneContainer.contains(event.target) && event.target !== sceneContainer) return;

  const rect = sceneContainer.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  // Convert screen coordinates to world coordinates
  const worldX = (mouseX / sceneRenderer.scale) - sceneRenderer.offsetX;
  const worldY = (mouseY / sceneRenderer.scale) - sceneRenderer.offsetY;

  const color = '#00AAFF'; // Players are always blue

  const data = { x: worldX, y: worldY, color };
  socket.emit('pingScene', data);
  window.VTT_PLAYER.drawPing(data); // Draw locally
});

// Listen for pings from other users (DM or other players)
socket.on('pingScene', (data) => {
  if (window.VTT_PLAYER) {
    window.VTT_PLAYER.drawPing(data);
  }
});
