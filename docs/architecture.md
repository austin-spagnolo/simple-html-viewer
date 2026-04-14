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
- Injects the toolbar directly into the rendered preview document rather than hosting the user HTML inside a nested iframe.

### HTML document rendering

- Reads the selected HTML file as text.
- Rewrites relative `src` and `href` resource references to `webview.asWebviewUri(...)` values.
- Injects a preview-specific Content Security Policy that allows local rewritten assets, inline scripts, and remote resources such as Plotly CDN.
- Rebuilds the final preview document as a single webview HTML document so interactive content runs in the same DOM as the toolbar and content surface.

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
- Zoom is applied inside the webview document using Chromium-backed CSS zoom behavior rather than reloading the page for every zoom change.
- Toolbar actions update the current preview immediately while preserving the page state of interactive content.

## Tradeoffs

- Because the toolbar is injected into the same document as the previewed page, very aggressive page-level CSS could affect toolbar layout.
- The current zoom model is optimized for Chromium-based VS Code webviews and may not match standalone browser zoom perfectly for every third-party widget.
