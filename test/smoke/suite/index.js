const assert = require('node:assert/strict');
const vscode = require('vscode');

const PREVIEW_VIEW_TYPE = 'simpleHtmlViewer.preview';
const EXTENSION_ID = 'austin-spagnolo.simple-html-viewer';
const UPDATED_TITLE = 'Simple HTML Viewer Test Document Updated';

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

async function createSmokeFixture() {
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
  const sourceUri = vscode.Uri.joinPath(
    workspaceRoot,
    'test',
    'user-test.html',
  );
  const fixtureUri = vscode.Uri.joinPath(
    workspaceRoot,
    'test',
    `.smoke-${Date.now()}.html`,
  );

  const bytes = await vscode.workspace.fs.readFile(sourceUri);
  await vscode.workspace.fs.writeFile(fixtureUri, bytes);
  return fixtureUri;
}

async function run() {
  await closeAllEditors();

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert(extension, `Extension ${EXTENSION_ID} should be available`);
  await extension.activate();

  const commands = await waitFor(async () => {
    const availableCommands = await vscode.commands.getCommands(true);
    return availableCommands.includes('simpleHtmlViewer.openPreview')
      ? availableCommands
      : undefined;
  });
  assert(commands.includes('simpleHtmlViewer.openPreview'));
  assert(commands.includes('simpleHtmlViewer.refreshPreview'));
  assert(commands.includes('simpleHtmlViewer._test.setZoom'));
  assert(commands.includes('simpleHtmlViewer._test.getZoom'));
  assert(commands.includes('simpleHtmlViewer._test.getRenderCount'));
  assert(commands.includes('simpleHtmlViewer._test.getLastRenderedHtml'));

  const targetUri = await createSmokeFixture();

  try {
    const document = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand(
      'simpleHtmlViewer.openPreview',
      targetUri,
    );

    const previewTab = await waitFor(() => findPreviewTab());
    assert.equal(previewTab.input.viewType, PREVIEW_VIEW_TYPE);
    assert.match(previewTab.label, /\.smoke-.*\.html/i);

    const initialRenderCount = await waitFor(async () => {
      const count = await vscode.commands.executeCommand(
        'simpleHtmlViewer._test.getRenderCount',
        targetUri,
      );
      return count > 0 ? count : undefined;
    });

    const initialRenderedHtml = await vscode.commands.executeCommand(
      'simpleHtmlViewer._test.getLastRenderedHtml',
      targetUri,
    );
    assert.match(initialRenderedHtml, /Simple HTML Viewer Test Document/);
    assert.match(initialRenderedHtml, /id="simple-html-viewer-content"/);
    assert.match(initialRenderedHtml, /transform = value === 100/);
    assert.doesNotMatch(initialRenderedHtml, /srcdoc="/);
    assert.match(initialRenderedHtml, /color-scheme:only light/);

    await vscode.commands.executeCommand(
      'simpleHtmlViewer._test.setZoom',
      targetUri,
      140,
    );
    assert.equal(
      await vscode.commands.executeCommand(
        'simpleHtmlViewer._test.getZoom',
        targetUri,
      ),
      140,
    );

    await closeAllEditors();

    const reopenedDocument = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(reopenedDocument);
    await vscode.commands.executeCommand(
      'simpleHtmlViewer.openPreview',
      targetUri,
    );

    await waitFor(() => findPreviewTab());

    const zoomRenderedHtml = await waitFor(async () => {
      const html = await vscode.commands.executeCommand(
        'simpleHtmlViewer._test.getLastRenderedHtml',
        targetUri,
      );
      return html && html.includes('simple-html-viewer-zoom-label">140%')
        ? html
        : undefined;
    });
    assert.match(zoomRenderedHtml, /simple-html-viewer-zoom-label">140%/);

    const editor = await vscode.window.showTextDocument(reopenedDocument);
    await editor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        reopenedDocument.positionAt(0),
        reopenedDocument.positionAt(reopenedDocument.getText().length),
      );
      editBuilder.replace(
        fullRange,
        reopenedDocument
          .getText()
          .replace('Simple HTML Viewer Test Document', UPDATED_TITLE),
      );
    });
    await reopenedDocument.save();

    const refreshedRenderCount = await waitFor(async () => {
      const count = await vscode.commands.executeCommand(
        'simpleHtmlViewer._test.getRenderCount',
        targetUri,
      );
      return count > initialRenderCount ? count : undefined;
    });
    assert(refreshedRenderCount > initialRenderCount);

    const refreshedHtml = await waitFor(async () => {
      const html = await vscode.commands.executeCommand(
        'simpleHtmlViewer._test.getLastRenderedHtml',
        targetUri,
      );
      return html && html.includes(UPDATED_TITLE) ? html : undefined;
    });
    assert.match(refreshedHtml, /Simple HTML Viewer Test Document Updated/);

    await vscode.workspace.fs.delete(targetUri);
    await closeAllEditors();
  } finally {
    await closeAllEditors();
    await vscode.workspace.fs.delete(targetUri).catch(() => undefined);
  }
}

module.exports = {
  run,
};
