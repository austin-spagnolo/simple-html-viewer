# Architecture

## Overview

The extension uses a VS Code readonly custom editor backed by a webview. This avoids relying on a local HTTP server and is better aligned with Remote-SSH and other remote workspace modes.

## Main Components

### Extension host

- Registers commands and the custom editor provider.
- Reads HTML files through VS Code workspace APIs.
- Watches save events and refreshes matching previews.
- Persists lightweight preview state such as zoom level.

### Webview shell

- Renders the preview toolbar.
- Owns zoom controls, refresh behavior, and state synchronization.
- Hosts the rendered HTML in an iframe so page-level CSS cannot restyle the toolbar and frame-level scaling does not distort pointer coordinates inside interactive documents.

### HTML document rendering

- Reads the selected HTML file as text.
- Rewrites resource-bearing HTML attributes such as `src`, `href`, `srcset`, `poster`, and `data` to `webview.asWebviewUri(...)` values using a tag-aware scanner instead of global string replacement.
- Injects a preview-specific Content Security Policy that allows local rewritten assets, inline scripts, and remote resources such as Plotly CDN.
- Gates script execution and remote resource loading behind workspace trust by default, with settings for always-on active content or fully blocked page scripts.
- Rebuilds the final preview document as an iframe `srcdoc` so interactive content runs in its own document while the toolbar remains in the parent webview shell.
- Applies a narrow saved-page normalization step for stale HTML widget binding classes captured by "Save page as" artifacts.

## Remote Support Strategy

- No localhost web server is required for preview rendering.
- File access goes through VS Code APIs and webview resource URIs.
- This keeps the design compatible with local and Remote-SSH usage without depending on port forwarding.

## Refresh Strategy

Initial implementation:

- `onSave`: refresh when the backing HTML file is saved.
- `off`: disable auto-refresh and expose a toolbar refresh button.

Planned future enhancement:

- `whileTyping`: hook into document change events with a debounce timer and optional file-size guardrail.

## Zoom Strategy

- A configurable global default zoom is provided through extension settings.
- Each open preview maintains its current zoom independently from VS Code application zoom.
- Zoom is applied by scaling the preview frame viewport from the parent webview shell so pointer coordinates inside the preview document remain aligned.
- Toolbar actions update the current preview immediately while preserving the page state of interactive content.

## Tradeoffs

- The preview now uses an iframe boundary. This keeps the toolbar isolated, but it also means the preview document scrolls inside the frame rather than the parent webview shell.
- The current zoom model is optimized for Chromium-based VS Code webviews and may not match standalone browser zoom perfectly for every third-party widget.
