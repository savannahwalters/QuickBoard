const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

async function setup(t, fileSystem = fs) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'quickboard-settings-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const handlers = new Map();
  const context = {
    module: { exports: {} },
    process: { env: {} },
    console: { log() {}, error() {} },
    require(name) {
      if (name === 'electron') return { ipcMain: { on() {}, handle: (id, fn) => handlers.set(id, fn) } };
      if (name === 'fs/promises') return fileSystem;
      return require(name);
    },
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../src/electron/fileio.js'), 'utf8'), context);
  await context.module.exports.init({ getPath: () => userData, getAppPath: () => path.resolve(__dirname, '..') });
  context.module.exports.registerIpcHandlers();
  return {
    settingsPath: path.join(userData, 'appsettings.json'),
    call: (name, ...args) => handlers.get(`quickboard:${name}`)({}, ...args),
  };
}

test('rapid desktop saves are serialized and leave the latest complete snapshot', async (t) => {
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const fileSystem = { ...fs, async writeFile(...args) {
    activeWrites++;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try { return await fs.writeFile(...args); } finally { activeWrites--; }
  } };
  const { call, settingsPath } = await setup(t, fileSystem);
  const results = await Promise.all([5, 20, 64].map((size) => call('save-app-settings', { tools: { eraser: { size } } })));
  assert.ok(results.every((result) => result.success));
  assert.equal(maxActiveWrites, 1);
  assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).tools.eraser.size, 64);
});

test('desktop restore replaces customized tool settings with bundled defaults', async (t) => {
  const { call, settingsPath } = await setup(t);
  await call('save-app-settings', { tools: { eraser: { size: 80 }, bucketFill: { tolerance: 0 } } });
  assert.equal((await call('restore-app-settings-defaults')).success, true);
  const defaults = require('../src/electron/config/appsettings-defaults.json');
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')).tools, defaults.tools);
});

test('failed writes preserve the last saved settings and allow a later retry', async (t) => {
  let fail = false;
  const { call, settingsPath } = await setup(t, { ...fs, async writeFile(...args) {
    if (fail) throw new Error('Disk full');
    return fs.writeFile(...args);
  } });
  await call('save-app-settings', { tools: { pencil: { size: 17 } } });
  fail = true;
  assert.equal((await call('restore-app-settings-defaults')).success, false);
  assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).tools.pencil.size, 17);
  fail = false;
  assert.equal((await call('save-app-settings', { tools: { pencil: { size: 42 } } })).success, true);
  assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).tools.pencil.size, 42);
});
