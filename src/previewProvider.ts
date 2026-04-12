import * as path from 'path';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';

type AutoRefreshMode = 'onSave' | 'off';

type WebviewMessage =
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'zoomReset' }
  | { type: 'manualRefresh' }
  | { type: 'ready' };

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
    const extensionMediaRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      'media',
    );
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, extensionMediaRoot],
    };
    webviewPanel.title = `${path.basename(document.uri.fsPath)} Preview`;

    this.registerPanel(document.uri, webviewPanel);

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'manualRefresh':
          await this.renderDocument(webviewPanel, document.uri);
          break;
        case 'zoomIn':
          await this.adjustZoom(webviewPanel, document.uri, 1);
          break;
        case 'zoomOut':
          await this.adjustZoom(webviewPanel, document.uri, -1);
          break;
        case 'zoomReset':
          await this.setZoom(document.uri, this.getDefaultZoom());
          await this.sendZoom(webviewPanel, document.uri);
          break;
        case 'ready':
          await this.sendZoom(webviewPanel, document.uri);
          break;
        default:
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      this.unregisterPanel(document.uri, webviewPanel);
    });

    await this.renderDocument(webviewPanel, document.uri);
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
    const zoom = this.getStoredZoom(documentUri);
    panel.webview.html = this.getWebviewHtml(
      panel.webview,
      documentUri,
      sourceHtml,
      zoom,
      this.getAutoRefreshMode(),
    );
  }

  private async adjustZoom(
    panel: vscode.WebviewPanel,
    uri: vscode.Uri,
    direction: 1 | -1,
  ): Promise<void> {
    const nextZoom = Math.max(
      10,
      Math.min(
        500,
        this.getStoredZoom(uri) + direction * this.getZoomStep(),
      ),
    );
    await this.setZoom(uri, nextZoom);
    await this.sendZoom(panel, uri);
  }

  private async setZoom(
    uri: vscode.Uri,
    zoom: number,
  ): Promise<void> {
    await this.context.workspaceState.update(this.zoomStateKey(uri), zoom);
  }

  private async sendZoom(
    panel: vscode.WebviewPanel,
    uri: vscode.Uri,
  ): Promise<void> {
    await panel.webview.postMessage({
      type: 'setZoom',
      zoom: this.getStoredZoom(uri),
    });
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

  private prepareHtmlForPreview(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    html: string,
  ): string {
    const previewCsp = [
      `default-src 'none';`,
      `img-src ${webview.cspSource} data: blob: https: http:;`,
      `style-src ${webview.cspSource} 'unsafe-inline' https: http:;`,
      `script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' https: http:;`,
      `font-src ${webview.cspSource} data: blob: https: http:;`,
      `connect-src ${webview.cspSource} data: blob: https: http: ws: wss:;`,
      `worker-src ${webview.cspSource} data: blob: https: http:;`,
    ].join(' ');

    const withCsp = this.injectIntoHead(
      html,
      `<meta http-equiv="Content-Security-Policy" content="${previewCsp}">`,
    );

    return withCsp.replace(
      /\b(href|src)=("([^"]*)"|'([^']*)')/gi,
      (
        fullMatch,
        attribute: string,
        quoted: string,
        doubleQuoted: string | undefined,
        singleQuoted: string | undefined,
      ) => {
        const rawValue = doubleQuoted ?? singleQuoted ?? '';
        if (!this.shouldRewriteResourceUrl(rawValue)) {
          return fullMatch;
        }

        const resolvedUri = vscode.Uri.joinPath(
          vscode.Uri.joinPath(documentUri, '..'),
          rawValue,
        );
        const rewrittenUri = webview.asWebviewUri(resolvedUri).toString();
        const quote = quoted.startsWith('"') ? '"' : "'";
        return `${attribute}=${quote}${rewrittenUri}${quote}`;
      },
    );
  }

  private injectIntoHead(html: string, tag: string): string {
    if (/<head(\s[^>]*)?>/i.test(html)) {
      return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${tag}`);
    }

    return `<!DOCTYPE html><html><head>${tag}</head><body>${html}</body></html>`;
  }

  private shouldRewriteResourceUrl(value: string): boolean {
    if (!value) {
      return false;
    }

    const lowerValue = value.toLowerCase();
    return !(
      lowerValue.startsWith('http://') ||
      lowerValue.startsWith('https://') ||
      lowerValue.startsWith('data:') ||
      lowerValue.startsWith('blob:') ||
      lowerValue.startsWith('#') ||
      lowerValue.startsWith('mailto:') ||
      lowerValue.startsWith('javascript:')
    );
  }

  private getWebviewHtml(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    sourceHtml: string,
    zoom: number,
    autoRefreshMode: AutoRefreshMode,
  ): string {
    const nonce = this.createNonce();
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'),
    );
    const preparedHtml = this.prepareHtmlForPreview(
      webview,
      documentUri,
      sourceHtml,
    );
    const toolbarStart = `
<div id="simple-html-viewer-root">
  <div id="simple-html-viewer-toolbar" data-simple-html-viewer-toolbar>
    <button id="simple-html-viewer-zoom-out" class="simple-html-viewer-button" type="button" aria-label="Zoom out">-</button>
    <div id="simple-html-viewer-zoom-label" class="simple-html-viewer-zoom-label">${zoom}%</div>
    <button id="simple-html-viewer-zoom-in" class="simple-html-viewer-button" type="button" aria-label="Zoom in">+</button>
    <button id="simple-html-viewer-zoom-reset" class="simple-html-viewer-button" type="button">reset</button>
    <button id="simple-html-viewer-refresh" class="simple-html-viewer-button${
      autoRefreshMode === 'off' ? '' : ' hidden'
    }" type="button">refresh</button>
  </div>
  <div id="simple-html-viewer-scroll">
    <div id="simple-html-viewer-content" data-simple-html-viewer-content>
`;
    const toolbarEnd = `
    </div>
  </div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('simple-html-viewer-content');
  const zoomLabel = document.getElementById('simple-html-viewer-zoom-label');
  const applyZoom = () => {
    content.style.zoom = '${zoom / 100}';
    zoomLabel.textContent = '${zoom}%';
  };

  document.getElementById('simple-html-viewer-zoom-out')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'zoomOut' });
  });

  document.getElementById('simple-html-viewer-zoom-in')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'zoomIn' });
  });

  document.getElementById('simple-html-viewer-zoom-reset')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'zoomReset' });
  });

  document.getElementById('simple-html-viewer-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'manualRefresh' });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'setZoom') {
      content.style.zoom = String(message.zoom / 100);
      zoomLabel.textContent = message.zoom + '%';
    }
  });

  applyZoom();
  vscode.postMessage({ type: 'ready' });
</script>
`;

    const withStylesheet = this.injectIntoHead(
      preparedHtml,
      `<link href="${stylesUri}" rel="stylesheet">`,
    );
    const withBodyStart = withStylesheet.replace(
      /<body(\s[^>]*)?>/i,
      (match) => `${match}${toolbarStart}`,
    );

    if (withBodyStart !== withStylesheet) {
      return withBodyStart.replace(/<\/body>/i, `${toolbarEnd}</body>`);
    }

    return `<!DOCTYPE html><html><head><link href="${stylesUri}" rel="stylesheet"></head><body>${toolbarStart}${preparedHtml}${toolbarEnd}</body></html>`;
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
