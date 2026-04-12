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
- Hosts the preview content inside an iframe so the shell UI stays stable while the HTML document updates.

### HTML document rendering

- Reads the selected HTML file as text.
- Injects a `<base>` element that points to the HTML file's directory using `webview.asWebviewUri(...)`.
- Loads the result into the iframe using `srcdoc`, which allows embedded JavaScript and interactive libraries to execute inside the preview.

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
- Toolbar actions update the current preview immediately and can later be extended with stronger per-file persistence if needed.

