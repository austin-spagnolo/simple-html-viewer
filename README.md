# Simple HTML Viewer

Preview `.html` and `.htm` files in VS Code, including files in Remote-SSH, Dev Containers, and Codespaces. Remote previews read the file through VS Code and load companion assets through webview resource URIs. They do not need a web server, port forward, or tunnel.

For local files, you can also send the preview to VS Code's Integrated Browser. The extension defaults to its webview so existing content controls and preview behavior stay in place.

## Open a preview

Run **Simple HTML Viewer: Open Preview** from the Command Palette, editor title, or Explorer context menu. The command uses the renderer selected by `simpleHtmlViewer.viewer`:

| Setting             | Behavior                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview` (default) | Opens local and remote files in this extension's custom editor.                                                                                |
| `integratedBrowser` | Opens eligible local files in VS Code's Integrated Browser. Remote, unsupported, or unavailable cases explain the fallback to the webview.     |
| `auto`              | Selects the Integrated Browser for a trusted local workspace file on VS Code 1.133+ unless active content is off. Other files use the webview. |

The **Open With…** entry for Simple HTML Viewer always opens the custom webview directly. The routing setting applies to the **Open Preview** command.

Repeated previews reuse the existing preview tab or group instead of creating another split each time.

## Webview features

- Open remote HTML files directly, with local CSS, scripts, images, and other companion assets.
- Render interactive generated output such as Plotly charts and sortable tables.
- Refresh on save, or turn that off and use **Refresh Preview** in the editor title.
- Use **Zoom In**, **Zoom Out**, and **Reset Zoom** from VS Code's editor controls. These controls do not cover the HTML document.
- With the webview active, use `Ctrl+=`, `Ctrl+-`, and `Ctrl+0` to zoom in, zoom out, and reset on Windows/Linux (`Cmd` instead of `Ctrl` on macOS).
- Keep zoom independent of VS Code's application zoom.

The Integrated Browser has its own navigation, DevTools, reload, and zoom controls. This extension's refresh, zoom, and content settings apply to **webview previews only**. For native browser tabs, use VS Code's `workbench.browser.autoReloadOnFileChange` and `workbench.browser.pageZoom` settings.

## Settings

- `simpleHtmlViewer.viewer`: `webview`, `integratedBrowser`, or `auto`.
- `simpleHtmlViewer.autoRefresh`: `onSave` or `off` for webview previews.
- `simpleHtmlViewer.zoomStep`: webview zoom increment in percent.
- `simpleHtmlViewer.defaultZoom`: starting webview zoom percentage.
- `simpleHtmlViewer.activeContent`: controls scripts and remote resources in webview previews. The default, `trustedWorkspaces`, permits them only in trusted workspaces.
- `simpleHtmlViewer.allowInsecureContent`: permits `http:` and `ws:` resources in active webview previews. Disabled by default.

Choosing `integratedBrowser` explicitly delegates content handling to VS Code; the extension's webview Content Security Policy does not apply there. Saved pages still need their companion asset files. Large or fixed-width HTML documents may require horizontal scrolling at higher zoom levels.

## Development

```bash
npm install
npm run check
npm run test
npm run test:smoke
npm run test:smoke:vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

## Documentation

- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Release Checklist](docs/release-checklist.md)
