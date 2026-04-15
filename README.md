# Simple HTML Viewer

Simple HTML Viewer is a VS Code extension for rendering interactive HTML documents directly inside the editor without relying on a localhost preview server.

It is built for HTML files that need real browser behavior inside VS Code: embedded JavaScript, third-party widgets, saved web pages, and local asset folders.

## Why Simple HTML Viewer?

- Preview HTML inside VS Code without spinning up a local web server.
- Render interactive content such as Plotly charts, sortable tables, and embedded JavaScript.
- Control preview zoom independently from VS Code application zoom.
- Use the same preview workflow in local workspaces and Remote-SSH sessions.

## Features

- Open previews from the command palette, editor title, explorer context menu, or `Open With...`.
- Zoom toolbar with `-`, current zoom percentage, `+`, and `reset`.
- Auto-refresh on save by default.
- Manual refresh mode when auto-refresh is disabled.
- Rewrites local resource references for VS Code webviews while still allowing remote CDN assets.
- Handles responsive widgets that need relayout on zoom changes.
- Remote-friendly design that does not depend on forwarded localhost ports.

## Usage

Open any `.html` or `.htm` file and use one of these entry points:

- `Simple HTML Viewer: Open Preview` from the command palette
- Explorer context menu
- Editor title action
- `Open With...`

## Settings

- `simpleHtmlViewer.autoRefresh`: `onSave` or `off`
- `simpleHtmlViewer.zoomStep`: zoom increment percentage
- `simpleHtmlViewer.defaultZoom`: starting zoom percentage

## Notes

- Very wide or fixed-width HTML documents may still require horizontal scrolling at larger zoom levels.
- The toolbar is injected into the preview document, so extremely aggressive page-level CSS can still affect its presentation.
- The current zoom model is optimized for Chromium-based VS Code webviews and may render some third-party widgets slightly differently than a standalone browser.
- Saved web pages still depend on whatever companion assets were captured with them. If a saved page is missing fonts, images, or scripts on disk, the preview cannot recreate those files.

## Development

```bash
npm install
npm run check
npm run test
npm run test:smoke
npm run package:vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

## Documentation

- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Release Checklist](docs/release-checklist.md)
