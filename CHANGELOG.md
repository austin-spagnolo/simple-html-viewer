# Changelog

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
