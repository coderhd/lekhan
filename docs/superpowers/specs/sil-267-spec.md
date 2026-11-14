# SIL-267: Docs-site CI build gate

## Objective and acceptance criteria

Add a GitHub Actions build check for the independent `docs-site` app, then request
that the resulting check be required on `main`.

- Every pull request targeting `main` and every push to `main` runs the check.
- The job runs `npm ci` followed by `npm run build` in `docs-site` using its own
  committed lockfile. Installation or build failure fails the check.
- The stable job/check name is `docs-site-build`. No path filters or conditional
  skips may prevent a required result from being reported for a PR.
- Request that the repository administrator add `docs-site-build` to the existing
  required checks on `main`, preserving all other protections, after its first run.

## Boundaries and verification

Use Node 22 (supported by `docs-site/package.json`), an Ubuntu GitHub-hosted runner,
read-only repository permissions, and npm caching keyed to the docs lockfile.
No application code, root scripts, dependencies, deployment settings, or production
secrets change. CONTEXT.md and ADR storage, encryption, and tier invariants are
unaffected. The reported local/Vercel timings already satisfy the parent's
three-minute build threshold; runner setup and install are separate from build time.

Validate YAML and workflow semantics and run a fresh `npm ci && npm run build` in an
isolated copy of the docs app. Obtain an independent clean-room review before PR
creation. Preserve the Pullfrog, CodeRabbit, and CI merge gates from AGENTS.md.
