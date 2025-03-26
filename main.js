const { app, BrowserWindow, shell, clipboard, ipcMain, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const ffmpeg = require('fluent-ffmpeg');
const tmp = require('tmp');

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
  ipcMain.on('download-file', (event, { url, filename }) => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    
    dialog.showSaveDialog(mainWindow, {
      title: 'Save Video',
      defaultPath: path.join(app.getPath('downloads'), filename || 'video.mp4'),
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }).then(result => {
      if (!result.canceled && result.filePath) {
        // Ensure the file extension is .mp4
        let targetPath = result.filePath;
        if (!targetPath.toLowerCase().endsWith('.mp4')) {
          targetPath += '.mp4';
        }
        
        // Start the download and conversion process
        downloadFile(url, targetPath, event);
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
function downloadFile(url, targetPath, event) {
  // Check if it's an HLS stream
  if (url.includes('.m3u8')) {
    downloadAndConvertHLS(url, targetPath, event);
    return;
  }

  const protocol = url.startsWith('https') ? https : http;
  
  // Create download progress notification
  const progressCallback = (receivedBytes, totalBytes) => {
    if (event) {
      event.sender.send('download-progress', { 
        receivedBytes, 
        totalBytes,
        percentage: totalBytes ? Math.round((receivedBytes / totalBytes) * 100) : 0
      });
    }
  };
  
  // Start the request
  const request = protocol.get(url, (response) => {
    // Handle redirects
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      return downloadFile(response.headers.location, targetPath, event);
    }
    
    // Check if the request was successful
    if (response.statusCode !== 200) {
      if (event) {
        event.sender.send('download-error', { 
          error: `Failed to download, status code: ${response.statusCode}` 
        });
      }
      return;
    }
    
    // Get the total size for progress monitoring
    const totalBytes = parseInt(response.headers['content-length'], 10);
    let receivedBytes = 0;
    
    // Create write stream
    const fileStream = fs.createWriteStream(targetPath);
    
    // Handle stream events
    response.pipe(fileStream);
    
    response.on('data', (chunk) => {
      receivedBytes += chunk.length;
      progressCallback(receivedBytes, totalBytes);
    });
    
    fileStream.on('finish', () => {
      fileStream.close();
      if (event) {
        event.sender.send('download-complete', { 
          path: targetPath,
          filename: path.basename(targetPath)
        });
      }
    });
    
    fileStream.on('error', (err) => {
      fs.unlink(targetPath, () => {}); // Delete the file on error
      if (event) {
        event.sender.send('download-error', { error: err.message });
      }
    });
  });
  
  request.on('error', (err) => {
    if (event) {
      event.sender.send('download-error', { error: err.message });
    }
  });
  
  request.end();
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});