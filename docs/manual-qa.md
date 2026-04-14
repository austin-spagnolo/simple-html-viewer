# Manual QA Checklist

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

## Remote

- Repeat the core checks in a Remote-SSH workspace.
- Verify local CSS, local JS, and external CDN resources still load as expected.
