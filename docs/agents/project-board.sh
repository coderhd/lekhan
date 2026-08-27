#!/usr/bin/env bash
# project-board.sh — move an issue through the Lekhan GitHub Project lifecycle.
#
# Lifecycle: Backlog -> Ready -> In progress -> In review -> Done
# Usage:     project-board.sh <issue-number> <Backlog|Ready|In progress|In review|Done>
#
# Resolves the issue's project item and sets the Status single-select field.
# Requires `gh` (at /opt/homebrew/bin/gh — off the default PATH in this shell).

set -euo pipefail

GH="${GH:-/opt/homebrew/bin/gh}"
PROJECT_ID="PVT_kwHODFBK984BdQ8T"        # Lekhan project (#1)
STATUS_FIELD_ID="PVTSSF_lAHODFBK984BdQ8TzhXzr_Y"

issue_number="${1:-}"
target="${2:-}"

if [[ -z "$issue_number" || -z "$target" ]]; then
  echo "usage: $0 <issue-number> <Backlog|Ready|In progress|In review|Done>" >&2
  exit 1
fi

case "$target" in
  "Backlog")     option_id="f75ad846" ;;
  "Ready")       option_id="61e4505c" ;;
  "In progress") option_id="47fc9ee4" ;;
  "In review")   option_id="df73e18b" ;;
  "Done")        option_id="98236657" ;;
  *) echo "unknown status '$target' (expected: Backlog|Ready|In progress|In review|Done)" >&2; exit 1 ;;
esac

# Resolve the project item id for this issue number directly from the issue.
item_id="$("$GH" api graphql -f query='
query($number: Int!) {
  repository(owner: "coderhd", name: "lekhan") {
    issue(number: $number) {
      projectItems(first: 50) {
        nodes {
          id
          project { id }
        }
      }
    }
  }
}' -F "number=$issue_number" --jq ".data.repository.issue.projectItems.nodes[] | select(.project.id == \"$PROJECT_ID\") | .id")"

if [[ -z "$item_id" ]]; then
  echo "issue #$issue_number is not on the Lekhan project board" >&2
  exit 1
fi

"$GH" api graphql -f query='
mutation($project: ID!, $item: ID!, $field: ID!, $value: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $value } }
  ) { projectV2Item { id } }
}' -F "project=$PROJECT_ID" -F "item=$item_id" -F "field=$STATUS_FIELD_ID" -f "value=$option_id" >/dev/null

echo "issue #$issue_number -> $target"
