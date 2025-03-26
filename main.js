const { app, BrowserWindow, shell, clipboard, ipcMain, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const ffmpeg = require('fluent-ffmpeg');
const tmp = require('tmp');
const m3u8Parser = require('m3u8-parser');

function createWindow() {
  // Create the browser window with cyberpunk-themed colors
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  // Load the HTML file
  mainWindow.loadFile('index.html');
  
  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  
  // Open DevTools in development
  // mainWindow.webContents.openDevTools();
  
  return mainWindow;
}

// Create window when Electron is ready
app.whenReady().then(() => {
  const mainWindow = createWindow();
  
  // Handle download file request from renderer
  ipcMain.on('download-file', (event, { url, filename, isClip, startTime, endTime }) => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    
    dialog.showSaveDialog(mainWindow, {
      title: isClip ? 'Save Clip' : 'Save Video',
      defaultPath: path.join(app.getPath('downloads'), filename || 'video.mp4'),
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }).then(result => {
      if (!result.canceled && result.filePath) {
        let targetPath = result.filePath;
        if (!targetPath.toLowerCase().endsWith('.mp4')) {
          targetPath += '.mp4';
        }
        
        downloadFile(url, targetPath, event, { isClip, startTime, endTime });
      }
    }).catch(err => {
      console.error('Error showing save dialog:', err);
      event.sender.send('download-error', { error: 'Failed to open save dialog' });
    });
  });
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Function to fetch m3u8 content
async function fetchM3u8Content(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => resolve(data));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Function to download a single TS segment
async function downloadSegment(url, outputPath, event, segmentIndex, totalSegments) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        event.sender.send('download-progress', {
          percentage: Math.round((segmentIndex / totalSegments) * 100),
          status: `Downloading segment ${segmentIndex}/${totalSegments}`
        });
        resolve();
      });
      
      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

// Updated clip download function
async function downloadAndConvertClip(url, targetPath, startTime, endTime, event) {
  try {
    // Create temporary directory
    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const tempOutput = path.join(tmpDir.name, 'full_video.mp4');
    
    event.sender.send('download-progress', {
      percentage: 0,
      status: 'Preparing to extract clip...'
    });

    // First, download a small portion of the full video that contains our clip
    // This is more reliable than trying to download individual segments
    return new Promise((resolve, reject) => {
      // Step 1: Download the portion we need using ffmpeg
      const ffmpegDownload = ffmpeg(url)
        .seekInput(Math.max(0, startTime - 5)) // Start 5 seconds before clip start for safety
        .duration(endTime - startTime + 10)    // Add 10 seconds buffer (5 at start, 5 at end)
        .outputOptions([
          '-c', 'copy',                        // Just copy streams, don't re-encode
          '-bsf:a', 'aac_adtstoasc',           // Fix audio stream
          '-y'                                 // Overwrite output
        ])
        .output(tempOutput);
      
      // Track download progress
      ffmpegDownload.on('progress', (progress) => {
        if (progress.percent) {
          event.sender.send('download-progress', {
            percentage: Math.min(50, Math.round(progress.percent / 2)), // First half of progress
            status: `Downloading video section: ${progress.percent.toFixed(1)}%`
          });
        }
      });
      
      ffmpegDownload.on('end', () => {
        event.sender.send('download-progress', {
          percentage: 50,
          status: 'Download complete, extracting clip...'
        });
        
        // Step 2: Extract the exact clip from our downloaded portion
        const ffmpegExtract = ffmpeg(tempOutput)
          .seekInput(5)  // Skip the 5-second buffer we added
          .duration(endTime - startTime)
          .outputOptions([
            '-c', 'copy',  // Just copy streams, don't re-encode
            '-y'           // Overwrite output
          ])
          .output(targetPath);
        
        ffmpegExtract.on('progress', (progress) => {
          if (progress.percent) {
            event.sender.send('download-progress', {
              percentage: 50 + Math.round(progress.percent / 2), // Second half of progress
              status: `Extracting clip: ${progress.percent.toFixed(1)}%`
            });
          }
        });
        
        ffmpegExtract.on('end', () => {
          event.sender.send('download-progress', {
            percentage: 100,
            status: 'Clip extraction complete!'
          });
          
          // Clean up
          tmpDir.removeCallback();
          
          event.sender.send('download-complete', {
            path: targetPath,
            filename: path.basename(targetPath)
          });
          
          resolve();
        });
        
        ffmpegExtract.on('error', (err) => {
          console.error('Error extracting clip:', err);
          event.sender.send('download-error', {
            error: `Error extracting clip: ${err.message}`
          });
          reject(err);
        });
        
        // Start the extraction
        ffmpegExtract.run();
      });
      
      ffmpegDownload.on('error', (err) => {
        console.error('Error downloading video section:', err);
        event.sender.send('download-error', {
          error: `Error downloading video section: ${err.message}`
        });
        reject(err);
      });
      
      // Start the download
      ffmpegDownload.run();
    });
    
  } catch (error) {
    console.error('Clip conversion error:', error);
    event.sender.send('download-error', {
      error: `Clip conversion error: ${error.message}`
    });
  }
}

// Function to download and convert HLS stream to MP4
async function downloadAndConvertHLS(url, targetPath, event) {
  try {
    // Create temporary directory for processing
    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    
    // Send initial progress
    event.sender.send('download-progress', {
      receivedBytes: 0,
      totalBytes: 100,
      percentage: 0,
      status: 'Starting download and conversion...'
    });

    // Create ffmpeg command
    const command = ffmpeg(url)
      .outputOptions([
        '-c:v', 'copy',     // Copy video codec
        '-c:a', 'copy',     // Copy audio codec
        '-bsf:a', 'aac_adtstoasc'  // Fix audio stream
      ])
      .output(targetPath);

    // Track progress
    command.on('progress', (progress) => {
      if (progress.percent) {
        event.sender.send('download-progress', {
          receivedBytes: progress.percent,
          totalBytes: 100,
          percentage: Math.round(progress.percent),
          status: `Converting: ${progress.currentFps} fps - ${progress.currentKbps} kbps`
        });
      }
    });

    // Handle completion
    command.on('end', () => {
      // Clean up temporary directory
      tmpDir.removeCallback();
      
      event.sender.send('download-complete', {
        path: targetPath,
        filename: path.basename(targetPath)
      });
    });

    // Handle errors
    command.on('error', (err) => {
      // Clean up temporary directory
      tmpDir.removeCallback();
      
      event.sender.send('download-error', {
        error: `FFmpeg error: ${err.message}`
      });
    });

    // Start the conversion
    command.run();

  } catch (error) {
    event.sender.send('download-error', {
      error: `Conversion error: ${error.message}`
    });
  }
}

// Update the existing downloadFile function
function downloadFile(url, targetPath, event, options = {}) {
  const { isClip, startTime, endTime } = options;

  // Handle clip download
  if (isClip && startTime !== undefined && endTime !== undefined) {
    downloadAndConvertClip(url, targetPath, startTime, endTime, event);
    return;
  }

  // Handle full video download (HLS)
  if (url.includes('.m3u8')) {
    downloadAndConvertHLS(url, targetPath, event);
    return;
  }

  // Handle direct file download with progress
  const protocol = url.startsWith('https') ? https : http;
  
  const req = protocol.get(url, (response) => {
    if (response.statusCode !== 200) {
      event.sender.send('download-error', {
        error: `Server returned status code ${response.statusCode}`
      });
      return;
    }

    const totalBytes = parseInt(response.headers['content-length'], 10);
    let receivedBytes = 0;

    const fileStream = fs.createWriteStream(targetPath);

    response.on('data', (chunk) => {
      receivedBytes += chunk.length;
      const percentage = Math.round((receivedBytes * 100) / totalBytes);
      
      event.sender.send('download-progress', {
        receivedBytes,
        totalBytes,
        percentage,
        status: `Downloading: ${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`
      });
    });

    response.pipe(fileStream);

    fileStream.on('finish', () => {
      fileStream.close();
      event.sender.send('download-complete', {
        path: targetPath,
        filename: path.basename(targetPath)
      });
    });

  }).on('error', (err) => {
    event.sender.send('download-error', {
      error: `Download error: ${err.message}`
    });
  });
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});