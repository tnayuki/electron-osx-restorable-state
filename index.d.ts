/// <reference types="electron" />

declare global {
  namespace Electron {
    interface App {
      /**
       * Emitted during the 'ready' event for window restoration.
       *
       * - When macOS has windows to restore: fires once per window with
       *   `identifier` set to the window's restorable identifier and
       *   `state` containing custom data saved via `restorableState`.
       * - When there are no windows to restore (first launch, etc.):
       *   fires once with `identifier: null`.
       *
       * Register this handler before 'ready' to receive all events.
       * When `identifier` is non-null, create a BrowserWindow and set
       * `restorableIdentifier` to complete the restoration.
       *
       * The listener MUST call `done()` when it has finished (either
       * synchronously or asynchronously). Unclaimed macOS completion
       * handlers are dismissed only after all listeners have called done.
       *
       * @param identifier The window's restorable identifier, or null
       * @param state Custom data saved via `restorableState`, or undefined
       * @param done Callback to signal that this listener has finished
       */
      on(
        event: 'restore-window',
        listener: (
          identifier: string | null,
          state: Record<string, unknown> | undefined,
          done: () => void,
        ) => void,
      ): this;
    }

    interface BaseWindow {
      /**
       * A unique identifier for macOS State Restoration.
       * Setting this enables automatic save/restore of the window's
       * position, size, and Space (virtual desktop).
       *
       * On non-macOS platforms, this property is stored but has no effect.
       */
      restorableIdentifier: string;

      /**
       * Custom data to persist through macOS State Restoration.
       * On macOS, this is saved via encodeRestorableStateWithCoder: and
       * automatically restored on next launch.
       *
       * Supported value types: string, number, boolean, nested objects.
       *
       * On non-macOS platforms, this property is stored in memory only.
       */
      restorableState: Record<string, unknown>;
    }
  }
}

export {};
