import * as path from 'path';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';

type AutoRefreshMode = 'onSave' | 'off';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'zoomReset' }
  | { type: 'manualRefresh' }
  | { type: 'zoomChanged'; zoom: number };

export class HtmlPreviewProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'simpleHtmlViewer.preview';
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public static isHtmlUri(uri: vscode.Uri): boolean {
    const extension = path.extname(uri.fsPath).toLowerCase();
    return extension === '.html' || extension === '.htm';
  }

  public async openCustomDocument(
    uri: vscode.Uri,
  ): Promise<vscode.CustomDocument> {
    return {
      uri,
      dispose: () => undefined,
    };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const resourceRoot = vscode.Uri.joinPath(document.uri, '..');
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot],
    };
    webviewPanel.title = `${path.basename(document.uri.fsPath)} Preview`;
    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview);

    this.registerPanel(document.uri, webviewPanel);

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
        case 'manualRefresh':
          await this.renderDocument(webviewPanel, document.uri);
          break;
        case 'zoomIn':
          await this.adjustZoom(webviewPanel, 1);
          break;
        case 'zoomOut':
          await this.adjustZoom(webviewPanel, -1);
          break;
        case 'zoomReset':
          await this.setZoom(webviewPanel, this.getDefaultZoom());
          break;
        case 'zoomChanged':
          await this.context.workspaceState.update(
            this.zoomStateKey(document.uri),
            message.zoom,
          );
          break;
        default:
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      this.unregisterPanel(document.uri, webviewPanel);
    });
  }

  public handleDocumentSaved(document: vscode.TextDocument): void {
    if (!HtmlPreviewProvider.isHtmlUri(document.uri)) {
      return;
    }

    if (this.getAutoRefreshMode() !== 'onSave') {
      return;
    }

    this.refresh(document.uri);
  }

  public refresh(uri: vscode.Uri | undefined): void {
    if (!uri) {
      return;
    }

    const key = this.panelKey(uri);
    const panels = this.panels.get(key);
    if (!panels) {
      return;
    }

    for (const panel of panels) {
      void this.renderDocument(panel, uri);
    }
  }

  private registerPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
    const key = this.panelKey(uri);
    const panels = this.panels.get(key) ?? new Set<vscode.WebviewPanel>();
    panels.add(panel);
    this.panels.set(key, panels);
  }

  private unregisterPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
    const key = this.panelKey(uri);
    const panels = this.panels.get(key);
    if (!panels) {
      return;
    }

    panels.delete(panel);
    if (panels.size === 0) {
      this.panels.delete(key);
    }
  }

  private async renderDocument(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
  ): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(documentUri);
    const sourceHtml = new TextDecoder('utf-8').decode(bytes);
    const directoryUri = vscode.Uri.joinPath(documentUri, '..');
    const baseHref = this.ensureTrailingSlash(
      panel.webview.asWebviewUri(directoryUri).toString(),
    );
    const zoom = this.getStoredZoom(documentUri);

    await panel.webview.postMessage({
      type: 'render',
      html: this.withBaseHref(sourceHtml, baseHref),
      autoRefresh: this.getAutoRefreshMode(),
      zoom,
    });
  }

  private async adjustZoom(
    panel: vscode.WebviewPanel,
    direction: 1 | -1,
  ): Promise<void> {
    const uri = this.findUriForPanel(panel);
    if (!uri) {
      return;
    }

    const nextZoom = Math.max(
      10,
      Math.min(
        500,
        this.getStoredZoom(uri) + direction * this.getZoomStep(),
      ),
    );
    await this.setZoom(panel, nextZoom, uri);
  }

  private async setZoom(
    panel: vscode.WebviewPanel,
    zoom: number,
    uri = this.findUriForPanel(panel),
  ): Promise<void> {
    if (!uri) {
      return;
    }

    await this.context.workspaceState.update(this.zoomStateKey(uri), zoom);
    await panel.webview.postMessage({
      type: 'setZoom',
      zoom,
    });
  }

  private findUriForPanel(panel: vscode.WebviewPanel): vscode.Uri | undefined {
    for (const [key, panels] of this.panels.entries()) {
      if (panels.has(panel)) {
        return vscode.Uri.parse(key);
      }
    }

    return undefined;
  }

  private panelKey(uri: vscode.Uri): string {
    return uri.toString();
  }

  private zoomStateKey(uri: vscode.Uri): string {
    return `simpleHtmlViewer.zoom.${uri.toString()}`;
  }

  private getStoredZoom(uri: vscode.Uri): number {
    return this.context.workspaceState.get<number>(
      this.zoomStateKey(uri),
      this.getDefaultZoom(),
    );
  }

  private getAutoRefreshMode(): AutoRefreshMode {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer')
      .get<AutoRefreshMode>('autoRefresh', 'onSave');
  }

  private getZoomStep(): number {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer')
      .get<number>('zoomStep', 10);
  }

  private getDefaultZoom(): number {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer')
      .get<number>('defaultZoom', 100);
  }

  private withBaseHref(html: string, baseHref: string): string {
    const baseTag = `<base href="${baseHref}">`;
    if (/<head(\s[^>]*)?>/i.test(html)) {
      return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${baseTag}`);
    }

    return `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = this.createNonce();
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src 'self' data: blob: https: ${webview.cspSource};"
    >
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Simple HTML Viewer</title>
  </head>
  <body>
    <div class="app-shell">
      <div class="toolbar">
        <button id="zoom-out" class="toolbar-button" type="button" aria-label="Zoom out">-</button>
        <div id="zoom-label" class="zoom-label">100%</div>
        <button id="zoom-in" class="toolbar-button" type="button" aria-label="Zoom in">+</button>
        <button id="zoom-reset" class="toolbar-button" type="button">reset</button>
        <button id="refresh" class="toolbar-button hidden" type="button">refresh</button>
      </div>
      <div class="frame-wrap">
        <iframe
          id="preview-frame"
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-pointer-lock allow-downloads"
          referrerpolicy="no-referrer"
          title="HTML preview"
        ></iframe>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const frame = document.getElementById('preview-frame');
      const refreshButton = document.getElementById('refresh');
      const zoomLabel = document.getElementById('zoom-label');

      const applyZoom = (zoom) => {
        frame.style.width = \`\${10000 / zoom}%\`;
        frame.style.height = \`\${10000 / zoom}%\`;
        frame.style.transform = \`scale(\${zoom / 100})\`;
        zoomLabel.textContent = \`\${zoom}%\`;
        vscode.postMessage({ type: 'zoomChanged', zoom });
      };

      document.getElementById('zoom-out').addEventListener('click', () => {
        vscode.postMessage({ type: 'zoomOut' });
      });

      document.getElementById('zoom-in').addEventListener('click', () => {
        vscode.postMessage({ type: 'zoomIn' });
      });

      document.getElementById('zoom-reset').addEventListener('click', () => {
        vscode.postMessage({ type: 'zoomReset' });
      });

      refreshButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'manualRefresh' });
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'render') {
          frame.srcdoc = message.html;
          refreshButton.classList.toggle('hidden', message.autoRefresh !== 'off');
          applyZoom(message.zoom);
        }

        if (message.type === 'setZoom') {
          applyZoom(message.zoom);
        }
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }

  private createNonce(): string {
    const possible =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let index = 0; index < 32; index += 1) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
  }
}
