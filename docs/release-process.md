# Release Process

This project uses a simple trunk-based workflow with `master` as the releasable branch. For release-day validation and publishing steps, use [release-checklist.md](./release-checklist.md).

## Branching

- Treat `master` as the releasable branch.
- Create short-lived feature, fix, and documentation branches from `master`.
- Open pull requests back into `master` after CI passes.
- Keep `master` ready to package and release.
- Use a longer-lived integration branch only for large work that needs multiple pull requests before it is safe to release.

## Release workflow

Run the manual `Release` workflow from `master`. It accepts a Git tag plus two independent boolean-string choices: `publish` for the VS Code Marketplace and `publish_open_vsx` for Open VSX. Both default to `false`. The workflow builds and smoke-tests one VSIX, then each selected publisher job uses that same artifact. Validation runs with read-only repository access. A separate job creates the tag and GitHub Release only after the packaged smoke tests pass. Registry duplicate checks and publish retries are independent, and releases are serialized per tag.

| `publish` | `publish_open_vsx` | Result                                                                       |
| --------- | ------------------ | ---------------------------------------------------------------------------- |
| `false`   | `false`            | Create or update the GitHub Release only; do not publish to either registry. |
| `true`    | `false`            | Publish to the VS Code Marketplace only.                                     |
| `false`   | `true`             | Publish to Open VSX only.                                                    |
| `true`    | `true`             | Publish to both registries.                                                  |

The workflow uses the tag's source and VSIX attached to its GitHub Release when publishing an existing tag. It does not rebuild an old tag from the current workflow branch or replace the original release VSIX. This permits a later registry-only retry for a previously released version. For the initial Open VSX listing, select workflow branch `master` and tag input `v0.1.0` with `publish=false` and `publish_open_vsx=true` after setting `OVSX_PAT`; this is an Open VSX-only publish of that existing release artifact.

Open VSX setup requires an Eclipse account, acceptance of the [Eclipse Foundation Publisher Agreement](https://www.eclipse.org/legal/documents/eclipse-foundation-publisher-agreement.pdf), GitHub sign-in to Open VSX, and creation of the `austin-spagnolo` namespace (or verification/claiming of its ownership if it already exists). Store the Open VSX access token in the GitHub Actions secret `OVSX_PAT` and never expose it in workflow inputs or logs. `VSCE_PAT` remains the Marketplace credential. Namespace verification is not required for the initial PAT-based publish. Trusted publishing may be considered later; it requires a verified namespace owner, an existing active extension version, and a matching workflow, and is not part of the current release workflow.
