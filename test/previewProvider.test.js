const assert = require('node:assert/strict');
const Module = require('node:module');

class Uri {
  constructor(path, scheme = 'file', authority = '') {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.fsPath = path;
  }

  toString() {
    return `${this.scheme}://${this.authority}${this.path}`;
  }

  static joinPath(base, ...parts) {
    const path = [base.path, ...parts].join('/').replace(/\/[^/]+\/\.\./g, '');
    return new Uri(path, base.scheme, base.authority);
  }

  static parse(value) {
    return new Uri(value.replace(/^file:\/\//, ''));
  }
}

class RelativePattern {
  constructor(baseUri, pattern) {
    this.baseUri = baseUri;
    this.pattern = pattern;
  }
}

const pendingReads = [];
const warnings = [];
const stateValues = new Map();
const configurationResources = [];
const autoRefreshModes = new Map();
const fileWatchers = [];
const vscode = {
  Uri,
  RelativePattern,
  ExtensionMode: { Test: 3 },
  workspace: {
    isTrusted: true,
    fs: {
      readFile: () =>
        new Promise((resolve) => {
          pendingReads.push(resolve);
        }),
    },
    getConfiguration: (_section, resource) => {
      configurationResources.push(resource);
      return {
        get: (name, fallback) =>
          name === 'autoRefresh'
            ? (autoRefreshModes.get(resource.toString()) ?? fallback)
            : fallback,
      };
    },
    createFileSystemWatcher: (pattern) => {
      const watcher = {
        pattern,
        changes: [],
        creates: [],
        disposed: false,
        onDidChange: (callback) => watcher.changes.push(callback),
        onDidCreate: (callback) => watcher.creates.push(callback),
        dispose: () => {
          watcher.disposed = true;
        },
      };
      fileWatchers.push(watcher);
      return watcher;
    },
  },
  window: {
    showWarningMessage: (message) => warnings.push(message),
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  return request === 'vscode'
    ? vscode
    : originalLoad.call(this, request, parent, isMain);
};
const { HtmlPreviewProvider } = require('../dist/previewProvider.js');
Module._load = originalLoad;

function panel() {
  let onDispose;
  const assignments = [];
  const webview = {
    cspSource: 'vscode-resource:',
    asWebviewUri: (value) => value,
    postMessage: async () => true,
    set html(value) {
      assignments.push(value);
    },
  };
  return {
    active: true,
    webview,
    assignments,
    onDidChangeViewState: () => undefined,
    onDidDispose: (callback) => {
      onDispose = callback;
    },
    dispose: () => onDispose(),
  };
}

function provider() {
  return new HtmlPreviewProvider({
    extensionMode: vscode.ExtensionMode.Test,
    extensionUri: new Uri('/extension'),
    workspaceState: {
      get: (key, fallback) => stateValues.get(key) ?? fallback,
      update: async (key, value) => stateValues.set(key, value),
    },
  });
}

async function waitForReads(count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (pendingReads.length >= count) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Expected ${count} read requests`);
}

async function settleRead(index, html) {
  await waitForReads(index + 1);
  pendingReads[index](Buffer.from(html));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function main() {
  const preview = provider();
  const target = new Uri('/workspace/large.html');
  const view = panel();
  const opened = preview.resolveCustomEditor({ uri: target }, view);
  await waitForReads(1);

  const refreshes = Array.from({ length: 20 }, () => preview.refresh(target));
  pendingReads[0](Buffer.from('<html><head></head><body>Old</body></html>'));
  await waitForReads(2);
  pendingReads[1](Buffer.from('<html><head></head><body>Latest</body></html>'));
  await Promise.all([opened, ...refreshes]);

  assert.equal(pendingReads.length, 2);
  assert.equal(view.assignments.length, 1);
  assert.match(view.assignments[0], /Latest/);
  assert.equal(preview.testGetRenderCount(target), 1);
  assert(configurationResources.length > 0);
  assert(configurationResources.every((resource) => resource === target));
  console.log('ok - refresh burst applies only the latest result');

  view.dispose();
  assert.equal(preview.testGetLastRenderedHtml(target), undefined);
  console.log('ok - closing the final panel releases retained HTML');

  const secondPreview = provider();
  const secondTarget = new Uri('/workspace/disposed.html');
  const disposedView = panel();
  const secondOpened = secondPreview.resolveCustomEditor(
    { uri: secondTarget },
    disposedView,
  );
  await waitForReads(3);
  disposedView.dispose();
  pendingReads[2](Buffer.from('<html><head></head><body>Late</body></html>'));
  await secondOpened;
  assert.equal(disposedView.assignments.length, 0);
  assert.equal(warnings.length, 0);
  console.log('ok - disposed panel ignores late render');

  const watchedUri = new Uri('/workspace/generated.html');
  autoRefreshModes.set(watchedUri.toString(), 'onFileChange');
  const watched = provider();
  const watchedView = panel();
  const watchedOpen = watched.resolveCustomEditor(
    { uri: watchedUri },
    watchedView,
  );
  const watcher = fileWatchers.at(-1);
  assert.equal(
    fileWatchers.filter(
      (item) => item.pattern.baseUri.path === '/workspace' && !item.disposed,
    ).length,
    1,
  );
  assert.equal(watcher.pattern.baseUri.path, '/workspace');
  assert.equal(watcher.pattern.pattern, '*');
  await settleRead(3, '<html><body>Initial</body></html>');
  await watchedOpen;
  watcher.changes.forEach((callback) => callback(watchedUri));
  watcher.creates.forEach((callback) => callback(watchedUri));
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settleRead(4, '<html><body>External</body></html>');
  assert.equal(watched.testGetRenderCount(watchedUri), 2);
  console.log(
    'ok - file change and atomic create events debounce to one refresh',
  );

  const beforeSecond = fileWatchers.length;
  const watchedView2 = panel();
  const watchedOpen2 = watched.resolveCustomEditor(
    { uri: watchedUri },
    watchedView2,
  );
  await settleRead(5, '<html><body>Second pane</body></html>');
  await watchedOpen2;
  assert.equal(fileWatchers.length, beforeSecond);
  watchedView.dispose();
  assert.equal(watcher.disposed, false);
  watchedView2.dispose();
  assert.equal(watcher.disposed, true);
  console.log(
    'ok - watcher is shared across panes and disposed after final close',
  );

  const remoteUri = new Uri(
    '/remote/generated.htm',
    'vscode-remote',
    'ssh-remote+host',
  );
  autoRefreshModes.set(remoteUri.toString(), 'onFileChange');
  const remote = provider();
  const remoteView = panel();
  const remoteOpen = remote.resolveCustomEditor({ uri: remoteUri }, remoteView);
  const remoteWatcher = fileWatchers.at(-1);
  assert.equal(remoteWatcher.pattern.baseUri.scheme, 'vscode-remote');
  assert.equal(remoteWatcher.pattern.baseUri.authority, 'ssh-remote+host');
  await settleRead(6, '<html><body>Remote</body></html>');
  await remoteOpen;
  remoteWatcher.changes.forEach((callback) =>
    callback(
      new Uri('/remote/GENERATED.htm', 'vscode-remote', 'ssh-remote+host'),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(pendingReads.length, 7);
  remoteView.dispose();
  console.log('ok - watcher preserves remote URI scheme and path case');

  const toggleUri = new Uri('/workspace/toggle.html');
  const toggle = provider();
  const toggleView = panel();
  const toggleOpen = toggle.resolveCustomEditor({ uri: toggleUri }, toggleView);
  await settleRead(7, '<html><body>Toggle</body></html>');
  await toggleOpen;
  autoRefreshModes.set(toggleUri.toString(), 'onFileChange');
  toggle.handleConfigurationChanged();
  const toggleWatcher = fileWatchers.at(-1);
  toggle.handleDocumentSaved({ uri: toggleUri });
  toggleWatcher.changes.forEach((callback) => callback(toggleUri));
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settleRead(8, '<html><body>Saved</body></html>');
  assert.equal(toggle.testGetRenderCount(toggleUri), 2);
  assert.equal(pendingReads.length, 9);
  autoRefreshModes.set(toggleUri.toString(), 'off');
  toggle.handleDocumentSaved({ uri: toggleUri });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingReads.length, 9);
  toggle.handleConfigurationChanged();
  assert.equal(toggleWatcher.disposed, true);
  toggleView.dispose();
  console.log(
    'ok - save and external change share debounce; off stops watching',
  );

  const specialUri = new Uri('/workspace/chart[1]*.html');
  autoRefreshModes.set(specialUri.toString(), 'onFileChange');
  const special = provider();
  const specialView = panel();
  const specialOpen = special.resolveCustomEditor(
    { uri: specialUri },
    specialView,
  );
  const specialWatcher = fileWatchers.at(-1);
  assert.equal(specialWatcher.pattern.pattern, '*');
  await settleRead(9, '<html><body>Special path</body></html>');
  await specialOpen;
  specialWatcher.changes.forEach((callback) =>
    callback(new Uri('/workspace/unrelated.html')),
  );
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(pendingReads.length, 10);
  specialWatcher.changes.forEach((callback) => callback(specialUri));
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settleRead(10, '<html><body>Updated special path</body></html>');
  assert.equal(special.testGetRenderCount(specialUri), 2);
  if (process.platform === 'win32' || process.platform === 'darwin') {
    specialWatcher.changes.forEach((callback) =>
      callback(new Uri('/WORKSPACE/CHART[1]*.HTML')),
    );
    await new Promise((resolve) => setTimeout(resolve, 320));
    await settleRead(11, '<html><body>Changed casing</body></html>');
    assert.equal(special.testGetRenderCount(specialUri), 3);
  }
  specialView.dispose();
  console.log('ok - watcher matches special filenames and local path casing');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
