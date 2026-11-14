# SIL-267 implementation plan

Spec: `docs/superpowers/specs/sil-267-spec.md`.

1. Add `.github/workflows/docs-site.yml` with unfiltered PR-to-main and push-to-main
   events, stable `docs-site-build` job name, read-only permissions, Node 22, docs
   lockfile cache, docs working directory, install and build steps, and a bounded
   job timeout. Verify parsed event, directory, permissions, and step configuration.
2. Document the check name and administrator request in `docs-site/README.md`.
   Run a clean docs install and production build in a run-owned temporary copy;
   record the actual outcome. Root application checks are outside this CI-only
   change's verification scope.
3. Have an independent reviewer audit the complete proposed patch across the four
   required axes and record evidence in `docs/reviews/pr-sil-267-review.md`.
4. Publish a feature branch and PR when writes are permitted. Wait for internal
   review, external automated reviews, and green CI before merging. Request that
   the repository administrator require `docs-site-build` on `main` after its
   first successful run, retaining the existing checks and protection settings.

## Workspace constraint

The supplied checkout contains unrelated changes. `.git` is read-only, so local
branch/worktree/commit creation fails. The connected GitHub branch-write action
also returns `MCP tool call requires approval, but approval policy is never`.
Prepare a reviewable patch and attach it to the task; the manager/runtime owner
must provide a permitted publishing path. Do not change or bypass that policy.
