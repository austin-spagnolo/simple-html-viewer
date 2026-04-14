# Simple HTML Viewer

Simple HTML Viewer is a minimal VS Code extension for rendering interactive HTML documents inside VS Code without relying on a localhost preview server.

## Highlights

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

## Usage

Open any `.html` or `.htm` file and use `Simple HTML Viewer: Open Preview`, the explorer context menu, the editor title action, or `Open With...` to launch the preview.

## Settings

- `simpleHtmlViewer.autoRefresh`: `onSave` or `off`
- `simpleHtmlViewer.zoomStep`: zoom increment percentage
- `simpleHtmlViewer.defaultZoom`: starting zoom percentage

## Limitations

- Very wide or fixed-width HTML documents may still require horizontal scrolling at larger zoom levels.
- Aggressive page-level CSS may affect the injected preview toolbar because the toolbar lives in the same document as the previewed HTML.
- The current zoom model is optimized for Chromium-based VS Code webviews and may render some third-party widgets slightly differently than a standalone browser.

## Development

```bash
npm install
npm run check
```

Press `F5` in VS Code to launch an Extension Development Host.

## Project Docs

- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Release Checklist](docs/release-checklist.md)
