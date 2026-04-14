const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// In packaged app: Resources/app.asar/main.js -> Resources/index.js
// In dev (from repo root): test/e2e-app/main.js -> ../../index.js
const addonPath = app.isPackaged
  ? path.join(process.resourcesPath, 'index.js')
  : path.resolve(__dirname, '..', '..', 'index.js');
require(addonPath);

const instructionsPath = process.env.E2E_INSTRUCTIONS;
const resultsPath = process.env.E2E_RESULTS;

if (!instructionsPath || !resultsPath) {
  console.error('Set E2E_INSTRUCTIONS and E2E_RESULTS env vars');
  app.exit(1);
}

const instructions = JSON.parse(fs.readFileSync(instructionsPath, 'utf8'));

console.log('[e2e] main.js loaded, waiting for ready...');

// Track lifecycle events
const events = [];
app.on('window-all-closed', () => {
  events.push('window-all-closed');
  app.quit();
});
app.on('before-quit', () => events.push('before-quit'));
app.on('will-quit', () => events.push('will-quit'));
app.on('quit', () => {
  events.push('quit');
  // Write events to a sidecar file so the test can verify them
  fs.writeFileSync(`${resultsPath}.events`, JSON.stringify(events));
});

// Collect windows restored via 'restore-window' event
const windows = [];
const restoredIds = new Set();

if (!instructions.disableRestoreWindowListener) {
  app.on('restore-window', (identifier, state, done) => {
    console.log('[e2e] restore-window:', identifier, JSON.stringify(state));

    try {
      // null identifier means no windows to restore
      if (!identifier) return;

      const knownIds = new Set(instructions.windows.map((w) => w.identifier));

      // Only restore windows the test expects; ignore leftover state from prior runs
      if (knownIds.size > 0 && !knownIds.has(identifier)) return;

      const winSpec = instructions.windows.find(
        (w) => w.identifier === identifier,
      );

      const win = new BrowserWindow({
        width: winSpec?.bounds?.width || 400,
        height: winSpec?.bounds?.height || 300,
        show: false,
      });

      win.restorableIdentifier = identifier;

      // State comes from the event argument (decoded in restoreWindowWithIdentifier:)
      const restoredState = state || null;

      if (winSpec?.state) {
        win.restorableState = winSpec.state;
      }

      if (winSpec?.bounds) {
        win.setBounds(winSpec.bounds);
      }

      win.show();
      windows.push({ win, identifier, restoredState });
      restoredIds.add(identifier);
    } finally {
      done();
    }
  });
}

app.whenReady().then(() => {
  console.log('[e2e] app ready');

  // Create windows not restored by macOS
  for (const winSpec of instructions.windows) {
    if (restoredIds.has(winSpec.identifier)) continue;

    const win = new BrowserWindow({
      width: winSpec.bounds?.width || 400,
      height: winSpec.bounds?.height || 300,
      show: false,
    });

    win.restorableIdentifier = winSpec.identifier;

    // Read restored state BEFORE setting new state
    const restoredState = win.restorableState || null;

    if (winSpec.state) {
      win.restorableState = winSpec.state;
    }

    if (winSpec.bounds) {
      win.setBounds(winSpec.bounds);
    }

    win.show();
    windows.push({ win, identifier: winSpec.identifier, restoredState });
  }

  // Delay reading bounds to allow macOS to apply restored frame
  setTimeout(() => {
    const results = {
      windows: windows.map(({ win, identifier, restoredState }) => ({
        identifier,
        restoredState,
        bounds: win.getBounds(),
      })),
    };
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  }, 500);

  // Wait before quitting to ensure macOS registers state
  const delay = instructions.delayBeforeQuit || 2000;
  setTimeout(() => {
    if (instructions.quitViaClose) {
      // Close windows individually → triggers window-all-closed → app.quit()
      for (const { win } of windows) {
        win.close();
      }
    } else {
      app.quit();
    }
  }, delay);
});
