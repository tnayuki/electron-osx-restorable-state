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

> **Note:**
> - State Restoration requires a packaged app (with a stable bundle identifier). It does not work when running with `electron .` during development.
> - macOS has separate restoration flows: restart/login and app-only quit/relaunch. Restart/login reopening is controlled by the system checkbox "Reopen windows when logging back in" in restart/shutdown dialogs.
> - App-only quit/relaunch behavior depends on app state and Desktop & Dock settings. For reliable local testing, turn off "Close windows when quitting an application".
> - Space/Desktop placement is managed by Mission Control (for example, auto-rearrange Spaces and app-switch Space jumping). This package primarily guarantees window restoration and custom state restoration.

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

1. **Window setup (`restorableIdentifier`)** — Setting `win.restorableIdentifier` calls into the native addon, marks the NSWindow as restorable, assigns the restoration class, and wires the window into macOS State Restoration.
2. **Custom state encode/restore swizzle** — Swizzles `encodeRestorableStateWithCoder:` and `restoreStateWithCoder:` on NSWindow to persist and recover custom `restorableState` data via associated objects.
3. **Quit-time flush hook** — Electron's `app.quit()` does not call `[NSApp terminate:]`, so a `before-quit` hook calls native `flushState()`, which invokes `[NSApp terminate:]` and returns `NSTerminateCancel` from `applicationShouldTerminate:` so state is flushed without replacing Electron's normal quit flow.
4. **Restoration class pending queue** — The `NSWindowRestoration` class captures macOS completion handlers (and decoded saved state) until JS creates the matching BrowserWindow.
5. **`restore-window` event bridge** — During `ready`, pending restore requests are emitted as `restore-window` events. The app creates windows and calls `done()`, then remaining unclaimed requests are dismissed.

## Relation to electron-osx-spaces

[electron-osx-spaces](https://github.com/tnayuki/electron-osx-spaces) provides manual `encodeState()` / `restoreState()` APIs for explicit control over when and how window state is saved. This package (`electron-osx-restorable-state`) takes a different approach — it hooks into macOS's native State Restoration cycle so everything is fully automatic. Just set `restorableIdentifier` and macOS handles the rest. Choose whichever fits your use case.

## Platform support

- **macOS**: Full functionality
- **Other platforms**: No-op

## License

MIT
