# Release Checklist

Review the branching and release workflow in [release-process.md](./release-process.md) before cutting a release.

## Metadata

- Review the extension description, keywords, categories, and gallery banner values.

## Marketplace

- Create or confirm the VS Code Marketplace publisher.
- Create a Marketplace personal access token.
- Add `VSCE_PAT` to GitHub Actions secrets if automated publishing is desired.

## Validation

- Run `npm run check`.
- Run `npm run test`.
- Run `npm run test:smoke`.
- Run `npm run test:smoke:vsix`.
- Install the packaged `.vsix` locally and perform a final smoke test.
- Run the testing guide in [testing.md](./testing.md).
- Check both webview and Integrated Browser routes, including repeated opens and a real remote workspace.
- Confirm the packaged version, changelog, and Marketplace description match the shipped behavior.

## GitHub

- Push the latest local commits to GitHub.
- Confirm the Git tag matches `package.json` exactly, such as `v0.1.0` for version `0.1.0`.
- Confirm the `CI` workflow runs on `master`.
- Use the manual `Release` workflow to create a GitHub Release and attach the packaged `.vsix`.
- Set `publish` to `true` in the `Release` workflow when you also want to publish to the VS Code Marketplace.
