const { app, BrowserWindow } = require('electron');
const assert = require('node:assert');

require('../index');

let exitCode = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    exitCode = 1;
  }
}

app.whenReady().then(() => {
  console.log('electron-osx-restorable-state smoke tests\n');

  const win = new BrowserWindow({ width: 400, height: 300, show: false });

  // restorableIdentifier
  test('restorableIdentifier is initially undefined', () => {
    assert.strictEqual(win.restorableIdentifier, undefined);
  });

  test('restorableIdentifier can be set', () => {
    win.restorableIdentifier = 'test-window';
    assert.strictEqual(win.restorableIdentifier, 'test-window');
  });

  // restorableState
  test('restorableState is initially undefined', () => {
    // After setting identifier, state may be undefined (first launch)
    const state = win.restorableState;
    // It's ok if it's undefined on first launch
    assert.ok(
      state === undefined || typeof state === 'object',
      `expected undefined or object, got ${typeof state}`,
    );
  });

  test('restorableState can be set with object', () => {
    win.restorableState = { note: 'hello', count: 42 };
    const state = win.restorableState;
    assert.strictEqual(state.note, 'hello');
    assert.strictEqual(state.count, 42);
  });

  test('restorableState can be updated', () => {
    win.restorableState = { updated: true, items: 'a,b,c' };
    const state = win.restorableState;
    assert.strictEqual(state.updated, true);
    assert.strictEqual(state.items, 'a,b,c');
  });

  test('restorableState can be cleared with null', () => {
    win.restorableState = null;
    const state = win.restorableState;
    assert.ok(
      state === undefined || state === null,
      `expected null/undefined, got ${JSON.stringify(state)}`,
    );
  });

  test('restorableState supports nested objects', () => {
    win.restorableState = {
      editor: { file: '/foo/bar.ts', line: 42 },
      sidebar: { visible: true },
    };
    const state = win.restorableState;
    assert.strictEqual(state.editor.file, '/foo/bar.ts');
    assert.strictEqual(state.editor.line, 42);
    assert.strictEqual(state.sidebar.visible, true);
  });

  // Multiple windows
  test('multiple windows have independent state', () => {
    const win2 = new BrowserWindow({ width: 200, height: 200, show: false });
    win2.restorableIdentifier = 'test-window-2';
    win2.restorableState = { name: 'second' };

    win.restorableState = { name: 'first' };

    assert.strictEqual(win.restorableState.name, 'first');
    assert.strictEqual(win2.restorableState.name, 'second');
    win2.destroy();
  });

  // BrowserWindow inherits from BaseWindow
  test('BrowserWindow inherits restorableIdentifier from BaseWindow', () => {
    assert.ok('restorableIdentifier' in win);
    assert.ok('restorableState' in win);
  });

  console.log(
    `\nDone. ${exitCode === 0 ? 'All tests passed.' : 'Some tests failed.'}`,
  );
  win.destroy();
  app.exit(exitCode);
});
