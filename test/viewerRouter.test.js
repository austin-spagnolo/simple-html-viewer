const assert = require('node:assert/strict');
const Module = require('node:module');

class TabInputCustom {
  constructor(uri, viewType = 'simpleHtmlViewer.preview') {
    this.uri = uri;
    this.viewType = viewType;
  }
}

function uri(scheme = 'file', path = '/workspace/page.html') {
  return {
    scheme,
    path,
    fsPath: path,
    authority: scheme === 'file' ? '' : 'ssh-remote+host',
    query: '',
    fragment: '',
    toString() {
      return `${this.scheme}://${this.authority}${this.path}`;
    },
    with(change) {
      return Object.assign(uri(this.scheme, this.path), this, change);
    },
  };
}

let mode = 'webview';
let allowInsecureContent = false;
let activeContent = 'trustedWorkspaces';
let browserAvailable = true;
let workspaceFolder = { uri: uri('file', '/workspace') };
const calls = [];
const messages = [];

const vscode = {
  version: '1.139.0',
  env: { remoteName: undefined },
  ViewColumn: { Beside: 2 },
  TabInputCustom,
  workspace: {
    isTrusted: true,
    getWorkspaceFolder: (resource) => {
      if (!workspaceFolder) return undefined;
      const root = workspaceFolder.uri.path;
      return resource.path.startsWith(`${root}/`) ? workspaceFolder : undefined;
    },
    getConfiguration: () => ({
      get(name, fallback) {
        return (
          {
            viewer: mode,
            activeContent,
            allowInsecureContent,
          }[name] ?? fallback
        );
      },
    }),
  },
  window: {
    tabGroups: { all: [] },
    showInformationMessage: (message) => messages.push(message),
  },
  commands: {
    getCommands: async () =>
      browserAvailable ? ['workbench.action.browser.open'] : [],
    executeCommand: async (...args) => {
      calls.push(args);
    },
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  return request === 'vscode'
    ? vscode
    : originalLoad.call(this, request, parent, isMain);
};
const { ViewerRouter } = require('../dist/viewerRouter.js');
Module._load = originalLoad;

function reset() {
  mode = 'webview';
  allowInsecureContent = false;
  activeContent = 'trustedWorkspaces';
  browserAvailable = true;
  workspaceFolder = { uri: uri('file', '/workspace') };
  vscode.version = '1.139.0';
  vscode.env.remoteName = undefined;
  vscode.workspace.isTrusted = true;
  vscode.window.tabGroups.all = [];
  calls.length = 0;
  messages.length = 0;
}

async function check(name, run) {
  reset();
  await run();
  console.log(`ok - ${name}`);
}

async function main() {
  await check('default route keeps the remote-capable webview', async () => {
    await new ViewerRouter().open(uri());
    assert.equal(calls[0][0], 'vscode.openWith');
  });

  await check('auto preserves restrictive content settings', async () => {
    mode = 'auto';
    activeContent = 'off';
    await new ViewerRouter().open(uri());
    assert.equal(calls[0][0], 'vscode.openWith');
  });

  await check('auto delegates only eligible local files', async () => {
    mode = 'auto';
    await new ViewerRouter().open(uri());
    assert.equal(calls[0][0], 'workbench.action.browser.open');
    assert.equal(calls[0][1].url, 'file:///workspace/page.html');
    assert(calls[0][1].reuseUrlFilter);
  });

  await check(
    'insecure webview content setting does not affect auto routing',
    async () => {
      mode = 'auto';
      allowInsecureContent = true;
      await new ViewerRouter().open(uri());
      assert.equal(calls[0][0], 'workbench.action.browser.open');
    },
  );

  await check(
    'explicit native mode follows VS Code content policy',
    async () => {
      mode = 'integratedBrowser';
      activeContent = 'off';
      await new ViewerRouter().open(uri());
      assert.equal(calls[0][0], 'workbench.action.browser.open');
    },
  );

  await check('remote resources remain in the webview', async () => {
    mode = 'integratedBrowser';
    await new ViewerRouter().open(uri('vscode-remote'));
    assert.equal(calls[0][0], 'vscode.openWith');
    assert.match(messages[0], /remote HTML/i);
  });

  await check('untrusted and loose files remain in the webview', async () => {
    mode = 'auto';
    vscode.workspace.isTrusted = false;
    await new ViewerRouter().open(uri());
    assert.equal(calls[0][0], 'vscode.openWith');
    calls.length = 0;
    workspaceFolder = { uri: uri('file', '/workspace') };
    await new ViewerRouter().open(uri('file', '/elsewhere/page.html'));
    assert.equal(calls[0][0], 'vscode.openWith');
    calls.length = 0;
    vscode.workspace.isTrusted = true;
    workspaceFolder = undefined;
    await new ViewerRouter().open(uri());
    assert.equal(calls[0][0], 'vscode.openWith');
  });

  await check('missing browser command falls back', async () => {
    mode = 'integratedBrowser';
    browserAvailable = false;
    await new ViewerRouter().open(uri());
    assert.equal(calls[0][0], 'vscode.openWith');
    assert.match(messages[0], /unavailable/i);
  });

  await check('existing preview group is reused', async () => {
    const existingUri = uri();
    vscode.window.tabGroups.all = [
      {
        viewColumn: 4,
        tabs: [{ input: new TabInputCustom(existingUri) }],
      },
    ];
    await new ViewerRouter().open(uri('file', '/workspace/other.html'));
    assert.equal(calls[0][0], 'vscode.openWith');
    assert.equal(calls[0][3].viewColumn, 4);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
