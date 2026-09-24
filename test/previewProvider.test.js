const assert = require('node:assert/strict');
const Module = require('node:module');

class Uri {
  constructor(path) {
    this.scheme = 'file';
    this.path = path;
    this.fsPath = path;
  }

  toString() {
    return `file://${this.path}`;
  }

  static joinPath(base, ...parts) {
    const path = [base.path, ...parts].join('/').replace(/\/[^/]+\/\.\./g, '');
    return new Uri(path);
  }

  static parse(value) {
    return new Uri(value.replace(/^file:\/\//, ''));
  }
}

const pendingReads = [];
const warnings = [];
const stateValues = new Map();
const configurationResources = [];
const vscode = {
  Uri,
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
      return { get: (_name, fallback) => fallback };
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
