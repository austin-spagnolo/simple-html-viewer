import * as path from 'path';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { preparePreviewHtml } from './previewTransform';

type AutoRefreshMode = 'onSave' | 'off';
type ActiveContentMode = 'trustedWorkspaces' | 'always' | 'off';

interface PreviewSecurityPolicy {
  activeContentAllowed: boolean;
  insecureContentAllowed: boolean;
}

type WebviewMessage =
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'zoomReset' }
  | { type: 'manualRefresh' }
  | { type: 'ready' };

export class HtmlPreviewProvider
  implements vscode.CustomReadonlyEditorProvider
{
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

    webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
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
      },
    );

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
    try {
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
    } catch (error) {
      const message = this.getErrorMessage(error);
      panel.webview.html = this.getErrorHtml(documentUri, message);
      void vscode.window.showWarningMessage(
        `Simple HTML Viewer could not preview ${path.basename(
          documentUri.fsPath,
        )}: ${message}`,
      );
    }
  }

  private async adjustZoom(
    panel: vscode.WebviewPanel,
    uri: vscode.Uri,
    direction: 1 | -1,
  ): Promise<void> {
    const nextZoom = Math.max(
      10,
      Math.min(500, this.getStoredZoom(uri) + direction * this.getZoomStep()),
    );
    await this.setZoom(uri, nextZoom);
    await this.sendZoom(panel, uri);
  }

  private async setZoom(uri: vscode.Uri, zoom: number): Promise<void> {
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

  private getActiveContentMode(): ActiveContentMode {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer')
      .get<ActiveContentMode>('activeContent', 'trustedWorkspaces');
  }

  private getAllowInsecureContent(): boolean {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer')
      .get<boolean>('allowInsecureContent', false);
  }

  private getPreviewSecurityPolicy(): PreviewSecurityPolicy {
    const activeContentMode = this.getActiveContentMode();
    const activeContentAllowed =
      activeContentMode === 'always' ||
      (activeContentMode === 'trustedWorkspaces' && vscode.workspace.isTrusted);

    return {
      activeContentAllowed,
      insecureContentAllowed:
        activeContentAllowed && this.getAllowInsecureContent(),
    };
  }

  private createPreviewCsp(webview: vscode.Webview, nonce: string): string {
    const securityPolicy = this.getPreviewSecurityPolicy();
    const localSource = webview.cspSource;
    const remoteResourceSources = securityPolicy.activeContentAllowed
      ? ['https:', ...(securityPolicy.insecureContentAllowed ? ['http:'] : [])]
      : [];
    const remoteConnectionSources = securityPolicy.activeContentAllowed
      ? [
          'https:',
          'wss:',
          ...(securityPolicy.insecureContentAllowed ? ['http:', 'ws:'] : []),
        ]
      : [];
    const scriptSources = securityPolicy.activeContentAllowed
      ? [
          localSource,
          "'unsafe-inline'",
          "'unsafe-eval'",
          'data:',
          'blob:',
          ...remoteResourceSources,
        ]
      : [`'nonce-${nonce}'`];
    const connectSources =
      remoteConnectionSources.length > 0
        ? [localSource, 'data:', 'blob:', ...remoteConnectionSources]
        : ["'none'"];
    const workerSources = securityPolicy.activeContentAllowed
      ? [localSource, 'data:', 'blob:', ...remoteResourceSources]
      : ["'none'"];
    const directive = (name: string, sources: string[]) =>
      `${name} ${sources.join(' ')};`;

    return [
      directive('default-src', ["'none'"]),
      directive('img-src', [
        localSource,
        'data:',
        'blob:',
        ...remoteResourceSources,
      ]),
      directive('style-src', [
        localSource,
        "'unsafe-inline'",
        'data:',
        ...remoteResourceSources,
      ]),
      directive('script-src', scriptSources),
      directive('font-src', [
        localSource,
        'data:',
        'blob:',
        ...remoteResourceSources,
      ]),
      directive('connect-src', connectSources),
      directive('worker-src', workerSources),
    ].join(' ');
  }

  private createShellCsp(webview: vscode.Webview, nonce: string): string {
    return [
      `default-src 'none';`,
      `frame-src 'self' ${webview.cspSource} data: blob:;`,
      `img-src ${webview.cspSource} data: blob:;`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src 'nonce-${nonce}';`,
    ].join(' ');
  }

  private async prepareHtmlForPreview(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    html: string,
    nonce: string,
  ): Promise<string> {
    return preparePreviewHtml({
      cspTag: [
        `<meta http-equiv="Content-Security-Policy" content="${this.createPreviewCsp(
          webview,
          nonce,
        )}">`,
        '<meta name="color-scheme" content="light">',
        '<style>:root{color-scheme:only light;}html,body{color:CanvasText;background-color:Canvas;}</style>',
        `<script nonce="${nonce}">window.addEventListener('message',(event)=>{if(event.data?.source==='simple-html-viewer'&&event.data?.type==='resize'){window.dispatchEvent(new Event('resize'));}});</script>`,
      ].join(''),
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
      nonce,
    );
    const frameSandbox = this.getPreviewSecurityPolicy().activeContentAllowed
      ? 'allow-downloads allow-forms allow-modals allow-popups allow-scripts'
      : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${this.createShellCsp(
    webview,
    nonce,
  )}">
  <link href="${stylesUri}" rel="stylesheet">
</head>
<body>
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
<div id="simple-html-viewer-content-shell">
  <iframe id="simple-html-viewer-frame" sandbox="${frameSandbox}" srcdoc="${this.escapeHtml(
    preparedHtml,
  )}"></iframe>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const zoomLabel = document.getElementById('simple-html-viewer-zoom-label');
  const root = document.getElementById('simple-html-viewer-root');
  const contentShell = document.getElementById('simple-html-viewer-content-shell');
  const frame = document.getElementById('simple-html-viewer-frame');
  let currentZoomScale = ${zoom} / 100;
  const dispatchFrameResize = () => {
    frame?.contentWindow?.postMessage({
      source: 'simple-html-viewer',
      type: 'resize',
    }, '*');
  };
  const applyLayoutOffset = () => {
    if (!(root instanceof HTMLElement) || !(contentShell instanceof HTMLElement)) {
      return;
    }

    const rootStyle = window.getComputedStyle(root);
    const reservedHeight =
      Math.ceil(root.getBoundingClientRect().height) +
      parseFloat(rootStyle.top || '0') +
      8;
    contentShell.style.top = String(reservedHeight) + 'px';
  };
  const applyFrameZoom = () => {
    if (!(frame instanceof HTMLElement)) {
      return;
    }

    frame.style.transform =
      currentZoomScale === 1 ? '' : 'scale(' + String(currentZoomScale) + ')';
    frame.style.width =
      currentZoomScale === 1 ? '100%' : String(100 / currentZoomScale) + '%';
    frame.style.height =
      currentZoomScale === 1 ? '100%' : String(100 / currentZoomScale) + '%';
  };
  const notifyResponsiveLayout = () => {
    requestAnimationFrame(() => {
      applyLayoutOffset();
      applyFrameZoom();
      dispatchFrameResize();
      requestAnimationFrame(() => {
        applyFrameZoom();
        dispatchFrameResize();
      });
    });
  };
  const applyZoom = (value) => {
    currentZoomScale = value / 100;
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

  const syncChromeLayout = () => {
    applyLayoutOffset();
    applyFrameZoom();
  };

  frame?.addEventListener('load', notifyResponsiveLayout);
  window.addEventListener('load', syncChromeLayout);
  window.addEventListener('resize', syncChromeLayout);
  requestAnimationFrame(syncChromeLayout);

  applyZoom(${zoom});
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

  private getErrorHtml(documentUri: vscode.Uri, message: string): string {
    const escapedTitle = this.escapeHtml(path.basename(documentUri.fsPath));
    const escapedMessage = this.escapeHtml(message);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body {
      box-sizing: border-box;
      margin: 0;
      padding: 24px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family), sans-serif;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 18px;
      font-weight: 600;
    }

    p {
      margin: 0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>Unable to preview ${escapedTitle}</h1>
  <p>${escapedMessage}</p>
</body>
</html>`;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
