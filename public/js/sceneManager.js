// public/js/sceneManager.js

import { extractDominantColor } from './utils.js';

export class SceneManager {
  constructor(socket, sceneRenderer, tokenManager, sceneContainer) {
    this.socket = socket;
    this.sceneRenderer = sceneRenderer;
    this.tokenManager = tokenManager;
    this.sceneContainer = sceneContainer;
    this.currentScene = null;
    this.selectedTokenId = null;
    this.selectedTokenIds = new Set();
    this.sortableInitialized = false;

    this.init();
  }

  init() {
    this.setupSocketListeners();
    this.setupSceneContainerListeners();
    this.fetchSceneList();
    this.setupKeyListeners();
  }

  setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('sceneData', (scene) => this.onSceneData(scene));

    this.socket.on('addToken', ({ sceneId, token }) => {
      if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;
      // Skip if we already have this token (locally created via drag-drop upload)
      if (this.currentScene.tokens.find(t => t.tokenId === token.tokenId)) return;
      this.currentScene.tokens.push(token);
      this.sceneRenderer.tokens.push(token);
      this.sceneRenderer.renderToken(token);
      this.tokenManager.setupTokenInteractions(token);
      const element = document.getElementById(`token-${token.tokenId}`);
      if (element) element.addEventListener('click', (e) => this.onTokenClick(e, token.tokenId));
    });

    this.socket.on('updateToken', ({ sceneId, tokenId, properties }) => {
      this.onUpdateToken(sceneId, tokenId, properties);
    });

    this.socket.on('removeToken', ({ sceneId, tokenId }) => {
      this.onRemoveToken(sceneId, tokenId);
    });

    this.socket.on('sceneDeleted', ({ sceneId }) => {
      this.onSceneDeleted(sceneId);
    });

    this.socket.on('pingScene', (data) => {
      this.drawPing(data);
    });

    // Add other socket event handlers as needed
  }

  setupSceneContainerListeners() {
    this.sceneContainer.addEventListener('dragover', (event) => this.onDragOver(event));
    this.sceneContainer.addEventListener('dragleave', (event) => this.onDragLeave(event));
    this.sceneContainer.addEventListener('drop', (event) => this.onDrop(event));

    // Unselect token when clicking on the scene background
    this.sceneContainer.addEventListener('click', (event) => this.onSceneClick(event));

    // Double-click to ping
    this.sceneContainer.addEventListener('dblclick', (event) => this.onSceneDblClick(event));
  }

  setupKeyListeners() {
    // Handle Delete key press to remove selected token and other key events
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  fetchSceneList() {
    fetch('/scenes')
      .then((response) => response.json())
      .then((data) => {
        this.renderSceneButtons(data.scenes);
      })
      .catch((error) => {
        console.error('Error fetching scene list:', error);
      });
  }

  renderSceneButtons(scenes) {
    const sceneButtonsContainer = document.getElementById('scene-buttons-container');
    sceneButtonsContainer.innerHTML = ''; // Clear existing buttons

    scenes.forEach((scene) => {
      const button = document.createElement('button');
      button.className = 'scene-button';
      button.textContent = scene.sceneName;
      button.dataset.sceneId = scene.sceneId;
      button.addEventListener('click', () => this.onSceneButtonClick(scene));

      sceneButtonsContainer.appendChild(button);
    });

    // Update active scene button
    if (this.currentScene) {
      const activeButton = document.querySelector(`.scene-button[data-scene-id="${this.currentScene.sceneId}"]`);
      if (activeButton) {
        activeButton.classList.add('active');
      }
    }

    // Initialize SortableJS on the scene-buttons-container
    if (!this.sortableInitialized) {
      this.sortable = new Sortable(sceneButtonsContainer, {
        animation: 150,
        onEnd: (evt) => {
          // Get the new order of scene IDs
          const sceneButtons = sceneButtonsContainer.querySelectorAll('.scene-button');
          const newOrder = Array.from(sceneButtons).map(button => button.dataset.sceneId);

          // Send the new order to the server
          fetch('/updateSceneOrder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneOrder: newOrder }),
          })
            .then(response => response.json())
            .then(data => {
              if (!data.success) {
                console.error('Failed to update scene order on server:', data.message);
              } else {
                console.log('Scene order updated successfully');
              }
            })
            .catch(error => {
              console.error('Error updating scene order:', error);
            });
        },
      });
      this.sortableInitialized = true;
    }
  }

  onSceneButtonClick(scene) {
    const followPlayers = document.getElementById('follow-players-toggle')?.checked !== false;
    window.VTT_FOLLOW_PLAYERS = followPlayers;

    if (followPlayers) {
      // Notify the server to change the active scene for players.
      this.socket.emit('changeScene', { sceneId: scene.sceneId });
    }

    // Load the selected scene
    this.loadScene(scene.sceneId);

    // Update the active class on buttons
    const buttons = document.querySelectorAll('.scene-button');
    buttons.forEach((btn) => btn.classList.remove('active'));
    const button = document.querySelector(`.scene-button[data-scene-id="${scene.sceneId}"]`);
    if (button) {
      button.classList.add('active');
    }
  }

  loadScene(sceneId) {
    this.socket.emit('loadScene', { sceneId: sceneId });
  }

  onSceneData(scene) {
    this.currentScene = scene;
    this.clearSelection();
    this.renderScene(scene);

    // Update active scene button
    const buttons = document.querySelectorAll('.scene-button');
    buttons.forEach((btn) => btn.classList.remove('active'));
    const activeButton = document.querySelector(`.scene-button[data-scene-id="${scene.sceneId}"]`);
    if (activeButton) {
      activeButton.classList.add('active');
    }
  }

  renderScene(scene) {
    this.sceneRenderer.renderScene(scene);

    // After rendering tokens, setup interactions
    scene.tokens.forEach((token) => {
      this.tokenManager.setupTokenInteractions(token);

      // Additional DM-specific interactions
      const element = document.getElementById(`token-${token.tokenId}`);
      if (element) {
        // Add click event listener for token selection
        element.addEventListener('click', (event) => this.onTokenClick(event, token.tokenId));
      }
    });

    // Update the background color based on tokens
    this.sceneRenderer.setBackgroundBasedOnTokens();
  }

  onTokenClick(event, tokenId) {
    event.stopPropagation(); // Prevent click from bubbling up to sceneContainer

    if (event.shiftKey) {
      if (this.selectedTokenIds.has(tokenId)) {
        this.selectedTokenIds.delete(tokenId);
      } else {
        this.selectedTokenIds.add(tokenId);
      }
      this.selectedTokenId = this.selectedTokenIds.size ? Array.from(this.selectedTokenIds).at(-1) : null;
      this.refreshSelectionStyles();
      return;
    }

    this.selectedTokenIds.clear();
    this.selectedTokenIds.add(tokenId);
    this.selectedTokenId = tokenId;
    this.refreshSelectionStyles();
  }

  onSceneClick(event) {
    // If clicked directly on the sceneContainer (not on any token)
    if (event.target === this.sceneContainer) {
      this.clearSelection();
    }
  }

  onSceneDblClick(event) {
    if (event.target !== this.sceneContainer && event.target.id !== 'scene-bg-el' && event.target.id !== 'player-grid-canvas' && event.target.id !== 'paint-grid-canvas') {
      return; // Only ping on the background, not UI or tokens
    }

    const rect = this.sceneContainer.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const worldX = (mouseX / this.sceneRenderer.scale) - this.sceneRenderer.offsetX;
    const worldY = (mouseY / this.sceneRenderer.scale) - this.sceneRenderer.offsetY;

    // Default to blue for players, green for DM
    const color = (window.VTT_DM && !window.VTT_PLAYER) ? '#00FF00' : '#00AAFF';

    const data = { x: worldX, y: worldY, color };
    this.socket.emit('pingScene', data);
    this.drawPing(data); // Draw locally
  }

  drawPing(data) {
    const pingEl = document.createElement('div');
    pingEl.className = 'scene-ping';
    pingEl.style.position = 'absolute';
    // Calculate current screen bounds for this ping's absolute world position
    const px = (data.x + this.sceneRenderer.offsetX) * this.sceneRenderer.scale;
    const py = (data.y + this.sceneRenderer.offsetY) * this.sceneRenderer.scale;
    pingEl.style.left = `${px}px`;
    pingEl.style.top = `${py}px`;
    pingEl.style.transform = 'translate(-50%, -50%)';
    pingEl.style.borderColor = data.color;
    
    // Parse hex to rgba for background
    const isGreen = data.color === '#00FF00';
    pingEl.style.backgroundColor = isGreen ? 'rgba(0, 255, 0, 0.4)' : 'rgba(0, 170, 255, 0.4)';

    this.sceneContainer.appendChild(pingEl);

    setTimeout(() => {
      if (pingEl.parentNode) pingEl.remove();
    }, 1000);
  }

  onKeyDown(event) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (this.hasSelection() && event.key === ']') {
      this.forEachSelectedTokenId(tokenId => this.moveTokenZIndexUp(tokenId));
    } else if (this.hasSelection() && event.key === '[') {
      this.forEachSelectedTokenId(tokenId => this.moveTokenZIndexDown(tokenId));
    } else if (this.hasSelection() && event.key.toLowerCase() === 'h') {
      this.forEachSelectedTokenId(tokenId => this.toggleTokenHiddenState(tokenId));
    } else if (this.hasSelection() && event.key === 'Delete') {
      this.deleteSelectedToken();
    } else if (this.hasSelection() && event.ctrlKey && event.key.toLowerCase() === 'd') {
      // Duplicate the selected token
      event.preventDefault(); // Prevent default browser action
      this.duplicateSelectedToken();
    } else if (this.hasSelection() && event.key.toLowerCase() === 'i') {
      this.forEachSelectedTokenId(tokenId => this.toggleTokenMovableByPlayers(tokenId));
    } else if (this.hasSelection() && event.key.toLowerCase() === 'q') {
      this.rotateSelectedTokens(event.shiftKey ? -5 : -15);
    } else if (this.hasSelection() && event.key.toLowerCase() === 'e') {
      this.rotateSelectedTokens(event.shiftKey ? 5 : 15);
    } else if (event.key.toLowerCase() === 't') {
      this.toggleToolbar();
    } else if (event.shiftKey && event.key.toLowerCase() === 'd') {
      // Shift + D pressed: Prompt to delete the current scene
      if (this.currentScene) {
        const confirmDelete = confirm('Are you sure you want to delete the current scene? This action cannot be undone.');
        if (confirmDelete) {
          // Proceed to delete the scene
          this.deleteCurrentScene();
        }
      } else {
        alert('No scene is currently loaded.');
      }
    }
  }

  hasSelection() {
    return this.selectedTokenIds && this.selectedTokenIds.size > 0;
  }

  getSelectedTokenIds() {
    if (this.selectedTokenIds && this.selectedTokenIds.size) {
      return Array.from(this.selectedTokenIds);
    }
    return this.selectedTokenId ? [this.selectedTokenId] : [];
  }

  forEachSelectedTokenId(callback) {
    this.getSelectedTokenIds().forEach(callback);
  }

  clearSelection() {
    this.selectedTokenIds.clear();
    this.selectedTokenId = null;
    this.refreshSelectionStyles();
  }

  refreshSelectionStyles() {
    document.querySelectorAll('.token').forEach(element => {
      const tokenId = element.dataset.tokenId;
      if (this.selectedTokenIds.has(tokenId)) {
        element.style.boxShadow = '0px 0px 0px 3px #00FFFF, 0px 0px 15px 5px rgba(0,255,255,0.6)';
        element.style.borderRadius = '5px';
      } else if (!element.classList.contains('paint-tile-el')) {
        element.style.boxShadow = 'none';
        element.style.borderRadius = '';
      }
    });
  }

  toggleTokenHiddenState(tokenId) {
    const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
    if (token) {
      token.hidden = !token.hidden;
  
      // Update the token's visual representation
      const element = document.getElementById(`token-${tokenId}`);
      if (element) {
        if (token.hidden) {
          // Apply visual indicator (e.g., reduced opacity)
          element.style.opacity = '0.5';
        } else {
          element.style.opacity = '1';
        }
      }
  
      // Send update to server
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: tokenId,
        properties: { hidden: token.hidden },
      });
    }
  }

  duplicateSelectedToken() {
    const selectedIds = this.getSelectedTokenIds();
    if (selectedIds.length) {
      const newSelection = [];
      selectedIds.forEach((tokenId) => {
        const originalToken = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
        if (!originalToken) return;
      // Clone the original token
      const newToken = JSON.parse(JSON.stringify(originalToken));
  
      // Generate a new unique tokenId
      newToken.tokenId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
  
      // Offset the new token's position slightly
      const offset = 20; // Adjust as needed
      newToken.x = originalToken.x + offset;
      newToken.y = originalToken.y + offset;
      newToken.zIndex = originalToken.zIndex + 1;
  
      // Add the new token to the current scene's tokens array
      this.currentScene.tokens.push(newToken);
  
      // Notify the server about the new token
      this.socket.emit('addToken', { sceneId: this.currentScene.sceneId, token: newToken });
  
      // Render the new token
      this.sceneRenderer.renderToken(newToken);
  
      // Setup interactions for the new token
      this.tokenManager.setupTokenInteractions(newToken);
  
      // Add event listener for token selection
      const element = document.getElementById(`token-${newToken.tokenId}`);
      if (element) {
        element.addEventListener('click', (event) => this.onTokenClick(event, newToken.tokenId));
      }
        newSelection.push(newToken.tokenId);
      });

      this.selectedTokenIds = new Set(newSelection);
      this.selectedTokenId = newSelection.at(-1) || null;
      this.refreshSelectionStyles();
    } else {
      alert('No token is currently selected.');
    }
  }

  moveTokenZIndexUp(tokenId) {
    const tokens = this.currentScene.tokens;
    tokens.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    const index = tokens.findIndex(t => t.tokenId === tokenId);
  
    if (index < tokens.length - 1) {
      const token = tokens[index];
      const nextToken = tokens[index + 1];
  
      // Swap zIndex values
      const tempZIndex = token.zIndex;
      token.zIndex = nextToken.zIndex;
      nextToken.zIndex = tempZIndex;
  
      // Mark scene as dirty
      this.currentScene.dirty = true;
  
      // Emit updateToken events for both tokens
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: token.tokenId,
        properties: { zIndex: token.zIndex },
      });
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: nextToken.tokenId,
        properties: { zIndex: nextToken.zIndex },
      });
  
      // Update the DOM elements
      this.sceneRenderer.updateTokenElement(token);
      this.sceneRenderer.updateTokenElement(nextToken);
    }
  }

  moveTokenZIndexDown(tokenId) {
    const tokens = this.currentScene.tokens;
    tokens.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    const index = tokens.findIndex(t => t.tokenId === tokenId);
  
    if (index > 0) {
      const token = tokens[index];
      const prevToken = tokens[index - 1];
  
      // Swap zIndex values
      const tempZIndex = token.zIndex;
      token.zIndex = prevToken.zIndex;
      prevToken.zIndex = tempZIndex;
  
      // Mark scene as dirty
      this.currentScene.dirty = true;
  
      // Emit updateToken events for both tokens
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: token.tokenId,
        properties: { zIndex: token.zIndex },
      });
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: prevToken.tokenId,
        properties: { zIndex: prevToken.zIndex },
      });
  
      // Update the DOM elements
      this.sceneRenderer.updateTokenElement(token);
      this.sceneRenderer.updateTokenElement(prevToken);
    }
  }

  toggleToolbar() {
    const toolbar = document.getElementById('toolbar');
    if (toolbar.style.top === '0px' || toolbar.style.top === '') {
      toolbar.style.top = '-50px'; // Adjust this value based on the toolbar height
    } else {
      toolbar.style.top = '0px';
    }
  }

  deleteSelectedToken() {
    const selectedIds = this.getSelectedTokenIds();
    if (!selectedIds.length) return;

    selectedIds.forEach((tokenId) => {
    const tokenIndex = this.currentScene.tokens.findIndex((t) => t.tokenId === tokenId);
    if (tokenIndex !== -1) {
      // Remove from currentScene.tokens
      this.currentScene.tokens.splice(tokenIndex, 1);
      // Remove from DOM
      const element = document.getElementById(`token-${tokenId}`);
      if (element) {
        this.sceneContainer.removeChild(element);
      }
      // Notify server
      this.socket.emit('removeToken', {
        sceneId: this.currentScene.sceneId,
        tokenId,
      });
    }
    });

    this.clearSelection();
  }

  toggleTokenMovableByPlayers(tokenId) {
    const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
    if (token) {
      token.movableByPlayers = !token.movableByPlayers;

      // Update the token's visual representation
      const element = document.getElementById(`token-${tokenId}`);
      if (element) {
        if (token.movableByPlayers) {
          element.style.border = '2px dashed blue';
        } else {
          element.style.border = '';
        }
      }

      // Send update to server
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId: tokenId,
        properties: { movableByPlayers: token.movableByPlayers },
      });
    }
  }

  rotateSelectedTokens(delta) {
    this.forEachSelectedTokenId((tokenId) => {
      const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
      if (!token) return;
      token.rotation = ((token.rotation || 0) + delta) % 360;
      if (token.rotation < 0) token.rotation += 360;
      this.sceneRenderer.updateTokenElement(token);
      this.socket.emit('updateToken', {
        sceneId: this.currentScene.sceneId,
        tokenId,
        properties: { rotation: token.rotation },
      });
    });
  }

  deleteCurrentScene() {
    fetch('/deleteScene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: this.currentScene.sceneId }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          alert('Scene deleted successfully.');
          // Clear the current scene and tokens
          this.currentScene = null;
          this.sceneContainer.innerHTML = '';
          // Update the scene list
          this.fetchSceneList();
        } else {
          alert('Failed to delete the scene.');
        }
      })
      .catch((error) => {
        console.error('Error deleting scene:', error);
        alert('An error occurred while deleting the scene.');
      });
  }

  onUpdateToken(sceneId, tokenId, properties) {
    if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;

    const token = this.currentScene.tokens.find((t) => t.tokenId === tokenId);
    if (token) {
      // Update token properties
      Object.assign(token, properties);

      // Update the DOM element
      this.sceneRenderer.updateTokenElement(token);

      // Only re-setup interactions when interaction-relevant props change
      if ('movableByPlayers' in properties || 'hidden' in properties) {
        this.tokenManager.setupTokenInteractions(token);
      }
    }
  }

  onRemoveToken(sceneId, tokenId) {
    if (!this.currentScene || this.currentScene.sceneId !== sceneId) return;

    const tokenIndex = this.currentScene.tokens.findIndex((t) => t.tokenId === tokenId);
    if (tokenIndex !== -1) {
      // Remove from currentScene.tokens
      this.currentScene.tokens.splice(tokenIndex, 1);
      // Remove from DOM
      const element = document.getElementById(`token-${tokenId}`);
      if (element && element.parentNode === this.sceneContainer) {
        this.sceneContainer.removeChild(element);
      }
      // If the removed token was selected, unselect it
      if (this.selectedTokenId === tokenId) {
        this.selectedTokenIds.delete(tokenId);
        this.selectedTokenId = this.selectedTokenIds.size ? Array.from(this.selectedTokenIds).at(-1) : null;
        this.refreshSelectionStyles();
      }
    }
  }

  onSceneDeleted(sceneId) {
    // If the current scene has been deleted, clear it from the UI
    if (this.currentScene && this.currentScene.sceneId === sceneId) {
      this.currentScene = null;
      this.sceneContainer.innerHTML = '';
    }
    // Update the scene list
    this.fetchSceneList();
  }

  onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    // Add visual feedback
    this.sceneContainer.classList.add('dragover');
  }

  onDragLeave(event) {
    this.sceneContainer.classList.remove('dragover');
  }

  onDrop(event) {
    event.preventDefault();
    this.sceneContainer.classList.remove('dragover');
  
    if (!this.currentScene) {
      alert('Please load or create a scene first.');
      return;
    }
  
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      this.processDroppedFiles(files, event);
    }
  }
  
  async processDroppedFiles(files, event) {
    for (const file of files) {
      await this.processFile(file, event);
    }
  }
  
  async processFile(file, event) {
    // Extract the file name without the extension
    const fileName = file.name.split('.').slice(0, -1).join('.');
  
    const formData = new FormData();
    formData.append('file', file);
  
    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
  
      const imageUrl = data.imageUrl;
      const mediaType = data.mediaType;
  
      // Get the drop position relative to the scene container
      const rect = this.sceneContainer.getBoundingClientRect();
      const x = (event.clientX - rect.left) / this.sceneRenderer.scale - this.sceneRenderer.offsetX;
      const y = (event.clientY - rect.top) / this.sceneRenderer.scale - this.sceneRenderer.offsetY;
  
      let width, height;
  
      // Function to create the token after media dimensions are available
      const createToken = () => {
        // Create a new token
        const token = {
          tokenId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
          sceneId: this.currentScene.sceneId,
          imageUrl: imageUrl,
          mediaType: mediaType,
          x: x,
          y: y,
          width: width,
          height: height,
          rotation: 0,
          zIndex: this.getMaxZIndex() + 1,
          movableByPlayers: false,
          name: fileName,
        };
  
        // Add token to the scene
        this.currentScene.tokens.push(token);
        // Save the scene on the server
        this.socket.emit('addToken', { sceneId: this.currentScene.sceneId, token: token });
        // Render the token
        this.sceneRenderer.renderToken(token);
        // Setup interactions
        this.tokenManager.setupTokenInteractions(token);
  
        // Add click event listener for token selection
        const element = document.getElementById(`token-${token.tokenId}`);
        if (element) {
          element.addEventListener('click', (event) => this.onTokenClick(event, token.tokenId));
        }
      };
  
      // Load the image or video to get its dimensions
      if (mediaType === 'video') {
        const video = document.createElement('video');
        video.src = imageUrl;
  
        // Wrap the event listener in a Promise to use await
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => {
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
  
            const maxDimension = 200; // Adjust as needed
            width = videoWidth;
            height = videoHeight;
  
            // Scale dimensions if necessary
            if (width > height) {
              if (width > maxDimension) {
                const scale = maxDimension / width;
                width = maxDimension;
                height = height * scale;
              }
            } else {
              if (height > maxDimension) {
                const scale = maxDimension / height;
                height = maxDimension;
                width = width * scale;
              }
            }
  
            createToken();
            resolve();
          });
  
          video.addEventListener('error', (error) => {
            console.error('Error loading video:', error);
            reject(error);
          });
        });
      } else {
        // Handle images
        const image = new Image();
  
        // Wrap the event listener in a Promise to use await
        await new Promise((resolve, reject) => {
          image.onload = () => {
            const imageWidth = image.naturalWidth;
            const imageHeight = image.naturalHeight;
  
            const maxDimension = 200; // Adjust as needed
            width = imageWidth;
            height = imageHeight;
  
            // Scale dimensions if necessary
            if (width > height) {
              if (width > maxDimension) {
                const scale = maxDimension / width;
                width = maxDimension;
                height = height * scale;
              }
            } else {
              if (height > maxDimension) {
                const scale = maxDimension / height;
                height = maxDimension;
                width = width * scale;
              }
            }
  
            createToken();
            resolve();
          };
  
          image.onerror = (error) => {
            console.error('Error loading image:', error);
            reject(error);
          };
  
          image.src = imageUrl;
        });
      }
    } catch (error) {
      console.error('Error uploading token file:', error);
    }
  }

  createScene(sceneName) {
    fetch('/createScene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneName }),
    })
      .then((response) => response.json())
      .then((data) => {
        const sceneId = data.sceneId;
        // Fetch the updated scene list to include the new scene
        this.fetchSceneList();
        // Load the new scene
        this.loadScene(sceneId);
      })
      .catch((error) => {
        console.error('Error creating scene:', error);
      });
  }

  duplicateScene(sceneId, sceneName) {
    fetch('/duplicateScene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId, sceneName }),
    })
      .then((response) => response.json())
      .then((data) => {
        this.fetchSceneList();
        this.loadScene(data.sceneId);
      })
      .catch((error) => {
        console.error('Error duplicating scene:', error);
      });
  }

  getMaxZIndex() {
    if (!this.currentScene || !this.currentScene.tokens || this.currentScene.tokens.length === 0) {
      return 0;
    }
    return Math.max(...this.currentScene.tokens.map(token => token.zIndex || 0));
  }
}
