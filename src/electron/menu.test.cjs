const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMenu(platform) {
  const windows = [];
  let template;
  let focused;
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.messages = [];
      this.handlers = {};
      this.webContents = {
        isDestroyed: () => false,
        send: (...args) => this.messages.push(args),
        undo: () => {
          this.undone = true;
        },
        redo: () => {
          this.redone = true;
        },
      };
      windows.push(this);
    }
    isDestroyed() {
      return false;
    }
    setMenuBarVisibility() {}
    loadURL(url) {
      this.url = url;
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    focus() {
      focused = this;
    }
    static getAllWindows() {
      return windows;
    }
    static getFocusedWindow() {
      return focused;
    }
  }
  const electron = {
    BrowserWindow,
    nativeTheme: {},
    Menu: {
      buildFromTemplate: (value) => {
        template = value;
        return value;
      },
      setApplicationMenu() {},
    },
  };
  const context = {
    require: (id) => (id === 'electron' ? electron : require(id)),
    process: { platform },
    module: { exports: {} },
    URL,
    global: {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'menu.js'), 'utf8'), context);
  const main = new BrowserWindow({});
  main.focus();
  const app = { name: 'QuickBoard', getAppPath: () => process.cwd() };
  const rebuild = (preferredWindow, hooks) =>
    context.module.exports.buildMenu(app, preferredWindow, hooks);
  rebuild(main);
  return { template, main, windows, rebuild };
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: shortcuts placement, accelerators, and single dialog instance`, () => {
    const { template, main, windows } = loadMenu(platform);
    const menu = template.find(
      (item) => item.label === (platform === 'darwin' ? 'QuickBoard' : 'File')
    );
    const index = menu.submenu.findIndex((item) => item.label === 'Keyboard Shortcuts');
    assert.ok(index >= 0);
    if (platform === 'darwin') assert.equal(menu.submenu[index - 1].label, 'About QuickBoard');
    assert.equal(menu.submenu.find((item) => item.label === 'Settings').accelerator, 'CmdOrCtrl+,');
    const file = template.find((item) => item.label === 'File');
    const importImage = file.submenu.find((item) => item.label === 'Import').submenu[0];
    importImage.click();
    assert.deepEqual(main.messages.at(-1), ['quickboard:import-image', undefined]);
    const edit = template.find((item) => item.label === 'Edit');
    edit.submenu.find((item) => item.label === 'Copy Selection / Text').click();
    assert.deepEqual(main.messages.at(-1), ['quickboard:shortcut', 'copy']);
    edit.submenu.find((item) => item.label === 'Paste Selection / Text').click();
    assert.deepEqual(main.messages.at(-1), ['quickboard:shortcut', 'paste']);
    assert.equal(file.submenu.find((item) => item.role === 'close').accelerator, 'CmdOrCtrl+w');
    const quit =
      platform === 'darwin'
        ? menu.submenu.find((item) => item.role === 'quit')
        : template.find((item) => item.role === 'quit');
    assert.equal(quit.accelerator, 'CmdOrCtrl+q');
    menu.submenu[index].click();
    assert.equal(new URL(windows[1].url).searchParams.get('dialog'), 'shortcuts');
    menu.submenu[index].click();
    assert.equal(windows.length, 2);
  });

  test(`${platform}: undo targets the focused window rather than the project behind it`, () => {
    const { template, main, windows } = loadMenu(platform);
    const undo = template
      .find((item) => item.label === 'Edit')
      .submenu.find((item) => item.label === 'Undo');
    undo.click();
    assert.equal(main.messages.length, 1);
    assert.equal(main.messages[0][1], 'undo');
    const menu = template.find(
      (item) => item.label === (platform === 'darwin' ? 'QuickBoard' : 'File')
    );
    menu.submenu.find((item) => item.label === 'Keyboard Shortcuts').click();
    windows[1].focus();
    undo.click();
    assert.equal(windows[1].undone, true);
    assert.equal(main.messages.length, 1);
  });

  test(`${platform}: rebuilt menus never send project actions to dialog windows`, () => {
    const { template, main, windows, rebuild } = loadMenu(platform);
    const menu = template.find(
      (item) => item.label === (platform === 'darwin' ? 'QuickBoard' : 'File')
    );
    menu.submenu.find((item) => item.label === 'Keyboard Shortcuts').click();
    const targets = [];
    const rebuilt = rebuild(windows[1], { onSave: (target) => targets.push(target) });
    const save = rebuilt
      .find((item) => item.label === 'File')
      .submenu.find((item) => item.label === 'Save');
    save.click();
    assert.deepEqual(targets, [main]);
    main.isDestroyed = () => true;
    save.click();
    assert.deepEqual(targets, [main]);
  });
}
