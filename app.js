(() => {
  // State
  let allSongs = [];
  let filteredSongs = [];
  let currentSong = null;
  let currentSongIndex = -1;
  let isPlaying = false;
  let isShuffle = false;
  let repeatMode = 'off'; // 'off' | 'all' | 'one'
  let activeTag = 'all';
  let searchQuery = '';
  let ytPlayer = null;
  let ytReady = false;
  let progressInterval = null;
  let isDraggingProgress = false;
  let savedVolume = 100;
  let isMuted = false;
  let wakeLockSentinel = null;
  let isWakeLockEnabled = true;

  // DOM Elements
  const songListEl = document.getElementById('songList');
  const playlistTitleEl = document.getElementById('playlistTitle');
  const playlistMetaEl = document.getElementById('playlistMeta');
  const songCountBadge = document.getElementById('songCountBadge');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const tagsContainer = document.getElementById('tagsContainer');
  const shuffleAllBtn = document.getElementById('shuffleAllBtn');
  const wakeLockBtn = document.getElementById('wakeLockBtn');
  const bgAudioEl = document.getElementById('bgAudioKeepAlive');
  
  // Player Controls DOM
  const playPauseBtn = document.getElementById('playPauseBtn');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  const repeatOneBadge = document.getElementById('repeatOneBadge');
  
  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const currentTrackArtist = document.getElementById('currentTrackArtist');
  const currentTrackTag = document.getElementById('currentTrackTag');
  
  const progressFill = document.getElementById('progressFill');
  const progressSlider = document.getElementById('progressSlider');
  const timeDisplay = document.getElementById('timeDisplay');
  
  const volumeSlider = document.getElementById('volumeSlider');
  const muteBtn = document.getElementById('muteBtn');

  // Background Audio Anchor for Mobile Lockscreen Keepalive
  function startBackgroundAudioSession() {
    if (bgAudioEl && bgAudioEl.paused) {
      bgAudioEl.play().catch(() => {});
    }
  }

  function pauseBackgroundAudioSession() {
    if (bgAudioEl && !bgAudioEl.paused) {
      bgAudioEl.pause();
    }
  }

  // Screen Wake Lock API (keeps screen awake during playback)
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || !isWakeLockEnabled || !isPlaying) return;
    try {
      if (!wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
          updateWakeLockUI();
        });
        updateWakeLockUI();
      }
    } catch (err) {
      console.warn('Wake Lock request:', err);
    }
  }

  async function releaseWakeLock() {
    if (wakeLockSentinel) {
      try {
        await wakeLockSentinel.release();
      } catch (err) {}
      wakeLockSentinel = null;
      updateWakeLockUI();
    }
  }

  function toggleWakeLock() {
    if (!('wakeLock' in navigator)) {
      if (!window.isSecureContext) {
        alert('Keep Awake (Screen Wake Lock) requires HTTPS or localhost to function on mobile.');
      } else {
        alert('Screen Wake Lock is not supported on this browser.');
      }
      return;
    }
    isWakeLockEnabled = !isWakeLockEnabled;
    if (isWakeLockEnabled && isPlaying) {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }
    updateWakeLockUI();
  }

  function updateWakeLockUI() {
    if (!wakeLockBtn) return;
    const isSupported = ('wakeLock' in navigator) && window.isSecureContext;
    if (!isSupported) {
      wakeLockBtn.title = 'Keep Screen Awake (Requires HTTPS / Supported Browser)';
      const textEl = wakeLockBtn.querySelector('.btn-text');
      if (textEl) textEl.textContent = 'Keep Awake';
      return;
    }
    wakeLockBtn.classList.toggle('active', isWakeLockEnabled);
    wakeLockBtn.setAttribute('aria-pressed', isWakeLockEnabled ? 'true' : 'false');
    const textEl = wakeLockBtn.querySelector('.btn-text');
    if (textEl) {
      textEl.textContent = isWakeLockEnabled ? 'Awake On' : 'Awake Off';
    }
  }

  // Format Seconds to MM:SS
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Load YouTube IFrame API
  function loadYouTubeAPI() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      window.onYouTubeIframeAPIReady = () => {
        resolve();
      };
      document.head.appendChild(tag);
    });
  }

  // Initialize YT Player
  async function initPlayer() {
    await loadYouTubeAPI();
    ytPlayer = new window.YT.Player('ytPlayer', {
      height: '1',
      width: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        onReady: () => {
          ytReady = true;
          if (currentSong && isPlaying) {
            playSong(currentSong);
          }
        },
        onStateChange: onPlayerStateChange,
        onError: (e) => {
          console.warn('YouTube Player error code:', e.data);
          // On error (e.g. 150/101 embed restricted), auto advance to next
          setTimeout(() => playNext(true), 1200);
        }
      }
    });
  }

  function onPlayerStateChange(event) {
    if (event.data === window.YT.PlayerState.PLAYING) {
      isPlaying = true;
      updatePlayPauseUI();
      startProgressTracker();
      startBackgroundAudioSession();
      acquireWakeLock();
      updateMediaSessionState();
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      isPlaying = false;
      updatePlayPauseUI();
      stopProgressTracker();
      pauseBackgroundAudioSession();
      releaseWakeLock();
      updateMediaSessionState();
    } else if (event.data === window.YT.PlayerState.ENDED) {
      stopProgressTracker();
      if (repeatMode === 'one') {
        playSong(currentSong);
      } else {
        playNext(true);
      }
    }
  }

  // Fetch Songs Dataset
  async function fetchSongs() {
    try {
      const res = await fetch('songs.json');
      allSongs = await res.json();
      songCountBadge.textContent = `${allSongs.length.toLocaleString()} Tracks`;
      applyFilters();
    } catch (err) {
      console.error('Failed to load songs:', err);
      songListEl.innerHTML = `
        <div class="empty-state">
          <p>Failed to load songs database.</p>
        </div>
      `;
    }
  }

  // Filter and Search Logic
  function applyFilters() {
    const q = searchQuery.toLowerCase().trim();
    
    filteredSongs = allSongs.filter(song => {
      // Tag matching
      let matchesTag = true;
      if (activeTag === 'nonstop') {
        matchesTag = song.nonstop === true;
      } else if (activeTag !== 'all') {
        matchesTag = (song.genre || '').toLowerCase() === activeTag;
      }

      if (!matchesTag) return false;

      // Search query matching
      if (!q) return true;
      const titleMatch = (song.title || '').toLowerCase().includes(q);
      const artistMatch = (song.artist || '').toLowerCase().includes(q);
      const albumMatch = (song.album || '').toLowerCase().includes(q);

      return titleMatch || artistMatch || albumMatch;
    });

    // Update metadata title
    const tagNames = {
      all: 'All Songs',
      traditional: 'Traditional Garba',
      dandiya: 'Dandiya Raas',
      devotional: 'Devotional Garba',
      sanedo: 'Sanedo Hits',
      folk: 'Gujarati Folk',
      nonstop: 'Nonstop Sets'
    };
    
    playlistTitleEl.textContent = searchQuery ? `Search Results for "${searchQuery}"` : (tagNames[activeTag] || 'Songs');
    playlistMetaEl.textContent = `${filteredSongs.length.toLocaleString()} tracks`;

    renderSongList();
  }

  // Virtualized or chunked rendering for 1400+ songs
  function renderSongList() {
    if (filteredSongs.length === 0) {
      songListEl.innerHTML = `
        <div class="empty-state">
          <p>No tracks found matching your filter.</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    filteredSongs.forEach((song, index) => {
      const isCurrent = currentSong && currentSong.id === song.id;
      const card = document.createElement('div');
      card.className = `song-card ${isCurrent ? 'playing' : ''}`;
      card.dataset.index = index;

      const genreClass = song.nonstop ? 'nonstop' : (song.genre || 'folk').toLowerCase();
      const genreLabel = song.nonstop ? 'Nonstop' : (song.genre || 'Garba');

      card.innerHTML = `
        <div class="song-index">${isCurrent && isPlaying ? '▶' : index + 1}</div>
        <div class="song-info">
          <div class="song-title-row">
            <span class="song-title">${escapeHtml(song.title)}</span>
          </div>
          <div class="song-artist-row">
            <span class="song-artist">${escapeHtml(song.artist)}</span>
            ${song.album ? `<span class="song-album">• ${escapeHtml(song.album)}</span>` : ''}
          </div>
        </div>
        <div class="song-tags">
          <span class="genre-pill ${genreClass}">${genreLabel}</span>
        </div>
        <div class="song-duration">${song.duration ? formatTime(song.duration) : ''}</div>
      `;

      card.addEventListener('click', () => {
        playSongAtIndex(index);
      });

      fragment.appendChild(card);
    });

    songListEl.innerHTML = '';
    songListEl.appendChild(fragment);
  }

  function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // Playback Control
  function playSongAtIndex(index) {
    if (index < 0 || index >= filteredSongs.length) return;
    currentSongIndex = index;
    const song = filteredSongs[index];
    playSong(song);
  }

  function updateMediaSession(song) {
    if (!('mediaSession' in navigator) || !song) return;

    const artworkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="%2317171c"/><circle cx="256" cy="256" r="180" fill="%23f59e0b" fill-opacity="0.15"/><text x="256" y="315" font-size="190" text-anchor="middle">🪘</text></svg>`;
    const artworkDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(artworkSvg)}`;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Garba Track',
      artist: song.artist || 'Aditya Garba',
      album: song.album || (song.nonstop ? 'Nonstop Mix' : 'Aditya Garba'),
      artwork: [
        { src: artworkDataUrl, sizes: '96x96', type: 'image/svg+xml' },
        { src: artworkDataUrl, sizes: '128x128', type: 'image/svg+xml' },
        { src: artworkDataUrl, sizes: '192x192', type: 'image/svg+xml' },
        { src: artworkDataUrl, sizes: '256x256', type: 'image/svg+xml' },
        { src: artworkDataUrl, sizes: '512x512', type: 'image/svg+xml' }
      ]
    });

    updateMediaSessionState();
  }

  function updateMediaSessionState() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }

  function playSong(song) {
    if (!song) return;
    currentSong = song;
    isPlaying = true;

    // Update Player Bar UI
    currentTrackTitle.textContent = song.title;
    currentTrackArtist.textContent = song.artist;
    
    const genreClass = song.nonstop ? 'nonstop' : (song.genre || 'folk').toLowerCase();
    currentTrackTag.textContent = song.nonstop ? 'Nonstop' : (song.genre || 'Garba');
    currentTrackTag.className = `genre-pill ${genreClass}`;
    currentTrackTag.style.display = 'inline-block';

    updatePlayPauseUI();
    highlightCurrentCard();

    // YouTube Load and Play
    if (ytReady && ytPlayer && ytPlayer.loadVideoById) {
      const startSec = Number(song.start) || 0;
      ytPlayer.loadVideoById({
        videoId: song.yt,
        startSeconds: startSec
      });
      ytPlayer.playVideo();
    }

    // Keep background audio session and lockscreen controls active
    startBackgroundAudioSession();
    acquireWakeLock();
    updateMediaSession(song);
  }

  function togglePlayPause() {
    if (!currentSong) {
      if (filteredSongs.length > 0) {
        playSongAtIndex(0);
      }
      return;
    }

    if (isPlaying) {
      if (ytReady && ytPlayer && ytPlayer.pauseVideo) {
        ytPlayer.pauseVideo();
      }
      isPlaying = false;
      pauseBackgroundAudioSession();
      releaseWakeLock();
    } else {
      if (ytReady && ytPlayer && ytPlayer.playVideo) {
        ytPlayer.playVideo();
      }
      isPlaying = true;
      startBackgroundAudioSession();
      acquireWakeLock();
    }
    updatePlayPauseUI();
    updateMediaSessionState();
  }

  function playNext(auto = false) {
    if (filteredSongs.length === 0) return;

    if (isShuffle) {
      const randIndex = Math.floor(Math.random() * filteredSongs.length);
      playSongAtIndex(randIndex);
      return;
    }

    let nextIndex = currentSongIndex + 1;
    if (nextIndex >= filteredSongs.length) {
      if (repeatMode === 'all' || auto) {
        nextIndex = 0;
      } else {
        return;
      }
    }
    playSongAtIndex(nextIndex);
  }

  function playPrev() {
    if (filteredSongs.length === 0) return;
    
    // If track has been playing > 3s, restart track
    if (ytReady && ytPlayer && ytPlayer.getCurrentTime) {
      const ct = ytPlayer.getCurrentTime() - (Number(currentSong?.start) || 0);
      if (ct > 3) {
        ytPlayer.seekTo(Number(currentSong?.start) || 0, true);
        return;
      }
    }

    let prevIndex = currentSongIndex - 1;
    if (prevIndex < 0) {
      prevIndex = filteredSongs.length - 1;
    }
    playSongAtIndex(prevIndex);
  }

  function updatePlayPauseUI() {
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
    } else {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
    }
  }

  function highlightCurrentCard() {
    const cards = songListEl.querySelectorAll('.song-card');
    cards.forEach((card, idx) => {
      const isCurrent = currentSongIndex === idx;
      card.classList.toggle('playing', isCurrent);
      const indexEl = card.querySelector('.song-index');
      if (indexEl) {
        indexEl.textContent = isCurrent && isPlaying ? '▶' : idx + 1;
      }
    });
  }

  // Progress Tracking
  function startProgressTracker() {
    stopProgressTracker();
    progressInterval = setInterval(() => {
      if (isDraggingProgress || !ytReady || !ytPlayer || !ytPlayer.getCurrentTime) return;

      const rawCurrent = ytPlayer.getCurrentTime();
      const baseStart = Number(currentSong?.start) || 0;
      const currentTrackTime = Math.max(0, rawCurrent - baseStart);
      
      let totalDuration = currentSong?.duration || 0;
      if (!totalDuration || totalDuration <= 0) {
        if (ytPlayer.getDuration) {
          totalDuration = ytPlayer.getDuration() - baseStart;
        }
      }

      // If we passed the track duration for sliced nonstop songs
      if (currentSong?.duration && currentTrackTime >= currentSong.duration) {
        if (repeatMode === 'one') {
          playSong(currentSong);
        } else {
          playNext(true);
        }
        return;
      }

      const percent = totalDuration > 0 ? (currentTrackTime / totalDuration) * 100 : 0;
      progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
      progressSlider.value = percent;
      timeDisplay.textContent = `${formatTime(currentTrackTime)} / ${formatTime(totalDuration)}`;

      // Update system MediaSession position for lockscreen scrubber
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && totalDuration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: Math.max(0, totalDuration),
            playbackRate: 1,
            position: Math.min(Math.max(0, currentTrackTime), totalDuration)
          });
        } catch (e) {}
      }
    }, 400);
  }

  function stopProgressTracker() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  // Seek Handler
  function seekTo(percent) {
    if (!ytReady || !ytPlayer || !ytPlayer.seekTo) return;
    const baseStart = Number(currentSong?.start) || 0;
    let totalDuration = currentSong?.duration || 0;
    if (!totalDuration || totalDuration <= 0) {
      if (ytPlayer.getDuration) totalDuration = ytPlayer.getDuration() - baseStart;
    }

    const seekSeconds = baseStart + (totalDuration * (percent / 100));
    ytPlayer.seekTo(seekSeconds, true);
  }

  // Event Listeners
  function setupEventListeners() {
    // Play / Pause / Skip
    playPauseBtn.addEventListener('click', togglePlayPause);
    nextBtn.addEventListener('click', () => playNext(false));
    prevBtn.addEventListener('click', playPrev);

    // Keep Awake Toggle
    if (wakeLockBtn) {
      wakeLockBtn.addEventListener('click', toggleWakeLock);
      updateWakeLockUI();
    }

    // Shuffle Button
    shuffleBtn.addEventListener('click', () => {
      isShuffle = !isShuffle;
      shuffleBtn.classList.toggle('active', isShuffle);
    });

    // Shuffle All Top Button
    shuffleAllBtn.addEventListener('click', () => {
      isShuffle = true;
      shuffleBtn.classList.add('active');
      if (filteredSongs.length > 0) {
        const randIndex = Math.floor(Math.random() * filteredSongs.length);
        playSongAtIndex(randIndex);
      }
    });

    // Repeat Button
    repeatBtn.addEventListener('click', () => {
      if (repeatMode === 'off') {
        repeatMode = 'all';
        repeatBtn.classList.add('active');
        repeatOneBadge.style.display = 'none';
      } else if (repeatMode === 'all') {
        repeatMode = 'one';
        repeatBtn.classList.add('active');
        repeatOneBadge.style.display = 'flex';
      } else {
        repeatMode = 'off';
        repeatBtn.classList.remove('active');
        repeatOneBadge.style.display = 'none';
      }
    });

    // Progress Bar Interaction
    progressSlider.addEventListener('input', (e) => {
      isDraggingProgress = true;
      const val = parseFloat(e.target.value);
      progressFill.style.width = `${val}%`;
    });

    progressSlider.addEventListener('change', (e) => {
      isDraggingProgress = false;
      seekTo(parseFloat(e.target.value));
    });

    // Volume Control
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      savedVolume = vol;
      isMuted = vol === 0;
      if (ytReady && ytPlayer && ytPlayer.setVolume) {
        ytPlayer.setVolume(vol);
        if (isMuted) ytPlayer.mute();
        else ytPlayer.unMute();
      }
    });

    muteBtn.addEventListener('click', () => {
      if (!ytReady || !ytPlayer) return;
      if (isMuted) {
        isMuted = false;
        volumeSlider.value = savedVolume || 80;
        ytPlayer.unMute();
        ytPlayer.setVolume(savedVolume || 80);
      } else {
        isMuted = true;
        savedVolume = parseInt(volumeSlider.value, 10) || 80;
        volumeSlider.value = 0;
        ytPlayer.mute();
      }
    });

    // Search Input
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      clearSearchBtn.style.display = searchQuery ? 'block' : 'none';
      applyFilters();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      applyFilters();
      searchInput.focus();
    });

    // Filter Tags Click
    tagsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.tag-btn');
      if (!btn) return;

      tagsContainer.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTag = btn.dataset.tag;
      applyFilters();
    });

    // Keyboard shortcuts (Space = play/pause, Left/Right = skip)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        playNext(false);
      } else if (e.code === 'ArrowLeft') {
        playPrev();
      }
    });

    // Mobile gesture audio-unlocker
    const unlockAudioSession = () => {
      startBackgroundAudioSession();
      window.removeEventListener('click', unlockAudioSession);
      window.removeEventListener('touchstart', unlockAudioSession);
    };
    window.addEventListener('click', unlockAudioSession, { once: true, passive: true });
    window.addEventListener('touchstart', unlockAudioSession, { once: true, passive: true });

    // Page Visibility and Screen Lock Handling
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (isPlaying && isWakeLockEnabled) {
          acquireWakeLock();
        }
      } else {
        // Phone locked or switched tab - ensure audio session remains active
        if (isPlaying) {
          startBackgroundAudioSession();
        }
      }
    });

    // Media Session Action Handlers for Lock Screen & Background Control
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        if (!isPlaying) {
          togglePlayPause();
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (isPlaying) {
          togglePlayPause();
        }
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext(false));

      try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime != null && ytPlayer && ytReady) {
            const baseStart = Number(currentSong?.start) || 0;
            ytPlayer.seekTo(baseStart + details.seekTime, true);
          }
        });
      } catch (e) {}

      try {
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          const skipTime = details.seekOffset || 10;
          if (ytPlayer && ytReady && ytPlayer.getCurrentTime) {
            const cur = ytPlayer.getCurrentTime();
            const baseStart = Number(currentSong?.start) || 0;
            ytPlayer.seekTo(Math.max(baseStart, cur - skipTime), true);
          }
        });
      } catch (e) {}

      try {
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          const skipTime = details.seekOffset || 10;
          if (ytPlayer && ytReady && ytPlayer.getCurrentTime) {
            const cur = ytPlayer.getCurrentTime();
            ytPlayer.seekTo(cur + skipTime, true);
          }
        });
      } catch (e) {}
    }
  }

  // App Initialization
  async function init() {
    setupEventListeners();
    fetchSongs();
    initPlayer();
  }

  init();
})();
