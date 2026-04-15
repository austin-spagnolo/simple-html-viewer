import * as path from 'path';
import { TextDecoder } from 'util';
import { URL } from 'url';
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
    panel.webview.html = await this.getWebviewHtml(
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

    const withCsp = this.injectIntoHead(
      html,
      `<meta http-equiv="Content-Security-Policy" content="${previewCsp}">`,
    );

    return this.rewriteHtmlForPreview(webview, documentUri, withCsp);
  }

  private injectIntoHead(html: string, tag: string): string {
    if (/<head(\s[^>]*)?>/i.test(html)) {
      return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${tag}`);
    }

    return `<!DOCTYPE html><html><head>${tag}</head><body>${html}</body></html>`;
  }

  private rewriteHtmlForPreview(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    html: string,
  ): string {
    const lowerHtml = html.toLowerCase();
    let index = 0;
    let result = '';
    let currentBaseUrl = documentUri.toString();

    while (index < html.length) {
      const nextTagStart = html.indexOf('<', index);
      if (nextTagStart === -1) {
        result += html.slice(index);
        break;
      }

      result += html.slice(index, nextTagStart);

      if (lowerHtml.startsWith('<!--', nextTagStart)) {
        const commentEnd = html.indexOf('-->', nextTagStart + 4);
        if (commentEnd === -1) {
          result += html.slice(nextTagStart);
          break;
        }

        result += html.slice(nextTagStart, commentEnd + 3);
        index = commentEnd + 3;
        continue;
      }

      if (lowerHtml.startsWith('<![cdata[', nextTagStart)) {
        const cdataEnd = html.indexOf(']]>', nextTagStart + 9);
        if (cdataEnd === -1) {
          result += html.slice(nextTagStart);
          break;
        }

        result += html.slice(nextTagStart, cdataEnd + 3);
        index = cdataEnd + 3;
        continue;
      }

      if (lowerHtml.startsWith('</', nextTagStart)) {
        const closingTagEnd = this.findTagEnd(html, nextTagStart);
        if (closingTagEnd === -1) {
          result += html.slice(nextTagStart);
          break;
        }

        result += html.slice(nextTagStart, closingTagEnd + 1);
        index = closingTagEnd + 1;
        continue;
      }

      if (lowerHtml.startsWith('<!', nextTagStart) || lowerHtml.startsWith('<?', nextTagStart)) {
        const declarationEnd = html.indexOf('>', nextTagStart + 2);
        if (declarationEnd === -1) {
          result += html.slice(nextTagStart);
          break;
        }

        result += html.slice(nextTagStart, declarationEnd + 1);
        index = declarationEnd + 1;
        continue;
      }

      const tagEnd = this.findTagEnd(html, nextTagStart);
      if (tagEnd === -1) {
        result += html.slice(nextTagStart);
        break;
      }

      const tagSource = html.slice(nextTagStart, tagEnd + 1);
      const rewrittenTag = this.rewriteOpenTagForPreview(
        webview,
        tagSource,
        currentBaseUrl,
      );
      result += rewrittenTag.html;
      currentBaseUrl = rewrittenTag.baseUrl;
      index = tagEnd + 1;

      if (this.isRawTextElement(rewrittenTag.tagName) && !rewrittenTag.selfClosing) {
        const closingTagStart = lowerHtml.indexOf(
          `</${rewrittenTag.tagName}`,
          index,
        );

        if (closingTagStart === -1) {
          result += html.slice(index);
          break;
        }

        result += html.slice(index, closingTagStart);
        index = closingTagStart;
      }
    }

    return result;
  }

  private rewriteOpenTagForPreview(
    webview: vscode.Webview,
    tagSource: string,
    currentBaseUrl: string,
  ): {
    html: string;
    tagName: string;
    selfClosing: boolean;
    baseUrl: string;
  } {
    const tagNameMatch = tagSource.match(/^<\s*([^\s/>]+)/);
    if (!tagNameMatch) {
      return {
        html: tagSource,
        tagName: '',
        selfClosing: false,
        baseUrl: currentBaseUrl,
      };
    }

    const tagName = tagNameMatch[1].toLowerCase();
    const selfClosing = /\/\s*>$/.test(tagSource);
    const tagContentEnd = tagSource.length - (selfClosing ? 2 : 1);
    let cursor = 1;
    let rewrittenTag = '<';
    let nextBaseUrl = currentBaseUrl;

    while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
      rewrittenTag += tagSource[cursor];
      cursor += 1;
    }

    rewrittenTag += tagSource.slice(cursor, cursor + tagNameMatch[1].length);
    cursor += tagNameMatch[1].length;

    while (cursor < tagContentEnd) {
      const whitespaceStart = cursor;
      while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
        cursor += 1;
      }
      rewrittenTag += tagSource.slice(whitespaceStart, cursor);

      if (cursor >= tagContentEnd) {
        break;
      }

      if (tagSource[cursor] === '/') {
        rewrittenTag += tagSource.slice(cursor, tagContentEnd);
        cursor = tagContentEnd;
        break;
      }

      const attrNameStart = cursor;
      while (cursor < tagContentEnd && !/[\s=/>]/.test(tagSource[cursor])) {
        cursor += 1;
      }

      const attrNameSource = tagSource.slice(attrNameStart, cursor);
      const attrName = attrNameSource.toLowerCase();
      rewrittenTag += attrNameSource;

      const whitespaceAfterNameStart = cursor;
      while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
        cursor += 1;
      }
      rewrittenTag += tagSource.slice(whitespaceAfterNameStart, cursor);

      if (cursor >= tagContentEnd || tagSource[cursor] !== '=') {
        continue;
      }

      rewrittenTag += '=';
      cursor += 1;

      const whitespaceAfterEqualsStart = cursor;
      while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
        cursor += 1;
      }
      rewrittenTag += tagSource.slice(whitespaceAfterEqualsStart, cursor);

      if (cursor >= tagContentEnd) {
        break;
      }

      const quote = tagSource[cursor] === '"' || tagSource[cursor] === "'"
        ? tagSource[cursor]
        : '';
      let attrValue = '';

      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < tagContentEnd && tagSource[cursor] !== quote) {
          cursor += 1;
        }
        attrValue = tagSource.slice(valueStart, cursor);
        const rewrittenValue = this.rewriteAttributeValueForPreview(
          webview,
          tagName,
          attrName,
          attrValue,
          currentBaseUrl,
        );
        rewrittenTag += `${quote}${rewrittenValue}${quote}`;
        if (cursor < tagContentEnd && tagSource[cursor] === quote) {
          cursor += 1;
        }
      } else {
        const valueStart = cursor;
        while (cursor < tagContentEnd && !/[\s>]/.test(tagSource[cursor])) {
          cursor += 1;
        }
        attrValue = tagSource.slice(valueStart, cursor);
        const rewrittenValue = this.rewriteAttributeValueForPreview(
          webview,
          tagName,
          attrName,
          attrValue,
          currentBaseUrl,
        );
        rewrittenTag += `"${rewrittenValue}"`;
      }

      if (tagName === 'base' && attrName === 'href') {
        nextBaseUrl =
          this.resolveUrlAgainstBase(currentBaseUrl, attrValue) ?? currentBaseUrl;
      }
    }

    rewrittenTag += selfClosing ? '/>' : '>';

    return {
      html: rewrittenTag,
      tagName,
      selfClosing,
      baseUrl: nextBaseUrl,
    };
  }

  private rewriteAttributeValueForPreview(
    webview: vscode.Webview,
    tagName: string,
    attrName: string,
    value: string,
    currentBaseUrl: string,
  ): string {
    const normalizedValue = this.normalizeAttributeValueForPreview(
      tagName,
      attrName,
      value,
    );

    if (attrName === 'srcset') {
      return this.rewriteSrcsetForPreview(
        webview,
        normalizedValue,
        currentBaseUrl,
      );
    }

    if (!this.shouldRewriteAttribute(attrName)) {
      return normalizedValue;
    }

    return this.rewriteUrlForPreview(webview, currentBaseUrl, normalizedValue);
  }

  private normalizeAttributeValueForPreview(
    _tagName: string,
    attrName: string,
    value: string,
  ): string {
    if (attrName !== 'class') {
      return value;
    }

    const classNames = value.split(/\s+/).filter(Boolean);
    if (
      !classNames.includes('html-widget') ||
      !classNames.includes('html-widget-static-bound')
    ) {
      return value;
    }

    return classNames
      .filter((className) => className !== 'html-widget-static-bound')
      .join(' ');
  }

  private shouldRewriteAttribute(attrName: string): boolean {
    return (
      attrName === 'href' ||
      attrName === 'src' ||
      attrName === 'srcset' ||
      attrName === 'poster' ||
      attrName === 'data' ||
      attrName === 'action' ||
      attrName === 'formaction' ||
      attrName === 'xlink:href'
    );
  }

  private rewriteSrcsetForPreview(
    webview: vscode.Webview,
    srcset: string,
    currentBaseUrl: string,
  ): string {
    if (!srcset || srcset.includes('data:')) {
      return srcset;
    }

    return srcset
      .split(',')
      .map((candidate) => {
        const trimmedCandidate = candidate.trim();
        if (!trimmedCandidate) {
          return candidate;
        }

        const separatorIndex = trimmedCandidate.search(/\s/);
        if (separatorIndex === -1) {
          return this.rewriteUrlForPreview(
            webview,
            currentBaseUrl,
            trimmedCandidate,
          );
        }

        const urlPart = trimmedCandidate.slice(0, separatorIndex);
        const descriptorPart = trimmedCandidate.slice(separatorIndex);
        return `${this.rewriteUrlForPreview(webview, currentBaseUrl, urlPart)}${descriptorPart}`;
      })
      .join(', ');
  }

  private rewriteUrlForPreview(
    webview: vscode.Webview,
    currentBaseUrl: string,
    value: string,
  ): string {
    if (!this.shouldRewriteResourceUrl(value)) {
      return value;
    }

    const resolvedUrl = this.resolveUrlAgainstBase(currentBaseUrl, value);
    if (!resolvedUrl) {
      return value;
    }

    if (this.isRemoteResourceUrl(resolvedUrl)) {
      return resolvedUrl;
    }

    return webview.asWebviewUri(vscode.Uri.parse(resolvedUrl)).toString();
  }

  private resolveUrlAgainstBase(
    currentBaseUrl: string,
    value: string,
  ): string | undefined {
    try {
      return new URL(value, currentBaseUrl).toString();
    } catch {
      return undefined;
    }
  }

  private shouldRewriteResourceUrl(value: string): boolean {
    if (!value) {
      return false;
    }

    return !(
      value.startsWith('#') ||
      value.startsWith('//') ||
      /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    );
  }

  private isRemoteResourceUrl(value: string): boolean {
    return /^(https?|data|blob):/i.test(value);
  }

  private isRawTextElement(tagName: string): boolean {
    return (
      tagName === 'script' ||
      tagName === 'style' ||
      tagName === 'textarea' ||
      tagName === 'title'
    );
  }

  private findTagEnd(html: string, startIndex: number): number {
    let quote: '"' | "'" | undefined;

    for (let index = startIndex + 1; index < html.length; index += 1) {
      const character = html[index];

      if (quote) {
        if (character === quote) {
          quote = undefined;
        }
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }

      if (character === '>') {
        return index;
      }
    }

    return -1;
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
    const toolbar = `
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
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const zoomLabel = document.getElementById('simple-html-viewer-zoom-label');
  const zoomStyleId = 'simple-html-viewer-page-zoom-style';
  const root = document.getElementById('simple-html-viewer-root');
  const offset = document.getElementById('simple-html-viewer-offset');
  const ensureStyle = (styleId) => {
    let style = document.getElementById(styleId);
    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    return style;
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
      applyLayoutOffset();
      dispatchResize();
      requestAnimationFrame(dispatchResize);
    });
  };
  const applyZoom = (value) => {
    const style = ensureStyle(zoomStyleId);
    style.textContent =
      value === 100
        ? ''
        : 'body > :not(#simple-html-viewer-root):not(#simple-html-viewer-offset):not(script):not(style) { zoom: ' +
            String(value / 100) +
            '; }';
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

  window.addEventListener('load', applyLayoutOffset);
  window.addEventListener('resize', applyLayoutOffset);
  requestAnimationFrame(applyLayoutOffset);

  applyZoom(${zoom});
  vscode.postMessage({ type: 'ready' });
</script>
`;

    const withStylesheet = this.injectIntoHead(
      preparedHtml,
      `<link href="${stylesUri}" rel="stylesheet">`,
    );

    const withToolbar = withStylesheet.replace(
      /<body(\s[^>]*)?>/i,
      (match) => `${match}${toolbar}`,
    );

    if (withToolbar !== withStylesheet) {
      return withToolbar;
    }

    return `<!DOCTYPE html><html><head><link href="${stylesUri}" rel="stylesheet"></head><body>${toolbar}${preparedHtml}</body></html>`;
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
