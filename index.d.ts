import 'electron';

declare module 'electron' {
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
