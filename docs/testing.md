# Testing Guide

## Automated

- Run `npm run test` for fast regression checks around HTML rewriting and saved-page normalization.
- Run `npm run test:smoke` for extension-host smoke coverage of command registration and opening the custom preview editor.
- Run `npm run test:smoke:vsix` to package the extension, install the VSIX into an isolated test profile, and verify the installed artifact activates.

## Baseline

- Launch the extension with `F5`.
- Open [`test/user-test.html`](../test/user-test.html) in the Extension Development Host.

## Open Paths

- Open preview from the command palette.
- Open preview from the editor title.
- Open preview from the explorer context menu.
- Open preview through `Open With...`.

## Interactive Content

- Click the counter button and verify the click count increments without reloading the page.
- Click the sortable table headers and verify row ordering changes.
- Verify the Plotly chart renders.
- Hover or interact with the Plotly chart and verify tooltips/interaction still work.
- Change zoom and verify responsive widgets such as Plotly relayout immediately without requiring a pane resize.
- At non-default zoom levels, verify the Plotly hover point stays aligned with the mouse pointer.
- Open a saved complex HTML page with a companion asset folder and verify local scripts and styles still load.

## Refresh

- Set `simpleHtmlViewer.autoRefresh` to `onSave`.
- Edit the page heading, save, and verify the preview updates automatically.
- Set `simpleHtmlViewer.autoRefresh` to `off`.
- Edit the page heading again, save, and verify the preview does not change until `refresh` is clicked.

## Zoom

- Verify `+` increases zoom.
- Verify `-` decreases zoom.
- Verify `reset` returns to the configured default zoom.
- Verify zoom changes do not affect VS Code application zoom.
- Verify the toolbar does not cover the top of the document and the reserved gap remains visually stable as zoom changes.
- Verify a document-level floating or sticky table of contents remains anchored while scrolling at zoom levels above 100%.

## Remote

- Repeat the core checks in a Remote-SSH workspace.
- Verify local CSS, local JS, and external CDN resources still load as expected.
