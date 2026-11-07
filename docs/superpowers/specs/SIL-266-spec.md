# SIL-266 — Pin docs-site to Node 22

The docs Vercel project is configured for Node 22.x, but the scaffold's `>=20.9`
engine overrides that setting and permits Node 26. Vercel resolves `22.x` to the
latest supported Node 22 patch: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions.

Acceptance criteria:

- `docs-site/package.json` declares `engines.node: "22.x"`.
- The lockfile root package records the same engine; dependency versions stay unchanged.
- The docs README requires Node 22 and explains why the major is constrained.
- A clean install and production docs build succeed using an actual Node 22 binary.
- Docs lint and internal-link checks pass. No product runtime behavior changes.
- This change is isolated from SIL-95 infrastructure provisioning; no Vercel settings,
  DNS, environment variables, root workspace scripts, or application code change.

No domain or ADR invariants change. Vercel can continue receiving Node 22 patch
updates; the constraint excludes both Node 20 and future major versions.
