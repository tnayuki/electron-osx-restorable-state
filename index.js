if (process.platform !== 'darwin') {
  // No-op on non-macOS platforms.
  // Properties are defined but do nothing.
  const { BaseWindow } = require('electron');

  Object.defineProperty(BaseWindow.prototype, 'restorableIdentifier', {
    set(_id) {
      this._restorableIdentifier = _id;
    },
    get() {
      return this._restorableIdentifier;
    },
    configurable: true,
  });

  Object.defineProperty(BaseWindow.prototype, 'restorableState', {
    set(_data) {
      this._restorableState = _data;
    },
    get() {
      return this._restorableState;
    },
    configurable: true,
  });
} else {
  const { app, BaseWindow } = require('electron');
  const native = require('./build/Release/restorable_state.node');

  // Electron's app.quit() does NOT call [NSApp terminate:], so the
  // terminate swizzle never fires. Flush state on will-quit instead.
  app.on('will-quit', () => {
    native.flushState();
  });

  Object.defineProperty(BaseWindow.prototype, 'restorableIdentifier', {
    set(identifier) {
      this._restorableIdentifier = identifier;
      if (!identifier) return;

      const restoredUserData = native.enable(
        this.getNativeWindowHandle(),
        identifier,
      );

      // If macOS restored user data, store it on the JS side too
      if (restoredUserData) {
        this._restorableState = restoredUserData;
      }
    },
    get() {
      return (
        this._restorableIdentifier ||
        native.getIdentifier(this.getNativeWindowHandle())
      );
    },
    configurable: true,
  });

  Object.defineProperty(BaseWindow.prototype, 'restorableState', {
    set(data) {
      this._restorableState = data;
      if (!data) {
        native.setUserData(this.getNativeWindowHandle(), null);
      } else {
        native.setUserData(this.getNativeWindowHandle(), data);
      }
    },
    get() {
      if (this._restorableState !== undefined) {
        return this._restorableState;
      }
      return native.getUserData(this.getNativeWindowHandle());
    },
    configurable: true,
  });
}
