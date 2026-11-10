const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({ canceled = false, extension = 'png', readError = false } = {}) {
  const handlers = new Map();
  const win = { isDestroyed: () => false };
  let pickerArgs;
  let reads = 0;
  const context = {
    console: { error() {} },
    module: { exports: {} },
    require(id) {
      if (id === 'electron')
        return {
          ipcMain: { on() {}, handle: (name, handler) => handlers.set(name, handler) },
          BrowserWindow: { fromWebContents: () => win },
          dialog: {
            showOpenDialog: async (...args) => {
              pickerArgs = args;
              return { canceled, filePaths: canceled ? [] : [`/images/example.${extension}`] };
            },
          },
        };
      if (id === 'fs/promises')
        return {
          readFile: async () => {
            reads++;
            if (readError) throw new Error('Unreadable file');
            return Buffer.from('image bytes');
          },
        };
      return require(id);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/electron/fileio.js'), 'utf8'),
    context
  );
  context.module.exports.registerIpcHandlers();
  return {
    pick: () => handlers.get('quickboard:pick-image-file')({ sender: {} }),
    win,
    args: () => pickerArgs,
    reads: () => reads,
  };
}

test('opens a window-owned native picker and returns selected image bytes and MIME type', async () => {
  for (const [extension, type] of [
    ['png', 'image/png'],
    ['SVG', 'image/svg+xml'],
  ]) {
    const state = setup({ extension });
    const result = await state.pick();
    assert.equal(state.args()[0], state.win);
    assert.equal(state.args()[1].title, 'Import Image');
    assert.equal(result.success, true);
    assert.equal(result.name, `example.${extension}`);
    assert.equal(result.type, type);
    assert.equal(Buffer.from(result.data, 'base64').toString(), 'image bytes');
  }
});

test('cancelling the picker does not read or import a file', async () => {
  const state = setup({ canceled: true });
  const result = await state.pick();
  assert.equal(result.success, true);
  assert.equal(result.cancelled, true);
  assert.equal(state.reads(), 0);
});

test('read failures and unsupported formats are reported explicitly', async () => {
  for (const options of [{ readError: true }, { extension: 'exe' }]) {
    const result = await setup(options).pick();
    assert.equal(result.success, false);
    assert.ok(result.message);
  }
});
