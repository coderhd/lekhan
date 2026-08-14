# AGENTS.md

## Agent skills

### Issue tracker

Issues, specs, and roadmap tickets for this repo live as GitHub issues, tracked via the `gh` CLI (`gh` is installed at `/opt/homebrew/bin/gh` — not on the default PATH in this shell). See `docs/agents/issue-tracker.md`.

Every item on the Lekhan GitHub project board moves through `Backlog → Ready → In progress → In review → Done`, and the board's Status column is always kept truthful to the work actually being done — move items with `docs/agents/project-board.sh <issue> <status>`. See the "Project board lifecycle" section of `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` at the repo root plus `docs/adr/` for decisions. See `docs/agents/domain.md`.
