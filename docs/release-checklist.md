# Release Checklist

## Metadata

- Replace the placeholder `publisher` value in `package.json`.
- Replace the placeholder GitHub repository URLs in `package.json`.
- Review the extension description, keywords, categories, and gallery banner values.

## Marketplace

- Create or confirm the VS Code Marketplace publisher.
- Create a Marketplace personal access token.
- Add `VSCE_PAT` to GitHub Actions secrets if automated publishing is desired.

## Validation

- Run `npm run check`.
- Run `npm run package:vsix`.
- Install the packaged `.vsix` locally and perform a final smoke test.
- Run the manual QA checklist in [manual-qa.md](./manual-qa.md).

## GitHub

- Push the repository to GitHub.
- Confirm the `CI` workflow runs on the default branch.
- Use the manual `Release` workflow to package or publish the extension.
