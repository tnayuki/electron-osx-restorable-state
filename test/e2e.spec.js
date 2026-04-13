const { test: base, expect } = require('@playwright/test');

// Run all tests serially in the same worker to avoid re-packaging
const test = base.extend({});
test.describe.configure({ mode: 'serial' });

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const E2E_APP_DIR = path.join(__dirname, 'e2e-app');
const DIST_DIR = path.join(ROOT, 'dist', 'e2e');
const BUNDLE_ID = 'com.tnayuki.restorable-state-e2e';

// Generate unique prefix per test run to avoid state collision across runs.
// macOS 15+ stores savedState in Daemon Containers with UUIDs, making
// file-based cleanup unreliable. Using unique identifiers avoids the problem.
const RUN_ID = crypto.randomBytes(4).toString('hex');

let appBinaryPath;

function launchApp(instructionsPath, resultsPath) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.E2E_INSTRUCTIONS = instructionsPath;
    env.E2E_RESULTS = resultsPath;

    const proc = spawn(appBinaryPath, [], { stdio: 'pipe', env });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d;
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`App timed out.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 30_000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function writeTempJson(tmpDir, name, data) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

test.beforeAll(async () => {
  const { packager } = require('@electron/packager');

  const paths = await packager({
    dir: E2E_APP_DIR,
    out: DIST_DIR,
    name: 'restorable-state-e2e',
    platform: 'darwin',
    arch: process.arch,
    overwrite: true,
    appBundleId: BUNDLE_ID,
    afterCopy: [
      ({ buildPath }) => {
        const resourcesDir = path.dirname(buildPath);

        // Copy index.js to Resources/
        fs.copyFileSync(
          path.join(ROOT, 'index.js'),
          path.join(resourcesDir, 'index.js'),
        );

        // Copy build/Release/restorable_state.node to Resources/build/Release/
        const buildRelDir = path.join(resourcesDir, 'build', 'Release');
        fs.mkdirSync(buildRelDir, { recursive: true });
        fs.copyFileSync(
          path.join(ROOT, 'build', 'Release', 'restorable_state.node'),
          path.join(buildRelDir, 'restorable_state.node'),
        );
      },
    ],
  });

  const appDir = paths[0];
  appBinaryPath = path.join(
    appDir,
    'restorable-state-e2e.app',
    'Contents',
    'MacOS',
    'restorable-state-e2e',
  );
});

test('custom state is persisted and restored across launches', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-state-'));
  const id = `state-${RUN_ID}`;
  const stateData = {
    note: 'hello',
    count: 42,
    items: ['a', 'b', 3],
    nested: { value: null, flags: [true, false, null] },
  };

  try {
    // First launch: set custom state with unique identifier
    const inst1 = writeTempJson(tmpDir, 'inst1.json', {
      windows: [
        {
          identifier: id,
          bounds: { x: 100, y: 200, width: 400, height: 300 },
          state: stateData,
        },
      ],
      delayBeforeQuit: 2000,
    });
    const res1 = path.join(tmpDir, 'res1.json');
    await launchApp(inst1, res1);

    const r1 = JSON.parse(fs.readFileSync(res1, 'utf8'));
    // First launch with a unique identifier should have no prior state
    expect(r1.windows[0].restoredState).toBeNull();

    // Second launch: verify restored state
    const inst2 = writeTempJson(tmpDir, 'inst2.json', {
      windows: [{ identifier: id }],
      delayBeforeQuit: 1000,
    });
    const res2 = path.join(tmpDir, 'res2.json');
    await launchApp(inst2, res2);

    const r2 = JSON.parse(fs.readFileSync(res2, 'utf8'));
    expect(r2.windows[0].restoredState).toEqual(stateData);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('app lifecycle events fire normally (app.quit)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-events-'));
  const id = `ev1-${RUN_ID}`;

  try {
    const inst = writeTempJson(tmpDir, 'inst.json', {
      windows: [{ identifier: id, state: { test: true } }],
      delayBeforeQuit: 1500,
    });
    const res = path.join(tmpDir, 'res.json');
    await launchApp(inst, res);

    const events = JSON.parse(fs.readFileSync(`${res}.events`, 'utf8'));
    // app.quit() skips window-all-closed per Electron docs
    expect(events).toEqual(['before-quit', 'will-quit', 'quit']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('app lifecycle events fire normally (window close)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-events2-'));
  const id = `ev2-${RUN_ID}`;

  try {
    const inst = writeTempJson(tmpDir, 'inst.json', {
      windows: [{ identifier: id, state: { test: true } }],
      delayBeforeQuit: 1500,
      quitViaClose: true,
    });
    const res = path.join(tmpDir, 'res.json');
    await launchApp(inst, res);

    const events = JSON.parse(fs.readFileSync(`${res}.events`, 'utf8'));
    // Closing windows triggers window-all-closed, then app.quit()
    expect(events).toEqual([
      'window-all-closed',
      'before-quit',
      'will-quit',
      'quit',
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('window bounds are approximately restored', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-bounds-'));
  const id = `bounds-${RUN_ID}`;
  const targetBounds = { x: 200, y: 150, width: 500, height: 400 };

  try {
    // First launch: set specific bounds
    const inst1 = writeTempJson(tmpDir, 'inst1.json', {
      windows: [
        {
          identifier: id,
          bounds: targetBounds,
          state: { marker: true },
        },
      ],
      delayBeforeQuit: 2000,
    });
    const res1 = path.join(tmpDir, 'res1.json');
    await launchApp(inst1, res1);

    // Second launch: check restored bounds
    const inst2 = writeTempJson(tmpDir, 'inst2.json', {
      windows: [{ identifier: id }],
      delayBeforeQuit: 1000,
    });
    const res2 = path.join(tmpDir, 'res2.json');
    await launchApp(inst2, res2);

    const r2 = JSON.parse(fs.readFileSync(res2, 'utf8'));
    const b = r2.windows[0].bounds;

    expect(Math.abs(b.x - targetBounds.x)).toBeLessThan(50);
    expect(Math.abs(b.y - targetBounds.y)).toBeLessThan(50);
    expect(Math.abs(b.width - targetBounds.width)).toBeLessThan(50);
    expect(Math.abs(b.height - targetBounds.height)).toBeLessThan(50);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('multiple windows are restored via restore-window event', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-multi-'));
  const id1 = `multi-a-${RUN_ID}`;
  const id2 = `multi-b-${RUN_ID}`;
  const state1 = { role: 'editor', file: 'main.js' };
  const state2 = { role: 'terminal', cwd: '/tmp' };

  try {
    // First launch: create two windows with custom state
    const inst1 = writeTempJson(tmpDir, 'inst1.json', {
      windows: [
        {
          identifier: id1,
          bounds: { x: 100, y: 100, width: 400, height: 300 },
          state: state1,
        },
        {
          identifier: id2,
          bounds: { x: 550, y: 100, width: 400, height: 300 },
          state: state2,
        },
      ],
      delayBeforeQuit: 3000,
    });
    const res1 = path.join(tmpDir, 'res1.json');
    await launchApp(inst1, res1);

    // Second launch: list expected identifiers so restore-window handler
    // creates windows for them (filtering out stale state from other runs)
    const inst2 = writeTempJson(tmpDir, 'inst2.json', {
      windows: [{ identifier: id1 }, { identifier: id2 }],
      delayBeforeQuit: 1000,
    });
    const res2 = path.join(tmpDir, 'res2.json');
    await launchApp(inst2, res2);

    const r2 = JSON.parse(fs.readFileSync(res2, 'utf8'));

    // Both windows should be restored via the event
    expect(r2.windows.length).toBe(2);

    const w1 = r2.windows.find((w) => w.identifier === id1);
    const w2 = r2.windows.find((w) => w.identifier === id2);
    expect(w1).toBeTruthy();
    expect(w2).toBeTruthy();

    // restoredState (passed via restore-window event) should match
    expect(w1.restoredState).toEqual(state1);
    expect(w2.restoredState).toEqual(state2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
