const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function setup() {
  const ipcRenderer = new EventEmitter();
  let bridge;
  const context = {
    console,
    require(name) {
      assert.equal(name, 'electron');
      return {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, 'quickboard');
            bridge = api;
          },
        },
      };
    },
  };
  const source = await fs.readFile(path.join(__dirname, '../src/electron/preload.js'), 'utf8');
  vm.runInNewContext(source, context);
  return {
    bridge,
    send: (payload) => ipcRenderer.emit('quickboard:load-data', {}, payload),
  };
}

test('buffers launch files until the renderer registers its load handler', async () => {
  const { bridge, send } = await setup();
  const launch = {
    filePath: '/projects/launch.sbd',
    content: new Uint8Array([1, 2, 3]),
    isBinary: true,
  };
  send(launch);
  const received = [];
  bridge.onLoadData((payload) => received.push(payload));
  assert.deepEqual(received, [launch]);
});

test('delivers queued files in arrival order and subsequent files immediately', async () => {
  const { bridge, send } = await setup();
  const first = { filePath: '/projects/first.sbd', content: '{}' };
  const second = { filePath: '/projects/second.sbd', content: '{}' };
  const third = { filePath: '/projects/third.sbd', content: '{}' };
  send(first);
  send(second);
  const received = [];
  bridge.onLoadData((payload) => received.push(payload));
  send(third);
  assert.deepEqual(received, [first, second, third]);
});

test('unsubscribes handlers and buffers files until a replacement subscribes', async () => {
  const { bridge, send } = await setup();
  const received = [];
  const unsubscribe = bridge.onLoadData((payload) => received.push(payload));
  unsubscribe();
  const pending = { filePath: '/projects/pending.sbd', content: '{}' };
  send(pending);
  assert.deepEqual(received, []);
  const replacement = [];
  bridge.onLoadData((payload) => replacement.push(payload));
  assert.deepEqual(replacement, [pending]);
});

test('does not replay consumed launch data to additional subscribers', async () => {
  const { bridge, send } = await setup();
  const launch = { filePath: '/projects/launch.sbd', content: '{}' };
  send(launch);
  const first = [];
  const second = [];
  const unsubscribe = bridge.onLoadData((payload) => first.push(payload));
  bridge.onLoadData((payload) => second.push(payload));
  assert.deepEqual(first, [launch]);
  assert.deepEqual(second, []);
  const live = { filePath: '/projects/live.sbd', content: '{}' };
  send(live);
  assert.deepEqual(first, [launch, live]);
  assert.deepEqual(second, [live]);
  unsubscribe();
  send(live);
  assert.deepEqual(first, [launch, live]);
  assert.deepEqual(second, [live, live]);
});
