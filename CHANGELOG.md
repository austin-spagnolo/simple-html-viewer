# Changelog

## 0.1.0

- Added optional Integrated Browser routing for eligible local HTML, while keeping the remote-capable webview as the default.
- Reused existing preview tabs and groups instead of opening another editor split on every Preview command.
- Moved zoom and refresh controls into VS Code's editor UI so they cannot cover page content; addresses [issue #1](https://github.com/austin-spagnolo/simple-html-viewer/issues/1).
- Added preview-only zoom shortcuts and clearer icons for the editor action and Marketplace listing.
- Clarified the custom editor name in the Open With menu.
- Coalesced overlapping webview refresh requests and prevented stale or disposed renders from replacing the latest page.
- Added opt-in file watching so an open preview can refresh when another program rewrites its HTML file; save-only refresh remains the default.
- Updated documentation around local and remote rendering and backend-specific controls.

## 0.0.3

- Fixed dark-theme color leakage into light-themed HTML tables.
- Fixed Plotly hover hit-testing after toolbar zoom by isolating preview scaling from the document coordinate space.

## 0.0.2

- Added release gates for unit tests, extension-host smoke tests, and packaged VSIX smoke tests.
- Added active-content settings so script and remote-resource execution is gated by workspace trust by default.
- Added a preview fallback for file read and render failures.

## 0.0.1

- Initial project scaffold.
- Initial readonly HTML preview implementation with zoom toolbar.
- Reworked the preview renderer so local JavaScript, inline scripts, and CDN-backed libraries such as Plotly execute correctly.
- Improved zoom behavior so zoom updates preserve page state instead of reloading the document.
- Fixed zoomed interactive charts so hover hit-testing stays aligned with the mouse pointer.
- Added manual QA documentation, release workflow scaffolding, and marketplace metadata preparation.
