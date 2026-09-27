const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const PREVIEW_VIEW_TYPE = 'simpleHtmlViewer.preview';
const EXTENSION_ID = 'austin-spagnolo.simple-html-viewer';

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }

    await delay(100);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function getAllTabs() {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs);
}

function findPreviewTab() {
  return getAllTabs().find((tab) => {
    const input = tab.input;
    return (
      input &&
      typeof input === 'object' &&
      'viewType' in input &&
      input.viewType === PREVIEW_VIEW_TYPE
    );
  });
}

async function closeAllEditors() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => getAllTabs().length === 0, 5000).catch(() => undefined);
}

async function run() {
  await closeAllEditors();

  const extension = await waitFor(() =>
    vscode.extensions.getExtension(EXTENSION_ID),
  );
  await extension.activate();

  if (process.env.SIMPLE_HTML_VIEWER_EXPECT_PACKAGED === '1') {
    // In VSIX mode the real extension should come from the isolated install
    // directory, not from the repository workspace we opened for fixtures.
    const workspaceRoot = path.resolve(
      process.env.SIMPLE_HTML_VIEWER_WORKSPACE ?? '',
    );
    assert.notEqual(path.resolve(extension.extensionPath), workspaceRoot);
  }

  const commands = await waitFor(async () => {
    const availableCommands = await vscode.commands.getCommands(true);
    return availableCommands.includes('simpleHtmlViewer.openPreview')
      ? availableCommands
      : undefined;
  });
  assert(commands.includes('simpleHtmlViewer.openPreview'));
  assert(commands.includes('simpleHtmlViewer.refreshPreview'));
  assert(commands.includes('simpleHtmlViewer.zoomIn'));
  assert(commands.includes('simpleHtmlViewer.zoomOut'));
  assert(commands.includes('simpleHtmlViewer.resetZoom'));
  assert.equal(
    vscode.workspace.getConfiguration('simpleHtmlViewer').get('viewer'),
    'webview',
  );

  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
  const targetUri = vscode.Uri.joinPath(
    workspaceRoot,
    'test',
    'user-test.html',
  );
  const document = await vscode.workspace.openTextDocument(targetUri);
  await vscode.window.showTextDocument(document);

  await vscode.commands.executeCommand(
    'simpleHtmlViewer.openPreview',
    targetUri,
  );

  const previewTab = await waitFor(() => findPreviewTab());
  assert.equal(previewTab.input.viewType, PREVIEW_VIEW_TYPE);
  assert.match(previewTab.label, /user-test\.html/i);

  await closeAllEditors();
}

module.exports = {
  run,
};
