# Simple HTML Viewer

Preview HTML reports, interactive charts, and saved web pages directly in VS Code. Open a file, run **Open Preview**, and see it beside your code. There is no web server to start.

It works with local files and files in Remote-SSH, Dev Containers, and Codespaces. You can open a remote HTML report without forwarding a port or creating a tunnel.

## Get started

1. Open an `.html` or `.htm` file in VS Code.
2. Click the **Open Preview** icon in the editor title, or run **Simple HTML Viewer: Open Preview** from the Command Palette.

You can also right-click an HTML file in Explorer and choose **Open Preview**. The preview opens beside your file and refreshes when you save the HTML in VS Code.

## What it handles

- **Remote files, directly.** Preview HTML stored in a remote workspace without copying it locally or running a server.
- **Interactive output.** View generated reports with JavaScript, including Plotly charts and other widgets, in a trusted workspace.
- **Companion assets.** Load relative CSS, JavaScript, images, and fonts from the HTML file's folder and its subfolders.
- **A simple editing loop.** Save the HTML in VS Code to refresh the webview preview, or use **Refresh Preview** in the editor title. Zoom the preview independently of the rest of VS Code.

By default, automatic refresh responds to saves in VS Code. If a program regenerates the HTML file, set `simpleHtmlViewer.autoRefresh` to `onFileChange` to watch it while the preview is open. **Refresh Preview** always works, regardless of the setting.

## Preview controls

With a webview preview active, use its editor-title buttons or these shortcuts:

| Action     | Windows / Linux | macOS   |
| ---------- | --------------- | ------- |
| Zoom in    | `Ctrl+=`        | `Cmd+=` |
| Zoom out   | `Ctrl+-`        | `Cmd+-` |
| Reset zoom | `Ctrl+0`        | `Cmd+0` |

**Refresh Preview** is always available in the editor title. Set `simpleHtmlViewer.autoRefresh` to `off` if you prefer to refresh only when you choose.

## Choose a renderer

The default **webview** opens both local and remote HTML. The **Open Preview** command can optionally use VS Code's Integrated Browser for eligible local files:

| `simpleHtmlViewer.viewer` | Behavior                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview` (default)       | Preview local and remote files with this extension's refresh and zoom controls.                                                                 |
| `auto`                    | Use the Integrated Browser for trusted local workspace files on VS Code 1.133+ when active content is enabled; use the webview for other files. |
| `integratedBrowser`       | Ask VS Code to open eligible local files in its browser; use the webview when that is unavailable or the file is remote.                        |

The Integrated Browser has its own reload, zoom, navigation, and DevTools controls. **Open With…** always opens this extension's webview, regardless of the renderer setting.

## Settings

| Setting                                 | Default             | Purpose                                                                            |
| --------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `simpleHtmlViewer.viewer`               | `webview`           | Select the renderer used by **Open Preview**.                                      |
| `simpleHtmlViewer.autoRefresh`          | `onSave`            | Choose VS Code saves, file watching for external rewrites, or manual-only refresh. |
| `simpleHtmlViewer.zoomStep`             | `10`                | Set the webview zoom increment, in percent.                                        |
| `simpleHtmlViewer.defaultZoom`          | `100`               | Set the starting webview zoom percentage.                                          |
| `simpleHtmlViewer.activeContent`        | `trustedWorkspaces` | Allow page scripts and remote resources in trusted workspaces.                     |
| `simpleHtmlViewer.allowInsecureContent` | `false`             | Allow `http:` and `ws:` resources in an active webview preview.                    |

Interactive content follows the workspace trust setting by default. The Integrated Browser follows VS Code's own content, reload, and zoom settings.

## Development

```bash
npm install
npm run check
npm run test
npm run test:smoke
npm run test:smoke:vsix
```

Press `F5` in VS Code to launch an Extension Development Host. See the [architecture](docs/architecture.md), [testing guide](docs/testing.md), and [release checklist](docs/release-checklist.md) for more detail.
