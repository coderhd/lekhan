# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

**Note:** `gh` is installed at `/opt/homebrew/bin/gh` but is not on the default PATH in this shell. Prefix commands with `export PATH="/opt/homebrew/bin:$PATH"` (or run the binary by its full path).

## Project board lifecycle

Every item on the Lekhan GitHub project board (`github.com/users/coderhd/projects/1`) moves through one
state machine — keep the board's Status column truthful, always:

**`Backlog` → `Ready` → `In progress` → `In review` → `Done`**

| Transition | Meaning | Who moves it |
|---|---|---|
| `Backlog` → `Ready` | Prioritized as next-up work | Human or roadmap session (see `docs/roadmap.md`) |
| `Ready` → `In progress` | Work actually started on the issue | The agent that starts the work, before dispatching/writing code |
| `In progress` → `In review` | Implementation done, review underway | Agent when the review is dispatched |
| `In review` → `Done` | Review clean, merged, tickets closed | Agent after verification |

Rules:

- Move an item to `In progress` the moment implementation begins — never leave a `Ready` item being worked.
- Move to `In review` when the review/verification starts, not when it's assumed done.
- Move to `Done` only after verification passes and the work is merged/closed.
- A finished or abandoned item must not sit in `Ready`/`In progress` — reflect reality.
- If an item must retreat (e.g. review found gaps and it's re-opened), move it back rather than leave it stale.

The statuses live in the **Status** single-select field. The **Priority** field (`P0`/`P1`/`P2`) is independent and
set by the roadmap/human; `Backlog` is the default resting state.

**Move an item:** `docs/agents/project-board.sh <issue-number> <Backlog|Ready|In progress|In review|Done>`
(e.g. `docs/agents/project-board.sh 26 Ready`). The script resolves the issue's project item and sets the Status
field. Verify afterwards with `gh project view` or the GraphQL query shown below.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
