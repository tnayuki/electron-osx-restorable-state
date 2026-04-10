const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// This single require enables macOS State Restoration
// by injecting restorableIdentifier / restorableState onto BaseWindow
// and emitting 'restore-window' events during 'ready'.
require('../index');

let mainWindow;

function createWindow(restored) {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    title: 'electron-osx-restorable-state example',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.restorableIdentifier = 'main-window';

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

app.on('restore-window', (identifier, state, done) => {
  try {
    if (identifier) {
      console.log('[restorable] Restoring window:', identifier);
      createWindow(state);
    } else {
      console.log('[restorable] No windows to restore, creating default');
      createWindow(null);
    }
  } finally {
    done();
  }
});

app.whenReady().then(() => {
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
