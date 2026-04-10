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

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });

  // Set a stable identifier — that's all you need for frame + Space restoration
  win.restorableIdentifier = 'main-window';

  // Optionally attach custom data that will be saved/restored alongside the window
  win.restorableState = { openTabs: ['tab1', 'tab2'] };

  win.show();
});
```

## API

### `win.restorableIdentifier: string`

Set a stable identifier to enable State Restoration for this window. macOS will automatically save and restore the window's frame and Space on next launch.

### `win.restorableState: any`

Get or set custom data to be saved alongside the window's native state. The data is serialized as JSON and persisted by macOS.

## How it works

1. **Method swizzling** — Adds `[super saveRestorableState]` to Chromium's override, re-enabling macOS's native state store
2. **Restoration class** — Registers an `NSWindowRestoration`-conforming class that holds completion handlers until Electron creates the window
3. **View methods** — Adds `encodeRestorableStateWithCoder:` / `restoreStateWithCoder:` to BridgedContentView via `class_addMethod` for custom data persistence
4. **Prototype extension** — Injects `restorableIdentifier` / `restorableState` properties onto `BaseWindow.prototype` — just `require` to activate

## Relation to electron-osx-spaces

[electron-osx-spaces](https://github.com/tnayuki/electron-osx-spaces) provides manual `encodeState()` / `restoreState()` APIs for explicit control over when and how window state is saved. This package (`electron-osx-restorable-state`) takes a different approach — it hooks into macOS's native State Restoration cycle so everything is fully automatic. Just set `restorableIdentifier` and macOS handles the rest. Choose whichever fits your use case.

## Platform support

- **macOS**: Full functionality
- **Other platforms**: No-op

## License

MIT
