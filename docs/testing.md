# Testing Guide

## Automated

- Run `npm run test` for fast regression checks around HTML rewriting and saved-page normalization.
- Run `npm run test:smoke` for extension-host smoke coverage of command registration and opening the custom preview editor.
- Run `npm run test:smoke:vsix` to package the extension, install the VSIX into an isolated test profile, and verify the installed artifact activates.

## Renderer selection

- With `simpleHtmlViewer.viewer=webview`, open the same file twice and confirm one custom preview tab is reused. Open another HTML file and confirm its preview uses the existing side group.
- With `viewer=integratedBrowser`, open a trusted local workspace HTML file and confirm it opens in VS Code's browser. Open a Remote-SSH file and confirm the extension explains the webview fallback.
- With `viewer=auto`, check a trusted local file on VS Code 1.133+ while `activeContent` is enabled. Then set `activeContent=off` and confirm the webview is selected. Changing `allowInsecureContent` should not change renderer selection.
- Check an untrusted workspace, a loose file outside the workspace, and an older VS Code version: these should remain on the webview path.
- Open a file through `Open With...` and confirm it always uses the webview.
- Confirm the Open With entry shows the extension name once, without repeating it.

## Baseline

- Launch the extension with `F5`.
- Open [`test/user-test.html`](../test/user-test.html) in the Extension Development Host.

## Open Paths

- Open preview from the command palette.
- Open preview from the editor title.
- Open preview from the explorer context menu.
- Open preview through `Open With...`.
- Repeat the Preview command on the same file and a second file; verify editor groups do not keep multiplying.

## Interactive Content

- Click the counter button and verify the click count increments without reloading the page.
- Click the sortable table headers and verify row ordering changes.
- Verify the Plotly chart renders.
- Hover or interact with the Plotly chart and verify tooltips/interaction still work.
- Change zoom and verify responsive widgets such as Plotly relayout immediately without requiring a pane resize.
- At non-default zoom levels, verify the Plotly hover point stays aligned with the mouse pointer.
- In a dark VS Code theme, open a light-themed HTML table and verify table text remains readable with the page's light color scheme.
- Open a saved complex HTML page with a companion asset folder and verify local scripts and styles still load.

## Refresh

- Set `simpleHtmlViewer.autoRefresh` to `onSave`.
- Edit the page heading, save, and verify the preview updates automatically.
- Set `simpleHtmlViewer.autoRefresh` to `off`.
- Edit the page heading again, save, and verify the preview does not change until **Refresh Preview** is run from the editor title.
- Save several rapid revisions while a larger file is refreshing. Verify the final revision appears and that closing the preview during a refresh does not produce an error.

## Zoom

- Verify the editor title **Zoom In** and **Zoom Out** actions change webview zoom.
- Verify **Reset Zoom** returns to the configured default zoom.
- With a webview preview active, verify `Ctrl+=`, `Ctrl+-`, and `Ctrl+0` (or the macOS `Cmd` equivalents) zoom in, zoom out, and reset. Confirm the keys retain their usual VS Code behavior outside a preview.
- Verify zoom changes do not affect VS Code application zoom.
- Verify no viewer toolbar is inserted into or covers the HTML document.
- Verify a document-level floating or sticky table of contents remains anchored while scrolling at zoom levels above 100%.

## Remote

- Repeat the core checks in a Remote-SSH workspace.
- Verify local CSS, local JS, and external CDN resources still load as expected.
- Check a generated artifact with companion assets and a larger self-contained artifact. Record file size, read/refresh time, and whether the document becomes interactive.
- When available, sample Plotly, Bokeh, Vega, MathJax, DataTables, and Jupyter exports. Record which formats were actually exercised rather than treating the list as automatic coverage.
