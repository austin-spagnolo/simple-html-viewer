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

## Manual QA

Use [`test/user-test.html`](test/user-test.html) as the baseline test page.

- Open the preview from the command palette, editor title, explorer context menu, and `Open With...`.
- Verify the counter button increments without reloading the page.
- Verify clicking sortable table headers reorders rows.
- Verify the Plotly chart renders and remains interactive.
- Verify zoom `-`, `+`, and `reset` update the preview independently of VS Code app zoom.
- Set `simpleHtmlViewer.autoRefresh` to `onSave`, save the HTML file, and verify the preview updates automatically.
- Set `simpleHtmlViewer.autoRefresh` to `off`, save the file, confirm no automatic update occurs, then click `refresh` and confirm the preview updates.
- Repeat the same checks in a Remote-SSH workspace.

## Known Limitations

- Very wide or fixed-width HTML documents may still require horizontal scrolling at larger zoom levels.
- Aggressive page-level CSS may affect the injected preview toolbar because the toolbar lives in the same document as the previewed HTML.
- The current zoom model is optimized for Chromium-based VS Code webviews and may render some third-party widgets slightly differently than a standalone browser.

## Publishing

```bash
npm install
npm run package
```

Before publishing:

- Replace the placeholder `publisher`, `repository`, `homepage`, and `bugs` values in `package.json`.
- Create a VS Code Marketplace publisher and authentication token.
- Push the repository to GitHub and enable the included CI workflow.
- Package a `.vsix` locally and install it once as a final smoke test.

## GitHub And Marketplace Setup

1. Create a GitHub repository for the project and update the `repository`, `homepage`, and `bugs` fields in `package.json`.
2. Create or choose a VS Code Marketplace publisher and replace the placeholder `publisher` value in `package.json`.
3. Add a `VSCE_PAT` GitHub Actions secret with a Marketplace personal access token if you want the release workflow to publish automatically.
4. Run the manual `Release` workflow to package the extension or publish it once the publisher and token are configured.
