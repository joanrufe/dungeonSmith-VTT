// public/js/musicManager.js

export class MusicManager {
  constructor(socket) {
    this.socket = socket;

    // Music management properties
    this.musicTracks = []; // List of uploaded music tracks with individual controls
    this.folders = []; // Folder names from the server
    this.currentFolder = ''; // Destination folder for uploads

    // Initialize the music list in the UI
    this.musicListElement = document.getElementById('music-list');
    this.folderSelectElement = document.getElementById('music-folder-select');
    this.newFolderButton = document.getElementById('music-new-folder-btn');

    this._bindFolderControls();
  }

  _bindFolderControls() {
    if (this.folderSelectElement) {
      this.folderSelectElement.addEventListener('change', () => {
        this.currentFolder = this.folderSelectElement.value;
      });
    }

    if (this.newFolderButton) {
      this.newFolderButton.addEventListener('click', () => this.createFolder());
    }
  }

  _buildTrackElement(track, index) {
    const li = document.createElement('li');
    li.classList.add('music-track-item');

    const trackNameSpan = document.createElement('span');
    trackNameSpan.textContent = track.name;
    trackNameSpan.classList.add('track-name');

    const controlsContainer = document.createElement('div');
    controlsContainer.classList.add('controls-container');

    const playPauseButton = document.createElement('button');
    playPauseButton.classList.add('play-pause-button');
    playPauseButton.innerHTML = track.isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    playPauseButton.addEventListener('click', () => this.togglePlayPause(index, playPauseButton));

    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = 0;
    volumeSlider.max = 100;
    volumeSlider.value = Math.round(Math.cbrt(track.volume) * 100);
    volumeSlider.classList.add('volume-slider');

    volumeSlider.addEventListener('input', () => {
      const sliderValue = volumeSlider.value;
      const volume = Math.pow(sliderValue / 100, 3);
      this.setTrackVolume(index, volume);
    });

    const moveButton = document.createElement('button');
    moveButton.classList.add('move-button');
    moveButton.innerHTML = '<i class="fa-solid fa-folder-tree"></i>';
    moveButton.title = 'Move to folder';
    moveButton.addEventListener('click', () => this._showMoveSelector(li, index));

    const deleteButton = document.createElement('button');
    deleteButton.classList.add('delete-button');
    deleteButton.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteButton.addEventListener('click', () => this.deleteMusicTrack(index));

    controlsContainer.appendChild(playPauseButton);
    controlsContainer.appendChild(volumeSlider);
    controlsContainer.appendChild(moveButton);
    controlsContainer.appendChild(deleteButton);

    li.appendChild(trackNameSpan);
    li.appendChild(controlsContainer);

    return li;
  }

  _showMoveSelector(trackLi, index) {
    // Avoid creating multiple selectors
    if (trackLi.querySelector('.music-move-controls')) return;

    const track = this.musicTracks[index];
    if (!track) return;

    const controls = document.createElement('div');
    controls.classList.add('music-move-controls');

    const select = document.createElement('select');
    select.classList.add('music-move-select');

    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = 'Root';
    rootOption.selected = !track.folder;
    select.appendChild(rootOption);

    this.folders.forEach((folderName) => {
      const option = document.createElement('option');
      option.value = folderName;
      option.textContent = folderName;
      option.selected = folderName === track.folder;
      select.appendChild(option);
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.classList.add('music-move-confirm');
    confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    confirmBtn.title = 'Move';
    confirmBtn.addEventListener('click', () => {
      const targetFolder = select.value;
      if (targetFolder === track.folder) {
        controls.remove();
        return;
      }
      this.moveTrack(index, targetFolder);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.classList.add('music-move-cancel');
    cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    cancelBtn.title = 'Cancel';
    cancelBtn.addEventListener('click', () => controls.remove());

    controls.appendChild(select);
    controls.appendChild(confirmBtn);
    controls.appendChild(cancelBtn);

    trackLi.appendChild(controls);
  }

  _buildFolderElement(folderName, tracks) {
    const folderLi = document.createElement('li');
    folderLi.classList.add('music-folder');

    const header = document.createElement('div');
    header.classList.add('music-folder-header');

    const toggle = document.createElement('button');
    toggle.classList.add('music-folder-toggle');
    toggle.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';

    const title = document.createElement('span');
    title.classList.add('music-folder-name');
    title.innerHTML = `<i class="fa-solid fa-folder"></i> ${folderName}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.classList.add('music-folder-delete');
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-alt"></i>';
    deleteBtn.title = 'Delete folder and its tracks';
    deleteBtn.addEventListener('click', () => this.deleteFolder(folderName));

    header.appendChild(toggle);
    header.appendChild(title);
    header.appendChild(deleteBtn);

    const content = document.createElement('ul');
    content.classList.add('music-folder-content');
    tracks.forEach((track) => {
      const index = this.musicTracks.indexOf(track);
      content.appendChild(this._buildTrackElement(track, index));
    });

    header.addEventListener('click', (e) => {
      if (e.target === deleteBtn || deleteBtn.contains(e.target)) return;
      const collapsed = content.classList.toggle('collapsed');
      toggle.innerHTML = collapsed
        ? '<i class="fa-solid fa-chevron-right"></i>'
        : '<i class="fa-solid fa-chevron-down"></i>';
    });

    folderLi.appendChild(header);
    folderLi.appendChild(content);

    return folderLi;
  }

  _refreshFolderSelect() {
    if (!this.folderSelectElement) return;
    const current = this.folderSelectElement.value;
    this.folderSelectElement.innerHTML = '<option value="">Root</option>';
    this.folders.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      this.folderSelectElement.appendChild(option);
    });
    this.folderSelectElement.value = this.folders.includes(current) ? current : '';
    this.currentFolder = this.folderSelectElement.value;
  }

  // Method to add a music track
  addMusicTrack(musicUrl, filename, displayName, trackId = null, folder = '') {
    // Generate a unique track ID if not provided
    trackId = trackId || this.generateTrackId(filename);

    // Process name to remove leading numbers and hyphens/underscores
    const displayNameProcessed = displayName || filename.replace(/^\d+\s*[-_]?\s*/, '');

    const audioElement = new Audio(musicUrl);
    audioElement.loop = true;

    // Desired initial slider position
    const initialSliderValue = 50;
    const exponent = 3;

    // Calculate the initial volume based on the slider position and exponent
    const initialVolume = Math.pow(initialSliderValue / 100, exponent);

    // Set the initial volume for the audio element
    audioElement.volume = initialVolume;

    const track = {
      trackId: trackId,
      url: musicUrl,
      filename: filename, // For deletion
      folder: folder,
      name: displayNameProcessed,
      audioElement: audioElement,
      isPlaying: false,
      volume: initialVolume,
    };

    this.musicTracks.push(track);
    return track;
  }

  // Generate a unique track ID
  generateTrackId(filename) {
    return `${filename}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  // Load folders and tracks from the server response
  loadFromResponse(data) {
    // Clear existing tracks
    this.musicTracks.forEach((track) => {
      if (track.audioElement) {
        track.audioElement.pause();
        track.audioElement.src = '';
      }
    });
    this.musicTracks = [];
    this.folders = (data.folders || []).map((f) => f.name).sort();

    (data.rootFiles || []).forEach((track) => {
      this.addMusicTrack(track.url, track.filename, track.name, track.trackId, '');
    });

    (data.folders || []).forEach((folder) => {
      (folder.files || []).forEach((track) => {
        this.addMusicTrack(track.url, track.filename, track.name, track.trackId, folder.name);
      });
    });

    this._refreshFolderSelect();
    this.renderMusicList();
  }

  // Method to render the music list in the UI
  renderMusicList() {
    this.musicListElement.innerHTML = '';

    // Root tracks first
    const rootTracks = this.musicTracks.filter((t) => !t.folder);
    rootTracks.forEach((track) => {
      const index = this.musicTracks.indexOf(track);
      this.musicListElement.appendChild(this._buildTrackElement(track, index));
    });

    // Then folders
    this.folders.forEach((folderName) => {
      const folderTracks = this.musicTracks.filter((t) => t.folder === folderName);
      if (folderTracks.length) {
        this.musicListElement.appendChild(this._buildFolderElement(folderName, folderTracks));
      }
    });
  }

  // Method to toggle play/pause
  togglePlayPause(index, buttonElement) {
    const track = this.musicTracks[index];
    if (track.isPlaying) {
      this.pauseTrack(index, buttonElement);
    } else {
      this.playTrack(index, buttonElement);
    }
  }

  // Method to play a track
  playTrack(index, buttonElement) {
    const track = this.musicTracks[index];
    track.audioElement.play();
    track.isPlaying = true;

    // Update the play/pause button icon
    buttonElement.innerHTML = '<i class="fas fa-pause"></i>';

    // Notify players to play the track
    this.socket.emit('playTrack', {
      trackId: track.trackId,
      musicUrl: track.url,
      currentTime: track.audioElement.currentTime,
      volume: track.volume,
    });
  }

  // Method to pause a track
  pauseTrack(index, buttonElement) {
    const track = this.musicTracks[index];
    track.audioElement.pause();
    track.isPlaying = false;

    // Update the play/pause button icon
    buttonElement.innerHTML = '<i class="fas fa-play"></i>';

    // Notify players to pause the track
    this.socket.emit('pauseTrack', {
      trackId: track.trackId,
      currentTime: track.audioElement.currentTime,
    });
  }

  // Method to set track volume
  setTrackVolume(index, volume) {
    const track = this.musicTracks[index];
    track.audioElement.volume = volume;
    track.volume = volume;

    // Notify players to set volume
    this.socket.emit('setTrackVolume', {
      trackId: track.trackId,
      volume,
    });
  }

  // Method to delete a music track
  deleteMusicTrack(index) {
    const track = this.musicTracks[index];
    if (!track) return;

    if (!confirm(`Are you sure you want to delete "${track.name}"?`)) {
      return;
    }

    fetch('/deleteMusic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: track.filename }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (data.success) {
          track.audioElement.pause();
          track.audioElement.src = '';
          track.audioElement = null;

          // Use indexOf so the splice position is correct even if the list
          // was rebuilt between the time this element was created and now.
          const currentIndex = this.musicTracks.indexOf(track);
          if (currentIndex !== -1) this.musicTracks.splice(currentIndex, 1);
          this.renderMusicList();

          this.socket.emit('deleteTrack', { trackId: track.trackId });
        } else {
          alert(`Failed to delete "${track.name}".`);
        }
      })
      .catch((err) => {
        console.error('Error deleting music track:', err);
        alert(`Error deleting "${track.name}". Check the console for details.`);
      });
  }

  moveTrack(index, targetFolder) {
    const track = this.musicTracks[index];
    if (!track || targetFolder === track.folder) return;

    fetch('/moveMusic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: track.filename, folder: targetFolder }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (data.success) {
          this.refreshMusicList();
        } else {
          alert(data.message || `Failed to move "${track.name}".`);
        }
      })
      .catch((err) => {
        console.error('Error moving music track:', err);
        alert(`Error moving "${track.name}". Check the console for details.`);
      });
  }

  createFolder() {
    const name = prompt('Enter a name for the new music folder:');
    if (!name || !name.trim()) return;

    fetch('/musicFolder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.refreshMusicList().then(() => {
            this.currentFolder = name.trim();
            this._refreshFolderSelect();
          });
        } else {
          alert(data.message || 'Failed to create folder.');
        }
      })
      .catch((err) => {
        console.error('Error creating music folder:', err);
        alert('Error creating folder. Check the console for details.');
      });
  }

  deleteFolder(folderName) {
    if (!confirm(`Delete folder "${folderName}" and all its tracks?`)) return;

    fetch('/musicFolder', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.refreshMusicList();
        } else {
          alert(data.message || 'Failed to delete folder.');
        }
      })
      .catch((err) => {
        console.error('Error deleting music folder:', err);
        alert('Error deleting folder. Check the console for details.');
      });
  }

  refreshMusicList() {
    return fetch('/musicList')
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.loadFromResponse(data);
        }
      })
      .catch((err) => {
        console.error('Error refreshing music list:', err);
      });
  }
}
