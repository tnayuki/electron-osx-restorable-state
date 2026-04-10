const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// This single require enables macOS State Restoration
// by injecting restorableIdentifier / restorableState onto BaseWindow.
require('../index');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    title: 'electron-osx-restorable-state example',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // This is all you need.
  // macOS will automatically save and restore:
  // - Window position and size
  // - Which Space (virtual desktop) the window was on
  // - Any custom data set via restorableState
  mainWindow.restorableIdentifier = 'main-window';

  // Check if macOS restored any custom data
  const restored = mainWindow.restorableState;
  if (restored) {
    console.log('[restorable] Restored state:', restored);
  } else {
    console.log(
      '[restorable] No restored state (first launch or data cleared)',
    );
  }

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.show();

  // Periodically update the UI with current state info
  const statusInterval = setInterval(() => {
    if (mainWindow.isDestroyed()) {
      clearInterval(statusInterval);
      return;
    }
    mainWindow.webContents.send('status-update', {
      bounds: mainWindow.getBounds(),
      identifier: mainWindow.restorableIdentifier,
      state: mainWindow.restorableState || null,
    });
  }, 2000);
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('set-state', (_event, data) => {
    mainWindow.restorableState = data;
    console.log('[restorable] State set:', data);
    return true;
  });

  ipcMain.handle('get-state', () => {
    return mainWindow.restorableState || null;
  });

  ipcMain.handle('get-identifier', () => {
    return mainWindow.restorableIdentifier;
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
