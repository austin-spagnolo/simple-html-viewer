import * as vscode from 'vscode';

export type ViewerMode = 'webview' | 'auto' | 'integratedBrowser';

const browserCommand = 'workbench.action.browser.open';
const webviewType = 'simpleHtmlViewer.preview';

/** Keep the private workbench command and its versioned contract in one place. */
export class ViewerRouter {
  private pending: Promise<void> = Promise.resolve();

  public open(uri: vscode.Uri): Promise<void> {
    // Serialize opens so rapid repeated invocations see the tab just created.
    const operation = this.pending.then(() => this.openOnce(uri));
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  private async openOnce(uri: vscode.Uri): Promise<void> {
    const config = vscode.workspace.getConfiguration('simpleHtmlViewer', uri);
    const mode = config.get<ViewerMode>('viewer', 'webview');
    if (mode === 'auto' || mode === 'integratedBrowser') {
      let reason = this.browserIneligibility(uri, mode);
      if (!reason) {
        try {
          if (
            !(await vscode.commands.getCommands(true)).includes(browserCommand)
          ) {
            reason = 'Integrated Browser is unavailable in this VS Code window';
          } else {
            // This options contract is verified in VS Code 1.118.1. Reuse is a
            // glob match on the decoded URI path, so escape filename syntax.
            const filter = uri.with({
              path: uri.path.replace(
                /[[\]*?{}]/g,
                (character) => `[${character}]`,
              ),
            });
            await vscode.commands.executeCommand(browserCommand, {
              url: uri.toString(),
              reuseUrlFilter: filter.toString(),
              openToSide: false,
            });
            return;
          }
        } catch {
          reason = 'Integrated Browser could not be opened';
        }
      }
      if (mode === 'integratedBrowser') {
        void vscode.window.showInformationMessage(
          `${reason}. Using the HTML webview instead.`,
        );
      }
    }
    await this.openWebview(uri);
  }

  private browserIneligibility(
    uri: vscode.Uri,
    mode: ViewerMode,
  ): string | undefined {
    if (vscode.env.remoteName || uri.scheme !== 'file' || uri.authority) {
      return 'Direct remote HTML requires the HTML webview';
    }
    if (uri.query || uri.fragment) {
      return 'This resource requires the HTML webview';
    }
    if (
      !vscode.workspace.isTrusted ||
      vscode.workspace.getWorkspaceFolder(uri)?.uri.scheme !== 'file'
    ) {
      return 'Integrated Browser requires a file inside a trusted local workspace';
    }
    const version = /^(\d+)\.(\d+)\.(\d+)/.exec(vscode.version);
    if (
      !version ||
      Number(version[1]) < 1 ||
      (Number(version[1]) === 1 &&
        (Number(version[2]) < 118 ||
          (Number(version[2]) === 118 && Number(version[3]) < 1)))
    ) {
      return 'This integration requires VS Code 1.118.1 or later';
    }
    // Explicit native selection delegates security and page controls to VS Code.
    // Auto must not silently bypass the user's existing webview restrictions.
    if (mode === 'auto') {
      // Earlier browser versions do not reload local files when they change.
      if (Number(version[1]) === 1 && Number(version[2]) < 133) {
        return 'Automatic browser selection requires VS Code 1.133 or later';
      }
      const config = vscode.workspace.getConfiguration('simpleHtmlViewer', uri);
      const activeContent = config.get<string>(
        'activeContent',
        'trustedWorkspaces',
      );
      if (activeContent !== 'always' && activeContent !== 'trustedWorkspaces') {
        return 'The selected content restrictions require the HTML webview';
      }
    }
    return undefined;
  }

  private async openWebview(uri: vscode.Uri): Promise<void> {
    const groups = vscode.window.tabGroups.all;
    const existing = groups.find((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputCustom &&
          tab.input.viewType === webviewType &&
          tab.input.uri.toString() === uri.toString(),
      ),
    );
    // Reuse a preview group for different documents too, rather than creating
    // another split every time the command runs from a preview tab.
    const previewGroup =
      existing ??
      groups.find((group) =>
        group.tabs.some(
          (tab) =>
            tab.input instanceof vscode.TabInputCustom &&
            tab.input.viewType === webviewType,
        ),
      );
    await vscode.commands.executeCommand('vscode.openWith', uri, webviewType, {
      viewColumn: previewGroup?.viewColumn ?? vscode.ViewColumn.Beside,
      preview: false,
    });
  }
}

export function activeHtmlResource(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (
    input instanceof vscode.TabInputCustom &&
    input.viewType === webviewType
  ) {
    return input.uri;
  }
  return vscode.window.activeTextEditor?.document.uri;
}
