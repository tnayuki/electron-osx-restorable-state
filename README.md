# electron-osx-restorable-state

macOS State Restoration for Electron — automatically save and restore window position, Space (virtual desktop), and custom data via the OS-native restoration mechanism.

## Why?

Electron does not participate in macOS State Restoration ([electron/electron#37494](https://github.com/electron/electron/issues/37494)). Windows always open on the current Space and lose their previous frame. This package hooks into AppKit's native restoration cycle so macOS handles everything automatically — no manual save/load needed.

## Install

```bash
npm install electron-osx-restorable-state
```

Requires Xcode Command Line Tools for the native addon build.

## Usage

```js
const { app, BrowserWindow } = require('electron');
require('electron-osx-restorable-state');

app.on('restore-window', (identifier, state, done) => {
  try {
    if (identifier) {
      // Restore a window from the previous session
      const win = new BrowserWindow({ show: false });
      win.restorableIdentifier = identifier;
      // state contains the custom data saved via restorableState
      win.show();
    } else {
      // No windows to restore — create a default window
      const win = new BrowserWindow({ width: 800, height: 600 });
      win.restorableIdentifier = 'main-window';
      win.restorableState = { openTabs: ['tab1', 'tab2'] };
    }
  } finally {
    done();
  }
});
```

> **Note:** State Restoration requires a packaged app (with a stable bundle identifier). It does not work when running with `electron .` during development.

## API

### `app.on('restore-window', (identifier, state, done) => ...)` (macOS only)

Emitted during `ready` for window restoration.

- When macOS has windows to restore: fires once per window with `identifier` set and `state` containing custom data previously saved via `restorableState`.
- When there are no windows to restore (first launch, etc.): fires once with `identifier: null`.
- On non-macOS platforms: not emitted.

Create a `BrowserWindow` and set its `restorableIdentifier` to complete the restoration. macOS will then automatically apply the saved frame and Space.

**The listener must call `done()` when it has finished** (either synchronously in a `finally` block, or after any asynchronous initialization). Unclaimed macOS completion handlers are dismissed only after all listeners have called `done`.

### `win.restorableIdentifier: string`

Set a stable identifier to enable State Restoration for this window. macOS will automatically save and restore the window's frame and Space on next launch.

### `win.restorableState: any`

Get or set custom data to be saved alongside the window's native state. The data is serialized as JSON and persisted by macOS.

## How it works

1. **`saveRestorableState` swizzle** — Replaces Chromium's override with a no-op. Chromium serializes window state and sends it via IPC to its own persistence layer; Electron doesn't use that data. Disabling it lets macOS's native save cycle handle persistence instead
2. **`terminate:` swizzle** — Electron's `app.quit()` doesn't call `[NSApp terminate:]`, so the native save cycle never fires. A `before-quit` hook triggers `[super terminate:]` with `NSTerminateLater` to flush state, then cancels termination and lets Electron's normal quit flow proceed
3. **`encodeRestorableStateWithCoder:` / `restoreStateWithCoder:` swizzle** — Intercepts NSWindow's encode/restore to read and write custom data (`restorableState`) via `objc_setAssociatedObject`
4. **Restoration class** — Registers an `NSWindowRestoration`-conforming class that holds completion handlers until Electron creates the window, then passes it back to macOS
5. **`restore-window` event** — After `ready`, emits one event per pending window so the app can create BrowserWindows in response

## Relation to electron-osx-spaces

[electron-osx-spaces](https://github.com/tnayuki/electron-osx-spaces) provides manual `encodeState()` / `restoreState()` APIs for explicit control over when and how window state is saved. This package (`electron-osx-restorable-state`) takes a different approach — it hooks into macOS's native State Restoration cycle so everything is fully automatic. Just set `restorableIdentifier` and macOS handles the rest. Choose whichever fits your use case.

## Platform support

- **macOS**: Full functionality
- **Other platforms**: No-op

## License

MIT
