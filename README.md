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
npm run package:vsix
```

Before the first publish:

- Push the latest local commits to GitHub.
- Package a `.vsix` locally and install it once as a final smoke test.
- Confirm the `VSCE_PAT` GitHub Actions secret exists for the repository.

## GitHub And Marketplace Setup

1. Push the current branch to GitHub.
2. Open the repository `Actions` tab and choose the `Release` workflow.
3. Run the workflow with `publish` set to `false` if you only want a packaged `.vsix` artifact.
4. Run the workflow with `publish` set to `true` when you are ready to publish to the VS Code Marketplace.
5. If you prefer local publishing, run `npx @vscode/vsce publish` after confirming the Marketplace publisher and token are set up.
