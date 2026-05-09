// socketHandler.js

const Scene = require('./models/sceneModel');

// ── Server-side dice roller ───────────────────────────────────────────────────
// Parses "2d6", "1d20", "2d6+3" etc. Returns:
//   notation  — predetermined string for dice-box-threejs, e.g. "2d6@3,5"
//   text      — "2d6 = 8"  or  "2d6+3 = 11"
function serverRoll(rawNotation) {
  if (typeof rawNotation !== 'string') return { notation: '1d6', text: '?', color: '#4CAF50' };
  const clean = rawNotation.trim();
  // Match optional modifier: 2d6, 1d20, 3d8+2, 2d6-1
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(clean);
  if (!match) return { notation: clean, text: clean, color: '#4CAF50' };
  const qty      = Math.min(parseInt(match[1]), 20);
  const sides    = parseInt(match[2]);
  const modifier = match[3] ? parseInt(match[3]) : 0;
  const rolls    = Array.from({ length: qty }, () => Math.floor(Math.random() * sides) + 1);
  const diceSum  = rolls.reduce((a, b) => a + b, 0);
  const total    = diceSum + modifier;
  const modStr   = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
  const text     = `${qty}d${sides}${modStr} = ${total}`;
  // dice-box-threejs predetermined notation (no modifier support in lib, just the dice)
  const notation = `${qty}d${sides}@${rolls.join(',')}`;
  return { notation, text, color: '#4CAF50' };
}

module.exports = (io) => {
  // Scene management
  io.on('connection', (socket) => {
    const role = socket.handshake.query.role || 'player';
    socket.role = role;
    socket.join(socket.role);
    console.log('A user connected');

    const isDM = () => socket.role === 'dm';

    // Send the active scene ID to the client upon connection
    socket.emit('activeSceneId', Scene.activeSceneId);


    // Send persisted bg color and grid state to newly connected client
    if (io._bgColor) socket.emit('setBgColor', { color: io._bgColor });
    if (io._gridState !== undefined) socket.emit('toggleGrid', io._gridState);

    // Handle socket events here
    socket.on('loadScene', async ({ sceneId }) => {
      try {
        const scene = await Scene.loadScene(sceneId);
        if (socket.role === 'player') {
          const filteredTokens = scene.tokens.filter(token => !token.hidden);
          const filteredScene = { ...scene, tokens: filteredTokens };
          socket.emit('sceneData', filteredScene);
        } else {
          socket.emit('sceneData', scene);
        }
      } catch (err) {
        console.error(err);
        socket.emit('error', { message: 'Failed to load scene.' });
      }
    });

    socket.on('changeScene', ({ sceneId }) => {
      if (!isDM()) return;
      Scene.changeActiveScene(sceneId);
      io.emit('activeSceneId', Scene.activeSceneId);
    });

    socket.on('updateToken', ({ sceneId, tokenId, properties }) => {
      if (!isDM()) {
        const scene = Scene.scenes[sceneId];
        const token = scene && scene.tokens.find(t => t.tokenId === tokenId);
        const allowedKeys = Object.keys(properties || {}).every(key => key === 'x' || key === 'y');
        if (!token || !token.movableByPlayers || !allowedKeys) return;
      }
      Scene.updateToken(sceneId, tokenId, properties, socket);
    });

    socket.on('addToken', ({ sceneId, token }) => {
      if (!isDM()) return;
      Scene.addToken(sceneId, token, io);
    });

    socket.on('removeToken', async ({ sceneId, tokenId }) => {
      if (!isDM()) return;
      await Scene.removeToken(sceneId, tokenId, io);
    });

    // Music control events
    socket.on('playTrack', (data) => {
      if (!isDM()) return;
      socket.broadcast.emit('playTrack', data);
    });

    socket.on('pauseTrack', (data) => {
      if (!isDM()) return;
      socket.broadcast.emit('pauseTrack', data);
    });

    socket.on('setTrackVolume', (data) => {
      if (!isDM()) return;
      socket.broadcast.emit('setTrackVolume', data);
    });

    socket.on('deleteTrack', (data) => {
      if (!isDM()) return;
      socket.broadcast.emit('deleteTrack', data);
    });

    // When a new track is added on the DM side
    socket.on('addTrack', (data) => {
      if (!isDM()) return;
      socket.broadcast.emit('addTrack', data);
    });

    // ── Initiative Tracker ────────────────────────────────────────────
    // Keep current state in memory so new connections get it immediately
    socket.on('updateInitiative', (data) => {
      if (!isDM()) return;
      // Store on io so all handlers share it
      io._initiativeState = data;
      // Broadcast to everyone (DM and players)
      io.emit('updateInitiative', data);
    });

    // Send current initiative state to newly connected client
    if (io._initiativeState) {
      socket.emit('updateInitiative', io._initiativeState);
    }
    // ─────────────────────────────────────────────────────────────────

    // ── Grid toggle (DM → players) ─────────────────────────────────────
    socket.on('toggleGrid', (data) => {
      if (!isDM()) return;
      io._gridState = data; // persist for new connections
      socket.broadcast.to('player').emit('toggleGrid', data);
    });

    // ── Snap to View (DM → players) ────────────────────────────────────
    socket.on('snapView', (data) => {
      if (!isDM()) return;
      if (data && data.sceneId) {
        Scene.changeActiveScene(data.sceneId);
      }
      socket.broadcast.to('player').emit('snapView', data);
    });

    // ── Background colour (DM → players) ──────────────────────────────
    socket.on('setBgColor', (data) => {
      if (!isDM()) return;
      io._bgColor = data.color; // remember for new connections
      socket.broadcast.to('player').emit('setBgColor', data);
    });

    // ── Ping (DM & players) ───────────────────────────────────────────
    socket.on('pingScene', (data) => {
      socket.broadcast.emit('pingScene', data);
    });

    // ── 3D Dice Events ──
    // Payload: { notation, colorset, texture }  OR  plain string (legacy)
    socket.on('rollDice', (payload) => {
      const rawNotation = typeof payload === 'string' ? payload : payload.notation;
      const colorset    = typeof payload === 'object' ? (payload.colorset || 'white') : 'white';
      const texture     = typeof payload === 'object' ? (payload.texture  || '')      : '';
      const result      = serverRoll(rawNotation);
      // Broadcast predetermined notation + roller's style to all clients
      io.emit('diceRolled', { notation: result.notation, colorset, texture });
      io.emit('diceResult',  { text: result.text, color: result.color });
    });
    socket.on('clearDice', () => {
      io.emit('diceCleared');
    });

    // ── Media Library: add token from file manager ────────────────────
    socket.on('addTokenFromLibrary', ({ imageUrl, mediaType, width, height }) => {
      if (!isDM()) return;
      if (!Scene.activeSceneId) return;
      const scene = Scene.scenes[Scene.activeSceneId];
      if (!scene) return;
      const maxZ = scene.tokens.reduce((m, t) => Math.max(m, t.zIndex || 0), 0);
      const token = {
        tokenId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
        sceneId: Scene.activeSceneId,
        imageUrl,
        mediaType: mediaType || 'image',
        x: 100,
        y: 100,
        width:  width  || 100,
        height: height || 100,
        rotation: 0,
        zIndex: maxZ + 1,
        movableByPlayers: false,
        hidden: false,
      };
      Scene.addToken(Scene.activeSceneId, token, io);
    });

    socket.on('disconnect', () => {
      console.log('A user disconnected');
    });
  });
};
