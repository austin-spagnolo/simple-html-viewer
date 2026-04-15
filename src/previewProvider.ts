import * as path from 'path';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import {
  injectIntoHead,
  preparePreviewHtml,
  wrapBodyContent,
} from './previewTransform';

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
  private readonly renderCounts = new Map<string, number>();
  private readonly lastRenderedHtml = new Map<string, string>();

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

  public async testSetZoom(uri: vscode.Uri, zoom: number): Promise<void> {
    await this.setZoom(uri, zoom);

    const panels = this.panels.get(this.panelKey(uri));
    if (!panels) {
      return;
    }

    for (const panel of panels) {
      await this.sendZoom(panel, uri);
    }
  }

  public testGetZoom(uri: vscode.Uri): number {
    return this.getStoredZoom(uri);
  }

  public testGetRenderCount(uri: vscode.Uri): number {
    return this.renderCounts.get(this.panelKey(uri)) ?? 0;
  }

  public testGetLastRenderedHtml(uri: vscode.Uri): string | undefined {
    return this.lastRenderedHtml.get(this.panelKey(uri));
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
    const renderedHtml = await this.getWebviewHtml(
      panel.webview,
      documentUri,
      sourceHtml,
      zoom,
      this.getAutoRefreshMode(),
    );
    panel.webview.html = renderedHtml;
    this.trackRender(documentUri, renderedHtml);
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

  private trackRender(uri: vscode.Uri, html: string): void {
    const key = this.panelKey(uri);
    this.renderCounts.set(key, (this.renderCounts.get(key) ?? 0) + 1);
    this.lastRenderedHtml.set(key, html);
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

  private async prepareHtmlForPreview(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    html: string,
  ): Promise<string> {
    const previewCsp = [
      `default-src 'none';`,
      `img-src ${webview.cspSource} data: blob: https: http:;`,
      `style-src ${webview.cspSource} 'unsafe-inline' data: https: http:;`,
      `script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' data: https: http:;`,
      `font-src ${webview.cspSource} data: blob: https: http:;`,
      `connect-src ${webview.cspSource} data: blob: https: http: ws: wss:;`,
      `worker-src ${webview.cspSource} data: blob: https: http:;`,
    ].join(' ');

    return preparePreviewHtml({
      cspTag: `<meta http-equiv="Content-Security-Policy" content="${previewCsp}">`,
      documentUrl: documentUri.toString(),
      html,
      rewriteLocalUri: (uri) =>
        webview.asWebviewUri(vscode.Uri.parse(uri)).toString(),
    });
  }

  private async getWebviewHtml(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    sourceHtml: string,
    zoom: number,
    autoRefreshMode: AutoRefreshMode,
  ): Promise<string> {
    const nonce = this.createNonce();
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'),
    );
    const preparedHtml = await this.prepareHtmlForPreview(
      webview,
      documentUri,
      sourceHtml,
    );
    const toolbarPrefix = `
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
</div>
<div id="simple-html-viewer-offset" aria-hidden="true"></div>
<div id="simple-html-viewer-content-shell">
  <div id="simple-html-viewer-content">
`;
    const toolbarSuffix = `
  </div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const zoomLabel = document.getElementById('simple-html-viewer-zoom-label');
  const root = document.getElementById('simple-html-viewer-root');
  const offset = document.getElementById('simple-html-viewer-offset');
  const contentShell = document.getElementById('simple-html-viewer-content-shell');
  const content = document.getElementById('simple-html-viewer-content');
  const syncScaledContentBounds = () => {
    if (!(contentShell instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      return;
    }

    contentShell.style.height = String(Math.ceil(content.getBoundingClientRect().height)) + 'px';
  };
  const applyLayoutOffset = () => {
    if (!(root instanceof HTMLElement) || !(offset instanceof HTMLElement)) {
      return;
    }

    const rootStyle = window.getComputedStyle(root);
    const reservedHeight =
      Math.ceil(root.getBoundingClientRect().height) +
      parseFloat(rootStyle.top || '0') +
      8;
    offset.style.height = String(reservedHeight) + 'px';
    document.documentElement.style.scrollPaddingTop =
      String(reservedHeight) + 'px';
  };
  const notifyResponsiveLayout = () => {
    const dispatchResize = () => {
      window.dispatchEvent(new Event('resize'));
    };

    requestAnimationFrame(() => {
      syncScaledContentBounds();
      applyLayoutOffset();
      dispatchResize();
      requestAnimationFrame(() => {
        syncScaledContentBounds();
        dispatchResize();
      });
    });
  };
  const applyZoom = (value) => {
    if (content instanceof HTMLElement) {
      const scale = value / 100;
      content.style.transformOrigin = 'top left';
      content.style.transform = value === 100 ? '' : 'scale(' + String(scale) + ')';
      content.style.width = value === 100 ? '' : String(100 / scale) + '%';
    }

    zoomLabel.textContent = value + '%';
    notifyResponsiveLayout();
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
      applyZoom(message.zoom);
    }
  });

  if (typeof ResizeObserver !== 'undefined' && content instanceof HTMLElement) {
    const resizeObserver = new ResizeObserver(() => {
      syncScaledContentBounds();
    });
    resizeObserver.observe(content);
  }

  const syncChromeLayout = () => {
    syncScaledContentBounds();
    applyLayoutOffset();
  };

  window.addEventListener('load', syncChromeLayout);
  window.addEventListener('resize', syncChromeLayout);
  requestAnimationFrame(syncChromeLayout);

  applyZoom(${zoom});
  vscode.postMessage({ type: 'ready' });
</script>
`;

    const wrappedHtml = wrapBodyContent(
      preparedHtml,
      toolbarPrefix,
      toolbarSuffix,
    );

    return injectIntoHead(
      wrappedHtml,
      `<link href="${stylesUri}" rel="stylesheet">`,
    );
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
