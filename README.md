# Simple HTML Viewer

Simple HTML Viewer is a VS Code extension for rendering interactive HTML documents directly inside the editor without relying on a localhost preview server.

If you want an in-editor HTML preview that stays simple, supports real JavaScript, and works cleanly in local and Remote-SSH workflows, this extension is built for that.

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
- Remote-friendly design that does not depend on forwarded localhost ports.

## Screenshots

Add Marketplace-ready screenshots or a short GIF here once the final capture set is ready.

Suggested assets:

- Main preview view with the zoom toolbar visible
- Interactive Plotly example
- Manual refresh mode
- Remote-SSH usage screenshot or short animated demo

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
- Aggressive page-level CSS may affect the injected preview toolbar because the toolbar lives in the same document as the previewed HTML.
- The current zoom model is optimized for Chromium-based VS Code webviews and may render some third-party widgets slightly differently than a standalone browser.

## Development

```bash
npm install
npm run check
```

Press `F5` in VS Code to launch an Extension Development Host.

## Documentation

- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Release Checklist](docs/release-checklist.md)
