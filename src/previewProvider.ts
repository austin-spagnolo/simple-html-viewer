import * as path from 'path';
import { platform } from 'os';
import { clearTimeout, setTimeout } from 'timers';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import {
  injectIntoHead,
  preparePreviewHtml,
  wrapBodyContent,
} from './previewTransform';

type AutoRefreshMode = 'onSave' | 'onFileChange' | 'off';
type ActiveContentMode = 'trustedWorkspaces' | 'always' | 'off';

interface PreviewSecurityPolicy {
  activeContentAllowed: boolean;
  insecureContentAllowed: boolean;
}

interface PanelRenderState {
  disposed: boolean;
  pending: boolean;
  revision: number;
  running: Promise<void> | undefined;
  uri: vscode.Uri;
}

export class HtmlPreviewProvider
  implements vscode.CustomReadonlyEditorProvider
{
  public static readonly viewType = 'simpleHtmlViewer.preview';
  // A single HTML file can have several preview tabs open, so panel state is
  // grouped by URI instead of assuming one preview per document.
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();
  private readonly panelUris = new Map<vscode.WebviewPanel, vscode.Uri>();
  private activePanel: vscode.WebviewPanel | undefined;
  private readonly renderCounts = new Map<string, number>();
  private readonly lastRenderedHtml = new Map<string, string>();
  private readonly renderStates = new Map<
    vscode.WebviewPanel,
    PanelRenderState
  >();
  private readonly fileWatchers = new Map<
    string,
    {
      watcher: vscode.FileSystemWatcher;
      timer: ReturnType<typeof setTimeout> | undefined;
      scheduleRefresh: () => void;
    }
  >();

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
    // Limit local file access to the opened file's folder and this extension's
    // own media assets. Remote resources are controlled later by the CSP.
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
    if (webviewPanel.active) {
      this.activePanel = webviewPanel;
    }

    // Track focus so editor commands can target the preview the user is viewing.
    webviewPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.activePanel = webviewPanel;
      } else if (this.activePanel === webviewPanel) {
        this.activePanel = [...this.panelUris.keys()].find(
          (panel) => panel.active,
        );
      }
    });

    webviewPanel.onDidDispose(() => {
      this.unregisterPanel(document.uri, webviewPanel);
      if (this.activePanel === webviewPanel) {
        this.activePanel = [...this.panelUris.keys()].find(
          (panel) => panel.active,
        );
      }
    });

    await this.renderDocument(webviewPanel, document.uri);
  }

  public handleDocumentSaved(document: vscode.TextDocument): void {
    if (!HtmlPreviewProvider.isHtmlUri(document.uri)) {
      return;
    }

    const mode = this.getAutoRefreshMode(document.uri);
    if (mode === 'onFileChange') {
      const state = this.fileWatchers.get(this.panelKey(document.uri));
      if (state) {
        state.scheduleRefresh();
      } else {
        void this.refresh(document.uri);
      }
      return;
    }
    if (mode !== 'onSave') {
      return;
    }

    void this.refresh(document.uri);
  }

  /** Reconcile open-document watchers after autoRefresh configuration changes. */
  public handleConfigurationChanged(): void {
    for (const [key, panels] of this.panels) {
      const uri = this.panelUris.get(
        panels.values().next().value as vscode.WebviewPanel,
      );
      if (!uri) continue;
      if (this.getAutoRefreshMode(uri) === 'onFileChange')
        this.ensureFileWatcher(uri);
      else this.disposeFileWatcher(key);
    }
  }

  public async refresh(uri: vscode.Uri | undefined): Promise<void> {
    if (!uri) {
      return;
    }

    const key = this.panelKey(uri);
    const panels = this.panels.get(key);
    if (!panels) {
      return;
    }

    await Promise.all([...panels].map((panel) => this.queueRender(panel, uri)));
  }

  /** URI of the currently focused custom preview, if one is open. */
  public getActivePreviewUri(): vscode.Uri | undefined {
    const panel = this.activePanel?.active
      ? this.activePanel
      : [...this.panelUris.keys()].find((candidate) => candidate.active);
    return panel ? this.panelUris.get(panel) : undefined;
  }

  public async zoomIn(uri?: vscode.Uri): Promise<void> {
    await this.adjustDocumentZoom(uri ?? this.getActivePreviewUri(), 1);
  }

  public async zoomOut(uri?: vscode.Uri): Promise<void> {
    await this.adjustDocumentZoom(uri ?? this.getActivePreviewUri(), -1);
  }

  public async resetZoom(uri?: vscode.Uri): Promise<void> {
    const targetUri = uri ?? this.getActivePreviewUri();
    if (!targetUri) {
      return;
    }
    await this.setZoom(targetUri, this.getDefaultZoom(targetUri));
    await this.sendZoomToDocumentPanels(targetUri);
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
    this.panelUris.set(panel, uri);
    if (this.getAutoRefreshMode(uri) === 'onFileChange')
      this.ensureFileWatcher(uri);
  }

  private ensureFileWatcher(uri: vscode.Uri): void {
    const key = this.panelKey(uri);
    if (this.fileWatchers.has(key) || !this.panels.has(key)) return;
    const directory = vscode.Uri.joinPath(uri, '..');
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(directory, '*'),
    );
    const state = {
      watcher,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      scheduleRefresh: (): void => undefined,
    };
    const schedule = () => {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = undefined;
        if (this.fileWatchers.get(key) === state) void this.refresh(uri);
      }, 250);
    };
    state.scheduleRefresh = schedule;
    const scheduleIfTarget = (changedUri: vscode.Uri) => {
      if (this.isWatchedFile(uri, changedUri)) schedule();
    };
    watcher.onDidChange(scheduleIfTarget);
    watcher.onDidCreate(scheduleIfTarget);
    this.fileWatchers.set(key, state);
  }

  private isWatchedFile(target: vscode.Uri, changed: vscode.Uri): boolean {
    if (
      target.scheme !== changed.scheme ||
      target.authority !== changed.authority
    )
      return false;
    if (this.panelKey(target) === this.panelKey(changed)) return true;
    if (
      target.scheme === 'file' &&
      (platform() === 'win32' || platform() === 'darwin')
    ) {
      return target.fsPath.toLowerCase() === changed.fsPath.toLowerCase();
    }
    return false;
  }

  private disposeFileWatcher(key: string): void {
    const state = this.fileWatchers.get(key);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.watcher.dispose();
    this.fileWatchers.delete(key);
  }

  private unregisterPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
    const key = this.panelKey(uri);
    const panels = this.panels.get(key);
    if (!panels) {
      return;
    }

    panels.delete(panel);
    this.panelUris.delete(panel);
    const renderState = this.renderStates.get(panel);
    if (renderState) {
      renderState.disposed = true;
      renderState.pending = false;
      this.renderStates.delete(panel);
    }
    if (panels.size === 0) {
      this.panels.delete(key);
      this.lastRenderedHtml.delete(key);
      this.disposeFileWatcher(key);
    } else if (this.getAutoRefreshMode(uri) === 'onFileChange')
      this.ensureFileWatcher(uri);
  }

  private async renderDocument(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
  ): Promise<void> {
    await this.queueRender(panel, documentUri);
  }

  private queueRender(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
  ): Promise<void> {
    let state = this.renderStates.get(panel);
    if (!state) {
      state = {
        disposed: false,
        pending: false,
        revision: 0,
        running: undefined,
        uri: documentUri,
      };
      this.renderStates.set(panel, state);
    }

    state.uri = documentUri;
    state.revision += 1;
    state.pending = true;
    if (!state.running) {
      const activeState = state;
      state.running = Promise.resolve().then(async () => {
        try {
          while (!activeState.disposed && activeState.pending) {
            activeState.pending = false;
            const revision = activeState.revision;
            await this.renderDocumentOnce(panel, activeState, revision);
          }
        } finally {
          activeState.running = undefined;
        }
      });
    }

    return state.running ?? Promise.resolve();
  }

  private async renderDocumentOnce(
    panel: vscode.WebviewPanel,
    state: PanelRenderState,
    revision: number,
  ): Promise<void> {
    const documentUri = state.uri;
    try {
      // Render from the saved file each time. That keeps manual refresh and
      // auto-refresh behavior aligned with what is actually on disk.
      const bytes = await vscode.workspace.fs.readFile(documentUri);
      const sourceHtml = new TextDecoder('utf-8').decode(bytes);
      const zoom = this.getStoredZoom(documentUri);
      const renderedHtml = await this.getWebviewHtml(
        panel.webview,
        documentUri,
        sourceHtml,
        zoom,
      );
      if (!this.isCurrentRender(panel, state, revision)) {
        return;
      }
      panel.webview.html = renderedHtml;
      this.trackRender(documentUri, renderedHtml);
    } catch (error) {
      if (!this.isCurrentRender(panel, state, revision)) {
        return;
      }
      const message = this.getErrorMessage(error);
      panel.webview.html = this.getErrorHtml(documentUri, message);
      void vscode.window.showWarningMessage(
        `Simple HTML Viewer could not preview ${path.basename(
          documentUri.fsPath,
        )}: ${message}`,
      );
    }
  }

  private isCurrentRender(
    panel: vscode.WebviewPanel,
    state: PanelRenderState,
    revision: number,
  ): boolean {
    return (
      !state.disposed &&
      state.revision === revision &&
      this.renderStates.get(panel) === state
    );
  }

  private async adjustDocumentZoom(
    uri: vscode.Uri | undefined,
    direction: 1 | -1,
  ): Promise<void> {
    if (!uri) {
      return;
    }
    const nextZoom = Math.max(
      10,
      Math.min(
        500,
        this.getStoredZoom(uri) + direction * this.getZoomStep(uri),
      ),
    );
    await this.setZoom(uri, nextZoom);
    await this.sendZoomToDocumentPanels(uri);
  }

  private async sendZoomToDocumentPanels(uri: vscode.Uri): Promise<void> {
    const panels = this.panels.get(this.panelKey(uri));
    if (!panels) {
      return;
    }
    await Promise.all([...panels].map((panel) => this.sendZoom(panel, uri)));
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
    if (this.context.extensionMode === vscode.ExtensionMode.Test) {
      this.lastRenderedHtml.set(key, html);
    }
  }

  private zoomStateKey(uri: vscode.Uri): string {
    return `simpleHtmlViewer.zoom.${uri.toString()}`;
  }

  private getStoredZoom(uri: vscode.Uri): number {
    return this.context.workspaceState.get<number>(
      this.zoomStateKey(uri),
      this.getDefaultZoom(uri),
    );
  }

  private getAutoRefreshMode(uri: vscode.Uri): AutoRefreshMode {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer', uri)
      .get<AutoRefreshMode>('autoRefresh', 'onSave');
  }

  private getZoomStep(uri: vscode.Uri): number {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer', uri)
      .get<number>('zoomStep', 10);
  }

  private getDefaultZoom(uri: vscode.Uri): number {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer', uri)
      .get<number>('defaultZoom', 100);
  }

  private getActiveContentMode(uri: vscode.Uri): ActiveContentMode {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer', uri)
      .get<ActiveContentMode>('activeContent', 'trustedWorkspaces');
  }

  private getAllowInsecureContent(uri: vscode.Uri): boolean {
    return vscode.workspace
      .getConfiguration('simpleHtmlViewer', uri)
      .get<boolean>('allowInsecureContent', false);
  }

  private getPreviewSecurityPolicy(uri: vscode.Uri): PreviewSecurityPolicy {
    const activeContentMode = this.getActiveContentMode(uri);
    // Running page scripts is a trust boundary, so only allow it when the user
    // opted in or the workspace is already trusted.
    const activeContentAllowed =
      activeContentMode === 'always' ||
      (activeContentMode === 'trustedWorkspaces' && vscode.workspace.isTrusted);

    return {
      activeContentAllowed,
      insecureContentAllowed:
        activeContentAllowed && this.getAllowInsecureContent(uri),
    };
  }

  private createPreviewCsp(
    webview: vscode.Webview,
    nonce: string,
    uri: vscode.Uri,
  ): string {
    const securityPolicy = this.getPreviewSecurityPolicy(uri);
    const localSource = webview.cspSource;
    // Keep each CSP directive's source list explicit so changes to one kind of
    // access do not accidentally widen another.
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

  private async prepareHtmlForPreview(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    html: string,
    nonce: string,
  ): Promise<string> {
    // Add webview security metadata before rewriting resources, then let the
    // transform convert relative file references into VS Code webview URIs.
    return preparePreviewHtml({
      cspTag: [
        `<meta http-equiv="Content-Security-Policy" content="${this.createPreviewCsp(
          webview,
          nonce,
          documentUri,
        )}">`,
        '<meta name="color-scheme" content="light">',
        '<style>:root{color-scheme:only light;}html,body{color:CanvasText;background-color:Canvas;}</style>',
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
    // Keep only a wrapper for zoom scaling. Viewer controls are supplied by
    // VS Code commands so artifact content cannot cover or alter them.
    const wrapperPrefix = `
<div id="simple-html-viewer-content-shell">
  <div id="simple-html-viewer-content">
`;
    const wrapperSuffix = `
  </div>
</div>
<script nonce="${nonce}">
(() => {
  const contentShell = document.getElementById('simple-html-viewer-content-shell');
  const content = document.getElementById('simple-html-viewer-content');
  const syncContentBounds = () => {
    if (!(contentShell instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      return;
    }

    // CSS transforms do not affect normal document flow, so the shell mirrors
    // the scaled content height to keep scrolling natural.
    contentShell.style.height = String(Math.ceil(content.getBoundingClientRect().height)) + 'px';
  };
  const notifyResponsiveLayout = () => {
    const dispatchResize = () => {
      window.dispatchEvent(new Event('resize'));
    };

    // Many charting libraries listen for resize events, so send them after the
    // transform has settled instead of immediately after changing the style.
    requestAnimationFrame(() => {
      syncContentBounds();
      dispatchResize();
      requestAnimationFrame(() => {
        syncContentBounds();
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

    notifyResponsiveLayout();
  };

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'setZoom') {
      applyZoom(message.zoom);
    }
  });

  if (typeof ResizeObserver !== 'undefined' && content instanceof HTMLElement) {
    const resizeObserver = new ResizeObserver(() => {
      syncContentBounds();
    });
    resizeObserver.observe(content);
  }

  const syncDocumentLayout = () => {
    syncContentBounds();
  };

  window.addEventListener('load', syncDocumentLayout);
  window.addEventListener('resize', syncDocumentLayout);
  requestAnimationFrame(syncDocumentLayout);

  applyZoom(${zoom});
})();
</script>
`;

    const wrappedHtml = wrapBodyContent(
      preparedHtml,
      wrapperPrefix,
      wrapperSuffix,
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
