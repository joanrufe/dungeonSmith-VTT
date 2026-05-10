// public/js/musicManager.js

export class MusicManager {
  constructor(socket) {
    this.socket = socket;

    // Music management properties
    this.musicTracks = []; // List of uploaded music tracks with individual controls

    // Initialize the music list in the UI
    this.musicListElement = document.getElementById('music-list');
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

    const deleteButton = document.createElement('button');
    deleteButton.classList.add('delete-button');
    deleteButton.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteButton.addEventListener('click', () => this.deleteMusicTrack(index));

    controlsContainer.appendChild(playPauseButton);
    controlsContainer.appendChild(volumeSlider);
    controlsContainer.appendChild(deleteButton);

    li.appendChild(trackNameSpan);
    li.appendChild(controlsContainer);

    return li;
  }

  // Method to add a music track
  addMusicTrack(musicUrl, filename, displayName, trackId = null) {
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
      name: displayNameProcessed,
      audioElement: audioElement,
      isPlaying: false,
      volume: initialVolume,
    };
  
    this.musicTracks.push(track);
    this.musicListElement.appendChild(this._buildTrackElement(track, this.musicTracks.length - 1));
  }

  // Generate a unique track ID
  generateTrackId(filename) {
    return `${filename}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  // Method to render the music list in the UI
  renderMusicList() {
    this.musicListElement.innerHTML = '';
    this.musicTracks.forEach((track, index) => {
      this.musicListElement.appendChild(this._buildTrackElement(track, index));
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
      .then(response => {
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        return response.json();
      })
      .then(data => {
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
      .catch(err => {
        console.error('Error deleting music track:', err);
        alert(`Error deleting "${track.name}". Check the console for details.`);
      });
  }

}