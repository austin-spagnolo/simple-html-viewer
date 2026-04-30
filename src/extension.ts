import * as vscode from 'vscode';
import { HtmlPreviewProvider } from './previewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new HtmlPreviewProvider(context);

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
        const target = resource ?? vscode.window.activeTextEditor?.document.uri;
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

        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          HtmlPreviewProvider.viewType,
          vscode.ViewColumn.Beside,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'simpleHtmlViewer.refreshPreview',
      async (resource?: vscode.Uri) => {
        provider.refresh(
          resource ?? vscode.window.activeTextEditor?.document.uri,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      provider.handleDocumentSaved(document);
    }),
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
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
