// Elements
const vodContainer = document.getElementById('vod-container');
const refreshBtn = document.getElementById('refresh-btn');
const connectionStatus = document.getElementById('connection-status');
const totalVodsEl = document.getElementById('total-vods');
const lastUpdatedEl = document.getElementById('last-updated');
const searchInput = document.getElementById('search-input');
const streamerSearchInput = document.getElementById('streamer-search');
const streamerSearchBtn = document.getElementById('streamer-search-btn');
const playerModal = document.getElementById('player-modal');
const modalClose = document.getElementById('modal-close');
const videoPlayer = document.getElementById('video-player');
const clipStartBtn = document.getElementById('clip-start-btn');
const clipEndBtn = document.getElementById('clip-end-btn');
const createClipBtn = document.getElementById('create-clip-btn');
const shareLinkArea = document.getElementById('share-link-area');
const copyShareBtn = document.getElementById('copy-share-btn');
const playerTitle = document.getElementById('player-title');
const playerStreamer = document.getElementById('player-streamer');

// API URL
const API_URL = 'https://api.vodvod.top/all/private';
const BASE_URL = 'https://api.vodvod.top';
const CHANNEL_URL = 'https://api.vodvod.top/channels/@';
const CLIP_URL = 'https://api.vodvod.top/clip'; // Assuming this endpoint exists for clip generation

// Current view state
let currentData = [];
let currentStreamer = null;
let hls = null;
let clipStartTime = null;
let clipEndTime = null;
let currentPlayingVod = null;

// Format duration (seconds to HH:MM:SS)
function formatDuration(seconds) {
  if (!seconds) return '?:??:??';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

// Format time for clip display (MM:SS)
function formatClipTime(seconds) {
  if (seconds === null) return '--:--';
  
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  return [
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

// Format date
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: '2-digit',
      hour: '2-digit', 
      minute: '2-digit'
    });
  } catch (e) {
    return 'Unknown Date';
  }
}

// Copy text to clipboard
function copyToClipboard(text) {
  // Use Electron API if available
  if (window.api && window.api.copyToClipboard) {
    window.api.copyToClipboard(text);
    showNotification('COPIED TO CLIPBOARD');
    return;
  }
  
  // Fallback for browser testing
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  
  showNotification('COPIED TO CLIPBOARD');
}

// Show notification
function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'copy-notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 500);
  }, 2000);
}

// Initialize HLS player
function initializePlayer(videoURL, vodData) {
  // Destroy previous HLS instance if exists
  if (hls) {
    hls.destroy();
    hls = null;
  }
  
  // Reset clip times
  resetClipTimes();
  
  // Set player information
  const metadata = vodData.Metadata || {};
  playerTitle.textContent = metadata.TitleAtStart || 'Unnamed Stream';
  playerStreamer.textContent = metadata.StreamerLoginAtStart || 'Unknown';
  
  // Store current playing VOD
  currentPlayingVod = vodData;
  
  // Check if HLS.js is supported
  if (Hls.isSupported()) {
    hls = new Hls({
      startPosition: -1, // Start from live point for live streams
      debug: false
    });
    
    // Bind HLS to video element
    hls.loadSource(videoURL);
    hls.attachMedia(videoPlayer);
    
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      // Show the player modal
      playerModal.style.display = 'flex';
      
      // Auto play
      videoPlayer.play().catch(e => {
        console.log('Auto-play prevented:', e);
        showNotification('CLICK TO PLAY VIDEO');
      });
    });
    
    hls.on(Hls.Events.ERROR, function(event, data) {
      if (data.fatal) {
        switch(data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            showNotification('NETWORK ERROR - RETRYING');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            showNotification('MEDIA ERROR - RECOVERING');
            hls.recoverMediaError();
            break;
          default:
            showNotification('PLAYBACK ERROR');
            destroyPlayer();
            break;
        }
      }
    });
  } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
    // For browsers that support HLS natively (Safari)
    videoPlayer.src = videoURL;
    playerModal.style.display = 'flex';
    videoPlayer.play().catch(e => {
      console.log('Auto-play prevented:', e);
      showNotification('CLICK TO PLAY VIDEO');
    });
  } else {
    showNotification('HLS PLAYBACK NOT SUPPORTED');
  }
}

// Destroy player
function destroyPlayer() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  videoPlayer.src = '';
  playerModal.style.display = 'none';
  resetClipTimes();
}

// Reset clip times
function resetClipTimes() {
  clipStartTime = null;
  clipEndTime = null;
  updateClipTimeDisplay();
  shareLinkArea.value = '';
  shareLinkArea.style.display = 'none';
  copyShareBtn.style.display = 'none';
}

// Update clip time display
function updateClipTimeDisplay() {
  clipTimeInfo.textContent = `START: ${formatClipTime(clipStartTime)} | END: ${formatClipTime(clipEndTime)}`;
  
  // Only check if both times are set and valid
  const isValid = clipStartTime !== null && 
                 clipEndTime !== null && 
                 clipEndTime > clipStartTime;
  
  downloadClipBtn.disabled = !isValid;
  downloadClipBtn.classList.toggle('disabled', !isValid);
}

// Set clip start time
function setClipStartTime() {
  clipStartTime = videoPlayer.currentTime;
  if (clipEndTime !== null && clipStartTime >= clipEndTime) {
    clipEndTime = null;
  }
  updateClipTimeDisplay();
  showNotification('CLIP START SET');
}

// Set clip end time
function setClipEndTime() {
  clipEndTime = videoPlayer.currentTime;
  if (clipStartTime !== null && clipEndTime <= clipStartTime) {
    showNotification('END TIME MUST BE AFTER START');
    clipEndTime = null;
  } else {
    showNotification('CLIP END SET');
  }
  updateClipTimeDisplay();
}

// Fetch all VODs from API
async function fetchAllVODs() {
  currentStreamer = null;
  updateLoadingState('CONNECTING TO NETWORK...', 'SCANNING DATABASE');
  
  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`Network error: ${response.status}`);
    }
    
    const data = await response.json();
    connectionStatus.textContent = 'CONNECTION ESTABLISHED';
    connectionStatus.style.color = 'var(--primary)';
    
    currentData = data;
    renderVODs(data);
    updateStats(data);
    
  } catch (error) {
    handleFetchError(error);
  }
}

// Fetch VODs for a specific streamer
async function fetchStreamerVODs(streamerName) {
  if (!streamerName || streamerName.trim() === '') {
    return fetchAllVODs();
  }
  
  const cleanStreamerName = streamerName.trim().toLowerCase();
  currentStreamer = cleanStreamerName;
  
  updateLoadingState(
    `CONNECTING TO NETWORK: STREAMER @${cleanStreamerName}`, 
    `SCANNING @${cleanStreamerName} DATABASE`
  );
  
  try {
    const response = await fetch(`${CHANNEL_URL}${cleanStreamerName}`);
    if (!response.ok) {
      throw new Error(`Network error: ${response.status}`);
    }
    
    const data = await response.json();
    connectionStatus.textContent = `CONNECTION ESTABLISHED: @${cleanStreamerName}`;
    connectionStatus.style.color = 'var(--primary)';
    
    currentData = data;
    renderVODs(data);
    updateStats(data, cleanStreamerName);
    
  } catch (error) {
    handleFetchError(error);
  }
}

// Update loading state
function updateLoadingState(statusText, loadingText) {
  connectionStatus.textContent = statusText;
  connectionStatus.style.color = '#fff';
  
  vodContainer.innerHTML = `
    <div class="loading">
      <div class="loading-text">${loadingText}</div>
      <div class="loading-bar"></div>
    </div>
  `;
}

// Handle fetch errors
function handleFetchError(error) {
  connectionStatus.textContent = `CONNECTION FAILED: ${error.message}`;
  connectionStatus.style.color = 'var(--accent)';
  
  vodContainer.innerHTML = `
    <div class="error-message">
      <h3>DATA_ACCESS_ERROR</h3>
      <p>${error.message}</p>
      <button class="cyber-btn" onclick="fetchAllVODs()">RETRY CONNECTION</button>
    </div>
  `;
}

// Render VODs in UI
function renderVODs(data) {
  if (!data || data.length === 0) {
    vodContainer.innerHTML = '<div class="no-results">NO VODS FOUND</div>';
    return;
  }
  
  vodContainer.innerHTML = '';
  
  data.forEach(vod => {
    const metadata = vod.Metadata || {};
    const streamLink = BASE_URL + vod.Link;
    
    // Extract box art and profile image
    const boxArtUrl = metadata.BoxArtUrlAtStart?.String || 'https://via.placeholder.com/40x56/111122/00ffff?text=Game';
    const profileImageUrl = metadata.ProfileImageUrlAtStart?.String || 'https://via.placeholder.com/50/111122/00ffff?text=User';
    
    // Extract duration
    const durationSeconds = metadata.HlsDurationSeconds?.Float64 || 0;
    const durationText = formatDuration(durationSeconds);
    
    // Create VOD card
    const vodCard = document.createElement('div');
    vodCard.className = 'vod-card';
    vodCard.innerHTML = `
      <div class="vod-thumbnail" style="background-image: url('${boxArtUrl.replace('-40x56', '-320x180')}')">
        <div class="vod-duration">${durationText}</div>
      </div>
      <div class="vod-info">
        <div class="vod-title">${metadata.TitleAtStart || 'Unnamed Stream'}</div>
        <div class="vod-meta">
          <div class="vod-streamer">
            <img class="streamer-avatar" src="${profileImageUrl}" alt="Streamer">
            <span>${metadata.StreamerLoginAtStart || 'Unknown'}</span>
          </div>
          <div class="vod-date">${formatDate(metadata.StartTime)}</div>
        </div>
        <div class="vod-badges">
          <span class="badge">${metadata.GameNameAtStart || 'Unknown Game'}</span>
          <span class="badge">${metadata.LanguageAtStart || 'en'}</span>
          <span class="badge views">${metadata.MaxViews?.toLocaleString() || '0'} views</span>
        </div>
        <div class="vod-actions">
          <button class="cyber-btn cyber-btn-sm copy-link-btn" data-link="${streamLink}">
            <i class="fas fa-copy"></i> COPY LINK
          </button>
          <button class="cyber-btn cyber-btn-sm watch-vod-btn" data-link="${streamLink}">
            <i class="fas fa-play"></i> WATCH & CLIP
          </button>
        </div>
      </div>
    `;
    
    // Add copy link functionality
    const copyBtn = vodCard.querySelector('.copy-link-btn');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const link = e.currentTarget.dataset.link;
      copyToClipboard(link);
    });
    
    // Add watch functionality
    const watchBtn = vodCard.querySelector('.watch-vod-btn');
    watchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const link = e.currentTarget.dataset.link;
      initializePlayer(link, vod);
    });
    
    vodContainer.appendChild(vodCard);
  });
}

// Update stats in the footer
function updateStats(data, streamerName = '') {
  totalVodsEl.textContent = `VODs: ${data.length}${streamerName ? ` (@${streamerName})` : ''}`;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
  lastUpdatedEl.textContent = `LAST SYNC: ${timeStr}`;
}

// Filter displayed VODs based on search term
function filterVODs(searchTerm) {
  if (!searchTerm || searchTerm.trim() === '') {
    // If search is empty, show all current data
    renderVODs(currentData);
    return;
  }
  
  searchTerm = searchTerm.toLowerCase().trim();
  
  const filteredData = currentData.filter(vod => {
    const metadata = vod.Metadata || {};
    const title = (metadata.TitleAtStart || '').toLowerCase();
    const streamer = (metadata.StreamerLoginAtStart || '').toLowerCase();
    const game = (metadata.GameNameAtStart || '').toLowerCase();
    
    return title.includes(searchTerm) || 
           streamer.includes(searchTerm) || 
           game.includes(searchTerm);
  });
  
  renderVODs(filteredData);
  totalVodsEl.textContent = `VODs: ${filteredData.length}/${currentData.length}${currentStreamer ? ` (@${currentStreamer})` : ''}`;
}

// Event Listeners
// Content search
searchInput.addEventListener('input', (e) => {
  filterVODs(e.target.value);
});

// Streamer search - on button click
streamerSearchBtn.addEventListener('click', () => {
  fetchStreamerVODs(streamerSearchInput.value);
});

// Streamer search - on Enter key
streamerSearchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    fetchStreamerVODs(streamerSearchInput.value);
  }
});

// Refresh button
refreshBtn.addEventListener('click', () => {
  if (currentStreamer) {
    fetchStreamerVODs(currentStreamer);
  } else {
    fetchAllVODs();
  }
});

// Modal close button
modalClose.addEventListener('click', () => {
  destroyPlayer();
});

// Clip start button
clipStartBtn.addEventListener('click', setClipStartTime);

// Clip end button
clipEndBtn.addEventListener('click', setClipEndTime);

// Create clip button
createClipBtn.addEventListener('click', createClip);

// Copy share link button
copyShareBtn.addEventListener('click', () => {
  copyToClipboard(shareLinkArea.value);
});

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  fetchAllVODs();
  
  // Check if HLS.js is available
  if (typeof Hls === 'undefined') {
    showNotification('HLS.JS NOT LOADED - PLAYBACK UNAVAILABLE');
    console.error('HLS.js library not loaded. Please include it in your project.');
  }
});

// Download the VOD
async function downloadVOD(vodURL, filename) {
  try {
    showNotification('INITIATING DOWNLOAD...');
    
    // Try to use Electron's API if available
    if (window.api && window.api.downloadFile) {
      window.api.downloadFile(vodURL, filename);
      return;
    }
    
    // Fallback for browser: create a link and trigger download
    const link = document.createElement('a');
    link.href = vodURL;
    link.download = filename || 'vod.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification('DOWNLOAD STARTED');
  } catch (error) {
    console.error('Download error:', error);
    showNotification('DOWNLOAD FAILED');
  }
}

// Remove the createClip function and modify the downloadClip function
async function downloadClip() {
  if (!currentPlayingVod || clipStartTime === null || clipEndTime === null) {
    showNotification('PLEASE SET START AND END TIMES FIRST');
    return;
  }

  if (clipEndTime <= clipStartTime) {
    showNotification('END TIME MUST BE AFTER START TIME');
    return;
  }

  try {
    showNotification('PREPARING YOUR CLIP...');
    
    const metadata = currentPlayingVod.Metadata || {};
    const streamer = metadata.StreamerLoginAtStart || 'unknown';
    const vodTitle = metadata.TitleAtStart || 'stream';
    
    // Create filename
    const sanitizedTitle = vodTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 20);
    const filename = `${streamer}_${sanitizedTitle}_${Math.floor(clipStartTime)}s-${Math.floor(clipEndTime)}s.mp4`;
    
    // Get the actual stream URL
    const vodURL = BASE_URL + currentPlayingVod.Link;
    
    // Initiate download
    if (window.api && window.api.downloadClip) {
      window.api.downloadClip(vodURL, filename, clipStartTime, clipEndTime);
    } else {
      showNotification('DOWNLOAD ERROR: API NOT AVAILABLE');
    }
  } catch (error) {
    console.error('Clip download error:', error);
    showNotification('CLIP DOWNLOAD FAILED');
  }
}

// Update the event listeners
document.querySelector('.clip-actions').innerHTML = `
  <button id="clip-start-btn" class="cyber-btn"><i class="fas fa-play"></i> SET START</button>
  <button id="clip-end-btn" class="cyber-btn"><i class="fas fa-stop"></i> SET END</button>
  <button id="download-clip-btn" class="cyber-btn disabled" disabled><i class="fas fa-download"></i> DOWNLOAD CLIP</button>
`;

const downloadProgressModal = document.getElementById('download-progress-modal');
const downloadProgressBar = document.getElementById('download-progress-bar');
const downloadProgressText = document.getElementById('download-progress-text');
const downloadFileInfo = document.getElementById('download-file-info');
const downloadModalClose = document.getElementById('download-modal-close');

// Event listener for closing download progress modal
downloadModalClose.addEventListener('click', () => {
  downloadProgressModal.style.display = 'none';
});

// Listen for download progress events
window.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  if (type === 'download-progress') {
    // Show the download progress modal if it's not already visible
    downloadProgressModal.style.display = 'flex';
    
    // Update progress bar
    const percentage = data.percentage || 0;
    downloadProgressBar.style.width = `${percentage}%`;
    downloadProgressText.textContent = `${percentage}%`;
    
    // Update info text
    if (data.totalBytes) {
      const received = formatFileSize(data.receivedBytes);
      const total = formatFileSize(data.totalBytes);
      downloadFileInfo.textContent = `Downloaded ${received} of ${total}`;
    } else {
      downloadFileInfo.textContent = `Downloaded ${formatFileSize(data.receivedBytes)}`;
    }
  } else if (type === 'download-complete') {
    // Update UI to show download is complete
    downloadProgressBar.style.width = '100%';
    downloadProgressText.textContent = '100%';
    downloadFileInfo.textContent = `Download complete: ${data.filename}`;
    
    // Hide the modal after a delay
    setTimeout(() => {
      downloadProgressModal.style.display = 'none';
    }, 3000);
    
    // Show notification
    showNotification('DOWNLOAD COMPLETE');
  } else if (type === 'download-error') {
    // Update UI to show error
    downloadProgressBar.style.width = '0%';
    downloadProgressText.textContent = 'ERROR';
    downloadFileInfo.textContent = `Download failed: ${data.error}`;
    
    // Show notification
    showNotification('DOWNLOAD FAILED');
  }
});

// Format file size for display (converts bytes to KB, MB, etc.)
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}