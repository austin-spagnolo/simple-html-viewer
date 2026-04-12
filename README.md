# Simple HTML Viewer

Simple HTML Viewer is a minimal VS Code extension for rendering interactive HTML documents inside VS Code without relying on a localhost preview server.

## Goals

- Keep HTML preview simple and reliable.
- Support interactive HTML, embedded JavaScript, and libraries such as Plotly.
- Provide preview zoom controls independent of VS Code application zoom.
- Work in local and Remote-SSH development scenarios.

## Features

- Open HTML previews from the command palette, editor title, explorer context menu, or `Open With...`.
- Render HTML in a VS Code webview.
- Zoom toolbar with `-`, current zoom percentage, `+`, and `reset`.
- Refresh button when auto-refresh is disabled.
- Auto-refresh on save by default.

## Settings

- `simpleHtmlViewer.autoRefresh`: `onSave` or `off`
- `simpleHtmlViewer.zoomStep`: zoom increment percentage
- `simpleHtmlViewer.defaultZoom`: starting zoom percentage

## Development

```bash
npm install
npm run check
```

Press `F5` in VS Code to launch an Extension Development Host.

## Publishing

```bash
npm install
npm run package
```

Before publishing:

- Replace the placeholder `publisher`, `repository`, `homepage`, and `bugs` values in `package.json`.
- Add a real extension icon at `media/icon.png`.
- Create a VS Code Marketplace publisher and authentication token.

