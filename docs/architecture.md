# Architecture

## Renderer selection

**Open Preview** routes through `ViewerRouter`. The default is the extension's readonly custom editor. An explicit Integrated Browser setting can delegate eligible trusted local files to VS Code. The optional `auto` mode applies a stricter policy so it does not silently bypass existing webview content restrictions. Remote and virtual file resources remain on the custom editor. `Open With…` invokes the custom editor directly.

The native browser command is isolated in the router because it is a workbench command rather than a typed extension API. The adapter checks command availability and uses the existing webview when delegation is unavailable. Repeated opens reuse a matching browser URL or the existing custom preview group.

## Custom webview

- The extension host reads HTML through `vscode.workspace.fs`, including remote files.
- The renderer rewrites resource-bearing attributes such as `src`, `href`, `srcset`, `poster`, and `data` to `webview.asWebviewUri(...)` values using a tag-aware scanner.
- A preview Content Security Policy gates page scripts and remote resources behind workspace trust by default. The optional insecure-content setting controls `http:` and `ws:` sources.
- Saved-page normalization removes stale HTML widget binding classes where needed.
- The final preview is one document so generated scripts run in the expected DOM. A content wrapper supports zoom scaling and responsive widget relayout.
- Refresh and zoom controls are contributed to VS Code's editor UI, outside the artifact document.

## Refresh and zoom

Webview previews refresh on save by default, or through **Refresh Preview** when auto-refresh is off. Refresh rereads the backing file and replaces the webview document. Concurrent refresh requests for a panel are coalesced; only the latest pending result is applied.

Each file keeps its webview zoom in workspace state; zoom messages update open previews without reloading page state. Integrated Browser tabs follow VS Code's own reload and page zoom settings. The extension does not control their browser lifecycle.

## Remote support

No local HTTP server is required. The custom editor uses workspace file APIs and webview resource URIs, so the same path works with Remote-SSH and other remote workspace schemes without port forwarding. VS Code's Integrated Browser handles remote HTTP(S) services, but does not proxy remote file URLs.

## Limits

- The zoom model is optimized for Chromium-based VS Code webviews and can differ from standalone browser zoom for some widgets.
- Full document refresh restarts page scripts and layout. Large remote artifacts or pages with many assets may take longer to become interactive after the extension has dispatched the replacement HTML.
