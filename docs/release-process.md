# Release Process

This project uses a simple trunk-based workflow with `master` as the releasable branch. For release-day validation and publishing steps, use [release-checklist.md](./release-checklist.md).

## Branching

- Treat `master` as the releasable branch.
- Create short-lived feature, fix, and documentation branches from `master`.
- Open pull requests back into `master` after CI passes.
- Keep `master` ready to package and release.
- Use a longer-lived integration branch only for large work that needs multiple pull requests before it is safe to release.
