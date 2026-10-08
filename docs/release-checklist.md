# Release Checklist

Review the branching and release workflow in [release-process.md](./release-process.md) before cutting a release.

## Metadata

- Review the extension description, keywords, categories, and gallery banner values.

## Marketplace

- Create or confirm the VS Code Marketplace publisher.
- Create a Marketplace personal access token.
- Add `VSCE_PAT` to GitHub Actions secrets if automated publishing is desired.

## OpenVSX

- Create or confirm an Eclipse account and accept the [Eclipse Foundation Publisher Agreement](https://www.eclipse.org/legal/documents/eclipse-foundation-publisher-agreement.pdf).
- Sign in to Open VSX using the GitHub identity that will own the namespace.
- Create the `austin-spagnolo` namespace with `npx ovsx create-namespace austin-spagnolo` using `OVSX_PAT` in your local environment. If it already exists, confirm publishing access or claim ownership.
- Create an Open VSX access token and add it to the repository's GitHub Actions secrets as `OVSX_PAT`. Never paste the token into workflow inputs, commits, or logs.
- Namespace ownership verification is not required before the initial publish using the PAT. Optional trusted publishing later requires a verified namespace owner, an existing active extension version, and a matching workflow configuration; trusted publishing is not currently configured.

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
- The workflow builds and tests one VSIX, then uses that same artifact for each selected registry. Marketplace and Open VSX publishing are independent and have separate duplicate checks and retry behavior.
- Set `publish` to the boolean-string choice `true` to publish to the VS Code Marketplace; set `publish_open_vsx` to `true` to publish to Open VSX. Either can be enabled without the other. Both default to `false`, so a manual run with both set to `false` creates or updates the GitHub Release only.
- To bootstrap Open VSX for the existing `v0.1.0` tag, select `master` as the workflow branch and enter `v0.1.0` in the `tag` input with `publish=false` and `publish_open_vsx=true`. This republishes the VSIX attached to that existing GitHub Release; it does not build a new release from the workflow's current branch.
