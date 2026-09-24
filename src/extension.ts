import * as vscode from 'vscode';
import { HtmlPreviewProvider } from './previewProvider';
import { activeHtmlResource, ViewerRouter } from './viewerRouter';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new HtmlPreviewProvider(context);
  const router = new ViewerRouter();

  // Register the provider VS Code calls when an HTML file is opened with this
  // custom preview.
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      HtmlPreviewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: true,
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'simpleHtmlViewer.openPreview',
      async (resource?: vscode.Uri) => {
        // Context menus pass a resource; command-palette launches fall back to
        // whatever editor the user currently has active.
        const target = resource ?? activeHtmlResource();
        if (!target) {
          void vscode.window.showInformationMessage(
            'Open an HTML file to preview it.',
          );
          return;
        }

        if (!HtmlPreviewProvider.isHtmlUri(target)) {
          void vscode.window.showWarningMessage(
            'Simple HTML Viewer only supports .html and .htm files.',
          );
          return;
        }

        await router.open(target);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'simpleHtmlViewer.refreshPreview',
      async (resource?: vscode.Uri) => {
        await provider.refresh(
          resource ?? provider.getActivePreviewUri() ?? activeHtmlResource(),
        );
      },
    ),
    vscode.commands.registerCommand('simpleHtmlViewer.zoomIn', async () =>
      provider.zoomIn(),
    ),
    vscode.commands.registerCommand('simpleHtmlViewer.zoomOut', async () =>
      provider.zoomOut(),
    ),
    vscode.commands.registerCommand('simpleHtmlViewer.resetZoom', async () =>
      provider.resetZoom(),
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      provider.handleDocumentSaved(document);
    }),
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    // The smoke tests need a narrow view into preview state without exposing
    // these helpers to normal extension users.
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'simpleHtmlViewer._test.setZoom',
        async (resource: vscode.Uri, zoom: number) => {
          await provider.testSetZoom(resource, zoom);
        },
      ),
      vscode.commands.registerCommand(
        'simpleHtmlViewer._test.getZoom',
        (resource: vscode.Uri) => provider.testGetZoom(resource),
      ),
      vscode.commands.registerCommand(
        'simpleHtmlViewer._test.getRenderCount',
        (resource: vscode.Uri) => provider.testGetRenderCount(resource),
      ),
      vscode.commands.registerCommand(
        'simpleHtmlViewer._test.getLastRenderedHtml',
        (resource: vscode.Uri) => provider.testGetLastRenderedHtml(resource),
      ),
    );
  }
}

export function deactivate(): void {
  // Nothing to dispose beyond extension subscriptions.
}
